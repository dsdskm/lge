import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Table } from '@repo/ui'
import { deviceApis } from '@/apis'
import { toYmdHmKST } from '@/utils/dateUtils'

const TableAlarm = ({ robotDatas = [] }) => {
  const { t } = useTranslation('robot')
  const [notifications, setNotifications] = useState([])
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (robotDatas.length === 0) {
      return
    }
    const fetchNotifications = async () => {
      setIsLoading(true)
      try {
        const oneMonthAgo = new Date()
        oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1)

        let page = 0
        let allContent = []
        let hasNext = true

        while (hasNext) {
          const res = await deviceApis.getDeviceNotifications({ onlyActiveFault: true, size: '300', page })
          // axios라면 res.data, fetch 후 이미 파싱했다면 res 자체가 페이지 데이터
          const data = res?.data ?? res
          const content = data?.content ?? []

          allContent = allContent.concat(content)

          const lastOccurredAt = content[content.length - 1]?.occurredAt
          const isLastOlderThanOneMonth = lastOccurredAt && new Date(lastOccurredAt) < oneMonthAgo

          hasNext = Boolean(data?.hasNext) && !isLastOlderThanOneMonth
          page += 1
        }

        setNotifications(allContent)
      } catch (error) {
        console.error(error)
        setNotifications([])
      } finally {
        setIsLoading(false)
      }
    }
    fetchNotifications()
  }, [robotDatas])

  const filteredDevices = notifications
    .map((notification) => {
      const matched = robotDatas?.find((robot) => robot.deviceId === notification.deviceId)
      if (!matched) return null
      return {
        ...notification,
        siteName: matched.siteName,
        occurredAt: toYmdHmKST(notification.occurredAt)
      }
    })
    .filter(Boolean)

  const columnData = () => {
    return {
      columns: [
        {
          name: t('site'),
          selector: (row) => row.siteName,
          sortable: true,
          width: '15%'
        },
        {
          name: t('robotName'),
          selector: (row) => row.deviceName,
          sortable: true,
          width: '15%'
        },
        {
          name: t('errorMessage'),
          selector: (row) => row.title,
          sortable: true
        },
        {
          name: t('occurDate'),
          selector: (row) => row.occurredAt,
          sortable: true,
          width: '20%'
        }
      ],
      conditionalRowStyles: []
    }
  }

  const handleRowClick = (row) => {
    console.log(row)
  }

  return (
    <Table
      columns={columnData().columns}
      data={filteredDevices}
      noData={'No Data'}
      isLoading={isLoading}
      pagination
      paginationRowsPerPageOptions={[10, 20, 30]}
      onRowClicked={handleRowClick}
      conditionalRowStyles={columnData().conditionalRowStyles}
    />
  )
}

export default TableAlarm
