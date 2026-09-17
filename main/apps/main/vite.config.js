import { defineConfig, loadEnv } from 'vite'
import { resolve } from 'path'
import svgr from 'vite-plugin-svgr'
import react from '@vitejs/plugin-react'
import federation from '@originjs/vite-plugin-federation'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const isProd = mode === 'prod' || mode === 'production'
  const apiEnv = loadEnv(mode, resolve(__dirname, '../../packages/apis'), 'VITE_')
  const envDefines = Object.keys(apiEnv).reduce((acc, key) => {
    acc[`import.meta.env.${key}`] = JSON.stringify(apiEnv[key])
    return acc
  }, {})

  return {
    define: envDefines,
    plugins: [
      react(),
      svgr({ include: '**/*.svg' }),
      federation({
        name: 'main',
        remotes: {
          tms: isProd ? '/tms/assets/remoteEntry.js' : '/tms/remoteEntry.js',
          ota: isProd ? '/ota/assets/remoteEntry.js' : '/ota/remoteEntry.js',
          robot: isProd ? '/robot/assets/remoteEntry.js' : '/robot/remoteEntry.js',
          cms: isProd ? '/cms/assets/remoteEntry.js' : '/cms/remoteEntry.js',
          learn: isProd ? '/learning/assets/remoteEntry.js' : '/learning/remoteEntry.js'
        },
        shared: {
          react: { singleton: true, eager: true },
          'react-dom': { singleton: true, eager: true },
          'react-router-dom': { singleton: true, eager: true },
          i18next: { singleton: true, eager: true },
          'react-i18next': { singleton: true, eager: true },
          'styled-components': { singleton: true, eager: true },
          'i18next-http-backend': { singleton: true, eager: true },
          'i18next-browser-languagedetector': { singleton: true, eager: true }
        }
      })
    ],
    server: {
      port: 5173,
      proxy: {
        '/tms': {
          target: 'http://localhost:5179',
          changeOrigin: true,
          ws: true,
          rewrite: (path) => (path === '/tms' ? '/tms/' : path)
        },
        '/ota': {
          target: 'http://localhost:5174',
          changeOrigin: true,
          ws: true,
          rewrite: (path) => (path === '/ota' ? '/ota/' : path)
        },
        '/robot': {
          target: 'http://localhost:5175',
          changeOrigin: true,
          ws: true,
          rewrite: (path) => (path === '/robot' ? '/robot/' : path)
        },
        '/setup': {
          target: 'http://localhost:5177',
          changeOrigin: true,
          ws: true,
          rewrite: (path) => (path === '/setup' ? '/setup/' : path)
        },
        '/cms': {
          target: 'http://localhost:5178',
          changeOrigin: true,
          ws: true,
          rewrite: (path) => (path === '/cms' ? '/cms/' : path)
        },
        '/learning': {
          target: 'http://localhost:5180',
          changeOrigin: true,
          ws: true,
          rewrite: (path) => (path === '/learning' ? '/learning/' : path)
        },
        '/init-setup': {
          target: 'http://localhost:5181',
          changeOrigin: true,
          ws: true,
          rewrite: (path) => (path === '/init-setup' ? '/init-setup/' : path)
        },
      }
    },
    preview: {
      port: 4173,
      proxy: {
        '/tms': {
          target: 'http://localhost:4179',
          changeOrigin: true,
          ws: true,
          rewrite: (path) => (path === '/tms' ? '/tms/' : path)
        },
        '/ota': {
          target: 'http://localhost:4174',
          changeOrigin: true,
          ws: true,
          rewrite: (path) => (path === '/ota' ? '/ota/' : path)
        },
        '/robot': {
          target: 'http://localhost:4175',
          changeOrigin: true,
          ws: true,
          rewrite: (path) => (path === '/robot' ? '/robot/' : path)
        },
        '/setup': {
          target: 'http://localhost:4177',
          changeOrigin: true,
          ws: true,
          rewrite: (path) => (path === '/setup' ? '/setup/' : path)
        },
        '/cms': {
          target: 'http://localhost:4178',
          changeOrigin: true,
          ws: true,
          rewrite: (path) => (path === '/cms' ? '/cms/' : path)
        },
        '/learning': {
          target: 'http://localhost:4180',
          changeOrigin: true,
          ws: true,
          rewrite: (path) => (path === '/learning' ? '/learning/' : path)
        },
        '/init-setup': {
          target: 'http://localhost:4181',
          changeOrigin: true,
          ws: true,
          rewrite: (path) => (path === '/init-setup' ? '/init-setup/' : path)
        },
      }
    },
    build: {
      outDir: '../../apps-dist',
      emptyOutDir: false
    },
    resolve: {
      alias: [{ find: /^@\/(.*)/, replacement: resolve(__dirname, 'src/$1') }]
    }
  }
})
