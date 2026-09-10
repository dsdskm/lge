import { client } from '@repo/apis'
import { ENDPOINTS } from './constants'

const axiosOta = client(import.meta.env.VITE_OTA_API_BASE_URL)

const retrieveCampaignGroup = async (id, orgId = null) => {
  try {
    const params = { id }
    if (orgId) params.orgId = orgId
    const response = await axiosOta.get(ENDPOINTS.CAMPAIGN_GROUP.BASE, { params })
    return response
  } catch (error) {
    console.error(`Failed to retrieve campaign group (${id}):`, error)
    throw error
  }
}

const retrieveCampaignGroups = async (orgIds) => {
  try {
    const response = await axiosOta.post(ENDPOINTS.CAMPAIGN_GROUP.LIST, { orgIds })
    return response
  } catch (error) {
    console.error('Failed to retrieve campaign groups:', error)
    throw error
  }
}

const saveCampaignGroup = async (data) => {
  try {
    const response = await axiosOta.put(ENDPOINTS.CAMPAIGN_GROUP.BASE, data)
    return response
  } catch (error) {
    console.error('Failed to create campaign group:', error)
    throw error
  }
}

const requestCampaignGroup = async (data) => {
  try {
    const response = await axiosOta.post(ENDPOINTS.CAMPAIGN_GROUP.REQUEST, data)
    return response
  } catch (error) {
    console.error(`Failed to request campaign group (${data.id}):`, error)
    throw error
  }
}

// (manual 모드) 단계 완료 후 대기 중인 그룹의 다음 단계 진행 승인
const proceedCampaignGroup = async (data) => {
  try {
    const response = await axiosOta.post(ENDPOINTS.CAMPAIGN_GROUP.PROCEED, data)
    return response
  } catch (error) {
    console.error(`Failed to proceed campaign group (${data.id}):`, error)
    throw error
  }
}

const cancelCampaignGroup = async (data) => {
  try {
    const response = await axiosOta.post(ENDPOINTS.CAMPAIGN_GROUP.CANCEL, data)
    return response
  } catch (error) {
    console.error(`Failed to cancel campaign group (${data.id}):`, error)
    throw error
  }
}

export {
  retrieveCampaignGroup,
  retrieveCampaignGroups,
  saveCampaignGroup,
  requestCampaignGroup,
  proceedCampaignGroup,
  cancelCampaignGroup
}
