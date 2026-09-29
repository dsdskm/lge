import createClient from './client'
import { ENDPOINTS } from './constants'

const axiosOta = createClient(import.meta.env.VITE_OTA_API_BASE_URL, 30 * 60 * 1000)
const mockUpData = false // import.meta.env.VITE_MODE !== 'local'
const packageTypeOptions = ['docker', 'xml', 'package']

const retrieveArtifacts = async (orgIds, id) => {
  const data = { orgIds }
  if (id) data.id = String(id)

  if (mockUpData) {
    return new Promise((resolve, reject) => {
      const processedData = []

      for (let i = 1; i < 30; i++) {
        processedData.push({
          id: i,
          displayName: 'Artifact ' + i,
          memo: 'Memo ' + i,
          Versions: ['1.0.0.' + i, '1.0.1.' + i],
          Files: [
            { fileName: `Artifact ${i}`, fileType: 'artifact' },
            { fileName: `Manifest ${i}`, fileType: 'manifest' }
          ],
          PackageType: { id: i, displayName: packageTypeOptions[i % packageTypeOptions.length] },
          Module: { id: i, displayName: `Module ${i}`, code: `Module Code ${i}` },
          Organization: { id: i, displayName: `Organization ${i}`, parentId: i % 2 === 0 ? 1 : 2 },
          createdAt: new Date(
            new Date().getTime() + Math.floor(Math.random() * 1000 * 60 * 60 * 24 * 30)
          ).toISOString(),
          status: i % 2 === 0 ? 'Process' : 'Completed'
        })
      }

      setTimeout(() => {
        resolve({
          message: 'OK',
          error: false,
          code: '0000',
          results: id ? processedData.filter((item) => item.id === Number(id)) : processedData
        })
      }, 500)
    })
  } else {
    const response = await axiosOta.post(ENDPOINTS.ARTIFACT, data)
    return response
  }
}

const requestUploadUrl = async (data) => {
  if (mockUpData) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        resolve({
          message: 'OK',
          error: false,
          code: '0000',
          results: {
            artifactUrls: [
              's3://example.com/presigned-url-artifact-1',
              's3://example.com/presigned-url-artifact-2',
              's3://example.com/presigned-url-artifact-3'
            ],
            manifestUrls: ['s3://example.com/presigned-url-manifest-1']
          }
        })
      }, 500)
    })
  } else {
    const response = await axiosOta.post(ENDPOINTS.ARTIFACT + '/requestUploadUrl', data)
    return response
  }
}

const completeMultipartUpload = async (data) => {
  const response = await axiosOta.post(ENDPOINTS.ARTIFACT + '/completeMultipartUpload', data)
  return response
}

const abortMultipartUpload = async (data) => {
  const response = await axiosOta.post(ENDPOINTS.ARTIFACT + '/notifyMultipartUploadAbort', data)
  return response
}

const failedMultipartUpload = async (data) => {
  const response = await axiosOta.post(ENDPOINTS.ARTIFACT + '/failedMultipartUpload', data)
  return response
}

const saveArtifact = async (data) => {
  const response = await axiosOta.put(ENDPOINTS.ARTIFACT, data)
  return response
}

export const artifactApis = {
  retrieveArtifacts,
  requestUploadUrl,
  completeMultipartUpload,
  abortMultipartUpload,
  failedMultipartUpload,
  saveArtifact
}
