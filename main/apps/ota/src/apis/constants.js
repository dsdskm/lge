import { API_CONFIG } from '@repo/apis'

export const ENDPOINTS = {
  CAMPAIGN: {
    BASE: `${API_CONFIG.PREFIX_OTA}/campaign`,
    DEVICE_LIST: `${API_CONFIG.PREFIX_OTA}/campaign/device`,
    REQUEST: `${API_CONFIG.PREFIX_OTA}/campaign/request`,
    ABORT: `${API_CONFIG.PREFIX_OTA}/campaign/abort`,
    ROLLBACK: `${API_CONFIG.PREFIX_OTA}/campaign/rollback`
  },
  // 캠페인 그룹(단계적 배포) : 그룹 1개 = phase(캠페인) N개
  CAMPAIGN_GROUP: {
    BASE: `${API_CONFIG.PREFIX_OTA}/campaign-group`,
    LIST: `${API_CONFIG.PREFIX_OTA}/campaign-group/list`,
    REQUEST: `${API_CONFIG.PREFIX_OTA}/campaign-group/request`,
    PROCEED: `${API_CONFIG.PREFIX_OTA}/campaign-group/proceed`,
    CANCEL: `${API_CONFIG.PREFIX_OTA}/campaign-group/cancel`
  },
  ACTION: `${API_CONFIG.PREFIX_OTA}/action`,
  ARTIFACT: `${API_CONFIG.PREFIX_OTA}/artifact`,
  TARGETGROUP: `${API_CONFIG.PREFIX_OTA}/target-group`,
  POLICY: `${API_CONFIG.PREFIX_OTA}/policy`,
  DEVICE: {
    BASE: `${API_CONFIG.PREFIX_OTA}/device`,
    STATUS: `${API_CONFIG.PREFIX_ROBOT}/devices`
  },
  DEVICE_TYPE: `${API_CONFIG.PREFIX_OTA}/device-type`,
  PACKAGE_TYPE: `${API_CONFIG.PREFIX_OTA}/package-type`,
  ORGANIZATION: {
    BASE: `${API_CONFIG.PREFIX_OTA}/organization`,
    TREE: `${API_CONFIG.PREFIX_OTA}/organization/tree`,
    COMPANY: `${API_CONFIG.PREFIX_OTA}/organization/company`,
    JOIN: `${API_CONFIG.PREFIX_OTA}/organization/join`,
    WITHDRAW: `${API_CONFIG.PREFIX_OTA}/organization/withdraw`,
    APPROVE: `${API_CONFIG.PREFIX_OTA}/organization/approve`,
    REQUEST: `${API_CONFIG.PREFIX_OTA}/organization/request`,
    CHANGE_ROLE: `${API_CONFIG.PREFIX_OTA}/organization/changeRole`
  },
  MODULE: {
    BASE: `${API_CONFIG.PREFIX_OTA}/module`,
    INFO_ACTIVATE_CI: `${API_CONFIG.PREFIX_OTA}/module/info/activate-ci`,
    ACTIVATE_CI: `${API_CONFIG.PREFIX_OTA}/module/activate-ci`,
    CI_TEMPLATE: `${API_CONFIG.PREFIX_OTA}/module/ci-template`
  },
  DEPLOY_STRATEGY: `${API_CONFIG.PREFIX_OTA}/deploy-strategy`,
  SWAGGER: `${API_CONFIG.PREFIX_OTA}/swagger`,
  MQTT: {
    CREDENTIALS: `${API_CONFIG.PREFIX_OTA}/mqtt-credentials`
  }
}
