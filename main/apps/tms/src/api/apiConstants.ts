import { API_CONFIG } from '@repo/apis'

export const ENDPOINTS = {
  ROBOT: {
    AUTH: `${API_CONFIG.PREFIX_AUTH}`,
    DEVICES: `${API_CONFIG.PREFIX_ROBOT}/devices`,
    FILES: `${API_CONFIG.PREFIX_ROBOT}/files`,
    GROUPS: `${API_CONFIG.PREFIX_ROBOT}/groups`,
    MAPS: `${API_CONFIG.PREFIX_ROBOT}/maps`,
    SITES: `${API_CONFIG.PREFIX_ROBOT}/sites`,
    USERS: `${API_CONFIG.PREFIX_ROBOT}/users`
  },
  TMS: {
    TASKS: `${API_CONFIG.PREFIX_TMS}/tasks`,
    TASKFLOWS: `${API_CONFIG.PREFIX_TMS}/taskflows`,
    DEPLOY: `${API_CONFIG.PREFIX_TMS}/deployments`,
    ROBOT_DEPLOY: `${API_CONFIG.PREFIX_TMS}/robot-deployments`,
    CONTENTS: `${API_CONFIG.PREFIX_TMS}/contents`,
    CONTENTS_CHECKUPDATED: `${API_CONFIG.PREFIX_TMS}/contents/check-updates`
  },
  CMS: {
    FILE: `${API_CONFIG.PREFIX_CMS}/file-content/request-download-url-id`
  }
}

export const GETSIZE = '100'
