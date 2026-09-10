import { useState, useEffect, useCallback, useRef } from 'react'
import { Amplify } from 'aws-amplify'
import { Hub } from 'aws-amplify/utils'
import { PubSub } from '@aws-amplify/pubsub'
import { useUserStore } from '@repo/stores'

// Only emit verbose logs in dev builds; never log raw payloads in production.
const DEBUG = import.meta.env?.DEV ?? false
const log = (...args) => {
  if (DEBUG) console.log(...args)
}

const noop = () => {}

// Reject MQTT wildcards so a caller can't subscribe broadly (e.g. "#", "+").
const isValidTopic = (topic) => typeof topic === 'string' && topic.trim().length > 0 && !/[#+]/.test(topic)

// Module-scoped variables to share state across all hook instances
let pubsubInstance = null
let isAmplifyConfigured = false
let globalIsConnected = false
const globalSubscribers = {} // { topic: [handlers] }
const globalAmplifySubscriptions = {} // { topic: subscription }

// Cached temporary AWS credentials issued by the backend (subscribe-only, scoped to
// OTA status topics). Refreshed shortly before expiry.
let cachedCredentials = null
let credentialsExpireAt = 0 // epoch ms
let inflightFetch = null
const REFRESH_MARGIN_MS = 5 * 60 * 1000 // refresh 5 min before expiry

// App-supplied credentials fetcher. Each app injects its own (e.g. its backend's
// getMqttCredentials) so this hook stays decoupled from any single API client.
// Expected to resolve to { accessKeyId, secretAccessKey, sessionToken, expiration }.
let credentialsFetcher = null

const isLoggedIn = () => !!useUserStore.getState().session?.accessToken

// Fetch scoped credentials via the app-supplied fetcher and normalize/cache them.
// The fetcher is responsible for authenticating its own request (e.g. bearer token);
// unauthenticated callers reject.
const fetchCredentials = async () => {
  if (!credentialsFetcher) {
    throw new Error('useMqtt: fetchCredentials option is required')
  }
  const creds = await credentialsFetcher()
  cachedCredentials = {
    accessKeyId: creds.accessKeyId,
    secretAccessKey: creds.secretAccessKey,
    sessionToken: creds.sessionToken,
    expiration: creds.expiration ? new Date(creds.expiration) : undefined
  }
  credentialsExpireAt = cachedCredentials.expiration ? cachedCredentials.expiration.getTime() : 0
  return cachedCredentials
}

// Amplify v6 custom credentials provider: returns the backend-issued temporary
// credentials instead of using a Cognito Identity Pool. This removes guest access.
const credentialsProvider = {
  getCredentialsAndIdentityId: async () => {
    const fresh = cachedCredentials && credentialsExpireAt - Date.now() > REFRESH_MARGIN_MS
    if (!fresh) {
      // De-dupe concurrent refreshes.
      if (!inflightFetch) {
        inflightFetch = fetchCredentials().finally(() => {
          inflightFetch = null
        })
      }
      await inflightFetch
    }
    return { credentials: cachedCredentials }
  },
  clearCredentialsAndIdentityId: () => {
    cachedCredentials = null
    credentialsExpireAt = 0
  }
}

export const useMqtt = (options = {}) => {
  const brokerUrl = options.brokerUrl
  const region = options.region
  // Each app passes its own backend's credentials fetcher (see fetchCredentials above).
  if (options.fetchCredentials) {
    credentialsFetcher = options.fetchCredentials
  }

  const [isConnected, setIsConnected] = useState(globalIsConnected)
  // Track handlers added by THIS specific instance for cleanup
  const localHandlersRef = useRef([]) // [ { topic, handler, unsubscribe } ]

  useEffect(() => {
    if (!brokerUrl || !region || !options.fetchCredentials) return
    // Do not connect for unauthenticated users — closes the former guest-access path.
    if (!isLoggedIn()) {
      log('useMqtt: user not authenticated, skipping MQTT connection')
      return
    }

    if (!isAmplifyConfigured) {
      try {
        // Inject backend-issued credentials via the library options credentials provider.
        Amplify.configure({}, { Auth: { credentialsProvider } })
        isAmplifyConfigured = true
        log('Amplify configured for MQTT (authenticated credentials)')
      } catch (err) {
        console.error('Amplify initialization error:', err)
        return
      }
    }

    if (!pubsubInstance) {
      pubsubInstance = new PubSub({
        region,
        endpoint: brokerUrl
      })
      log('PubSub instance created')
    }

    // Listen for connection state changes (shared across instances)
    const stopListening = Hub.listen('pubsub', (data) => {
      const { event } = data.payload
      if (event === 'connectionStateChange') {
        const connectionState = data.payload.data.connectionState
        log('MQTT connection state:', connectionState)
        globalIsConnected = connectionState === 'Connected'
        setIsConnected(globalIsConnected)
      }
    })

    return () => {
      stopListening()
      // Cleanup ONLY handlers created by this instance
      if (localHandlersRef.current.length > 0) {
        log('useMqtt instance unmounting, cleaning up local handlers:', localHandlersRef.current.length)
        // Copy the array to avoid modification during iteration
        const handlersToCleanup = [...localHandlersRef.current]
        handlersToCleanup.forEach(({ unsubscribe }) => {
          if (unsubscribe) {
            unsubscribe()
          }
        })
      }
    }
  }, [brokerUrl, region])

  const subscribe = useCallback((topic, handler) => {
    log(`MQTT subscribe attempt: ${topic}`)
    // Callers use the return value directly as the unsubscribe function, so every path
    // must return a function (a no-op object here would blow up in effect cleanup).
    if (!isValidTopic(topic)) {
      console.warn('MQTT subscribe rejected: invalid topic')
      return noop
    }
    if (!pubsubInstance) {
      console.warn('PubSub is not initialized yet (pubsubInstance is null).')
      return noop
    }

    if (!globalSubscribers[topic]) {
      globalSubscribers[topic] = []

      try {
        const subscription = pubsubInstance.subscribe({ topics: topic }).subscribe({
          next: (data) => {
            log(`MQTT message received for ${topic}`)
            const payload = { ...(data.value || data), topic }
            const handlers = globalSubscribers[topic] || []
            handlers.forEach((hdlr) => hdlr(payload))
          },
          error: (err) => console.error(`Subscription error for ${topic}:`, err),
          complete: () => log(`Subscription completed for ${topic}`)
        })

        globalAmplifySubscriptions[topic] = subscription
        log(`MQTT successfully subscribed to topic (new subscription): ${topic}`)
      } catch (err) {
        console.error(`Failed to subscribe to ${topic}:`, err)
      }
    } else {
      log(`MQTT adding handler to existing subscription: ${topic}`)
    }

    globalSubscribers[topic].push(handler)

    const unsubscribe = () => {
      log(`MQTT unsubscribe called for topic: ${topic}`)
      if (globalSubscribers[topic]) {
        globalSubscribers[topic] = globalSubscribers[topic].filter((h) => h !== handler)

        if (globalSubscribers[topic].length === 0) {
          if (globalAmplifySubscriptions[topic]) {
            globalAmplifySubscriptions[topic].unsubscribe()
            delete globalAmplifySubscriptions[topic]
            log(`MQTT unsubscribed from topic (no more handlers): ${topic}`)
          }
          delete globalSubscribers[topic]
        } else {
          log(`MQTT removed handler, remaining handlers for ${topic}: ${globalSubscribers[topic].length}`)
        }
      }
      // Also remove from local handlers tracking
      localHandlersRef.current = localHandlersRef.current.filter((item) => item.handler !== handler)
    }

    // Track this subscription locally for auto-cleanup on unmount
    localHandlersRef.current.push({ topic, handler, unsubscribe })

    return unsubscribe
  }, [])

  return { isConnected, subscribe }
}
