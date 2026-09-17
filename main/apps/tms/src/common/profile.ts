export type AppProfile = 'cloud' | 'device'

export const APP_PROFILE: AppProfile = import.meta.env.VITE_TMS_PROFILE === 'device' ? 'device' : 'cloud'

export const isDeviceProfile = APP_PROFILE === 'device'
