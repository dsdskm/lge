import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import styled from 'styled-components'
import { Table, Modal, Button, ExpandableSection, SectionRobot as Section } from '@repo/ui'
import { useNavigate } from 'react-router-dom'
import { toYmdHmKST } from '@/utils/dateUtils'
import {
  parseDeviceInfo,
  parseRobotData,
  getLocalizedName,
  getWifiStatus,
  getTaskFlowControlState,
  filterActiveTaskFlows
} from '@/utils/robotUtils'
import { EditButton, PlayButton, StopButton, LiveSpan, NoUnderlineExpandable } from '@/utils/style'
import { SectionList } from '../styles'
import { useModalState } from '@repo/hooks'
import { deviceApis, mapApis } from '@/apis'
import ModalEditRobot from '../modal/ModalEditRobot'
import ModalMoveLocation from '../modal/ModalMoveLocation.jsx'
import ModalSelectTaskFlow from '../modal/ModalSelectTaskFlow.jsx'
import ModalLogUploadRequest from '../modal/ModalLogUploadRequest.jsx'
import { useTranslation } from 'react-i18next'
import { useUserStore } from '@repo/stores'
// import SiteMap from '../../../common/SiteMap'
import SiteMap3D from '../../../common/SiteMap3D'
import PartsStatusPanel from '../component/PartsStatusPanel'
import RobotControlPanel from '../component/RobotControlPanel'
import { Play, GamePad, Battery, Wifi, Clock, OperationStatus, StopCircle, Trash } from '@/assets/icon'

const MajorActionButton = styled(Button)`
  background: var(--t-major-action-btn-bg) !important;
  border-color: var(--t-major-action-btn-border) !important;
  color: var(--t-major-action-btn-text) !important;

  &:hover:not(:disabled) {
    background: var(--t-major-action-btn-hover-bg) !important;
    border-color: var(--t-major-action-btn-hover-bg) !important;
  }
`
// sitePosition(건물/층/영역) 식별 키 — 값이 바뀌면 해당 위치의 지도를 다시 로딩
const sitePosKey = (sp) => (sp?.buildingId ? `${sp.buildingId}/${sp.floorId}/${sp.areaId}` : null)

// {label, value} 목록을 2개씩 묶어 4컬럼(제목/내용 2쌍) 테이블 행으로 변환
const toPairedRows = (items) => {
  const rows = []
  for (let i = 0; i < items.length; i += 2) {
    const left = items[i]
    const right = items[i + 1]
    rows.push({
      label1: left?.label,
      value1: left?.value,
      editable1: left?.editable,
      label2: right?.label ?? '',
      value2: right?.value ?? '',
      editable2: right?.editable
    })
  }
  return rows
}

const AssetInfo = ({ t, deviceId }) => {
  const EditRobotModal = useModalState()
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false)
  const [deviceInfo, setDeviceInfo] = useState({})
  const [confirmMessage, setConfirmMessage] = useState('')
  const [robotErrors, setRobotErrors] = useState([])
  const [mapData, setMapData] = useState({})
  const [robotDatas, setRobotDatas] = useState([])
  const [robotState, setRobotState] = useState({})
  const [taskFlows, setTaskFlows] = useState([])
  const [showMap, setShowMap] = useState(false)
  const [mapServer, setMapServer] = useState({})
  const { t: tCommon, i18n } = useTranslation('common')
  const MoveLocationModal = useModalState()
  const SelectTaskFlowModal = useModalState()
  const DeleteRobotModal = useModalState()
  const LogUploadRequestModal = useModalState()
  const navigate = useNavigate()
  const { session } = useUserStore()
  const [isLive, setIsLive] = useState(false)
  const liveIntervalRef = useRef(null)
  const prevSitePosRef = useRef(null) // 마지막으로 지도를 로딩한 sitePosition 키
  const pollCacheRef = useRef({
    updatedAt: null,
    st: null, // state.stateUpdatedAt
    conn: null, // connection.connectionUpdatedAt
    tms: null, // tms.tmsUpdatedAt (taskFlows 변경 감지)
    hwTs: null,
    senTs: null,
    swTs: null,
    gkr: null,
    tofu: null,
    zeroGain: null
  })
  const [channel, setChannel] = useState('CLOUD')

  useEffect(() => {
    loadDeviceInfo()
  }, [])

  function getStatus(status, target) {
    let className = ''
    let text = ''
    switch (status) {
      case 'OPERATION':
        text = t('operation')
        break
      case 'STANDBY':
        text = t('standby')
        break
      case 'CHARGE':
        text = t('charge')
        break
      case 'ERROR':
        text = t('error')
        break
      case 'OFFLINE':
        text = t('offline')
        break
      case 'REGISTERED':
        text = t('register')
        break
      case 'ACTIVE':
        text = t('active')
        break
      case 'DELETE':
        text = t('delete')
        break
      default:
        text = t('noData')
        break
    }

    if (target == 'badge') {
      return className
    } else if (target == 'text') {
      return text
    }
  }

  const loadDeviceInfo = useCallback(async (searchParams = {}) => {
    try {
      const data = await deviceApis.getDeviceInfo(deviceId)
      setDeviceInfo({
        ...parseDeviceInfo(data),
        wifi: getWifiStatus(data.state)
      })
      setRobotDatas([parseRobotData(data)])
      setRobotState(data?.state)
      setTaskFlows(filterActiveTaskFlows(data?.tms?.taskFlowState?.taskFlows))

      const provisionData = data.provision
      const sp = data.state?.sitePosition
      // 지도는 로봇이 다른 건물/영역으로 이동하기 전까지는 바뀌지 않으므로,
      // 위치 키가 이전에 로딩한 값과 동일하면 다시 불러오지 않는다.
      // (제어 명령 후 정보 갱신 시 불필요한 지도 재조회 방지)
      // 맵은 device/area 단위로만 존재 → sitePosition(area) 없으면 조회하지 않음
      if (provisionData && provisionData.isDefaultSite) {
        // 기본 사이트: deviceId 기준으로 조회 (위치 개념이 없어 device 키로 dedupe)
        const nextKey = `device:${deviceId}`
        if (prevSitePosRef.current !== nextKey) {
          prevSitePosRef.current = nextKey
          getMapUrlByDevice()
        }
      } else if (provisionData && !provisionData.isDefaultSite && sp) {
        const nextKey = sitePosKey(sp)
        if (prevSitePosRef.current !== nextKey) {
          prevSitePosRef.current = nextKey
          getMapUrl(provisionData, sp)
        }
      } else {
        prevSitePosRef.current = null
        setShowMap(false)
      }
    } catch (err) {
      console.error('Error loadDeviceInfo:', err)
    } finally {
    }
  }, [])

  const getMapUrl = useCallback(async (provisionData, sitePosition) => {
    // 맵은 area 단위로만 존재하며, 조회 시 상위 buildingId/floorId를 반드시 함께 전달해야 함.
    if (!sitePosition?.areaId || !sitePosition?.buildingId || !sitePosition?.floorId) {
      setShowMap(false)
      return
    }
    try {
      const params = {
        groupId: provisionData.groupId,
        siteId: provisionData.siteId,
        buildingId: sitePosition.buildingId,
        floorId: sitePosition.floorId,
        areaId: sitePosition.areaId
      }
      const data = await mapApis.getMapViewFind(params)
      let type = 'png'
      let url = ''
      if (data.mapServer?.navi?.svgDownloadUrl) {
        type = 'svg'
        url = data.mapServer.navi.svgDownloadUrl
      } else {
        url = data.mapServer.navi.pngDownloadUrl
      }
      setMapData({
        type: type,
        url: url
      })
      setShowMap(true) // 성공한 경우에만 표시
      setMapServer(data.mapServer)
    } catch (err) {
      console.error('Error getMapUrl:', err)
    } finally {
    }
  }, [])

  const getMapUrlByDevice = useCallback(async () => {
    try {
      const params = { deviceId: deviceId }
      const data = await mapApis.getMapViewFind(params)

      let type = 'png'
      let url = ''
      if (data.mapServer?.navi?.svgDownloadUrl) {
        type = 'svg'
        url = data.mapServer.navi.svgDownloadUrl
      } else {
        url = data.mapServer.navi.pngDownloadUrl
      }
      setMapData({ type, url })
      setShowMap(true)
      setMapServer(data.mapServer)
    } catch (err) {
      console.error('Error getMapUrlByDevice:', err)
    }
  }, [deviceId])

  const openModalEditRobot = () => {
    EditRobotModal.onOpen()
  }

  const conformModalEditRobot = (result) => {
    EditRobotModal.onClose()
    setConfirmMessage(result?.resultNo == 2 ? t('chanegRobotName') : t('errorReport'))
    setIsConfirmModalOpen(true)
  }

  const conformModal = () => {
    setIsConfirmModalOpen(false)
    loadDeviceInfo()
  }

  // 로봇 삭제 버튼 클릭 — 실시간(Live) 상태와 무관하게 API로 최신 상태를 조회하여
  // 운영 중(OPERATION)이면 삭제 불가 안내 팝업을 띄우고, 그 외에는 삭제 확인 모달을 연다.
  const handleDeleteClick = async () => {
    try {
      const data = await deviceApis.getDeviceInfo(deviceId)
      setDeviceInfo({
        ...parseDeviceInfo(data),
        wifi: getWifiStatus(data.state)
      })
      if (data?.deviceState === 'OPERATION') {
        setConfirmMessage(t('robotDeleteBlockedOperating'))
        setIsConfirmModalOpen(true)
        return
      }
      DeleteRobotModal.onOpen()
    } catch (err) {
      console.error('로봇 상태 확인 실패:', err)
      setConfirmMessage(t('errorReport'))
      setIsConfirmModalOpen(true)
    }
  }

  // 로봇(기기) 즉시 삭제 — 확인 모달에서 "삭제" 선택 시 호출
  const handleDeleteDevice = async () => {
    try {
      await deviceApis.deleteDeviceForce(deviceId)
      DeleteRobotModal.onClose()
      // 삭제 완료 후 로봇 목록으로 이동
      navigate('/robot/management')
    } catch (err) {
      console.error('로봇 삭제 실패:', err)
      DeleteRobotModal.onClose()
      setConfirmMessage(t('errorReport'))
      setIsConfirmModalOpen(true)
    }
  }

  // 로그 업로드 요청 모달 확인 — 선택한 시작 시각 + 지속 시간(분) + 전체 시스템 텍스트 로그 포함 여부를 uploadLog 액션으로 전송
  const handleLogUploadRequest = ({ startDate, startHour, startMinute, duration, includeSystemTextLog }) => {
    LogUploadRequestModal.onClose()

    const startAt = new Date(startDate)
    startAt.setHours(Number(startHour), Number(startMinute), 0, 0)

    sendActions(
      [
        {
          actionType: 'uploadLog',
          actionId: crypto.randomUUID(),
          blockingType: 'NONE',
          actionParameters: [
            { key: 'start_time', value: startAt.toISOString() },
            { key: 'duration', value: String(duration) },
            { key: 'include_system_text_log', value: String(includeSystemTextLog) }
          ]
        }
      ],
      `${t('logUploadRequest')} ${t('sendCommand')}`
    )
  }

  const handleLogPlayClick = () => {
    if (!deviceId) return
    const popup = window.open('../logreplay?deviceId=' + deviceId, '_blank', 'noopener,noreferrer')
  }

  const handleClick = () => {
    if (!deviceId) return
    const popup = window.open('../ReplayControls?deviceId=' + deviceId, '_blank', 'noopener,noreferrer')
  }

  const errorColumns = [
    {
      name: t('occurDate'),
      selector: (row) => (row.erroredAt ? toYmdHmKST(row.erroredAt) : '-'),
      sortable: true,
      width: '15%',
      style: { paddingLeft: '12px', paddingRight: '12px' }
    },
    {
      name: t('errorCode'),
      selector: (row) => row.errorCode,
      sortable: true,
      width: '10%',
      style: { paddingLeft: '12px', paddingRight: '12px' }
    },
    {
      name: t('errorDetail'),
      selector: (row) => row.errorTitle,
      sortable: true,
      width: '50%',
      wrap: true,
      style: {
        paddingLeft: '12px',
        paddingRight: '12px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'normal'
      }
    },
    {
      name: t('recoverySatus'),
      selector: (row) => (
        <span style={{ color: row.isRecovered ? '#16a34a' : '#dc2626', whiteSpace: 'nowrap' }}>
          {row.isRecovered ? t('complete') : t('imcomplete')}
        </span>
      ),
      sortable: true,
      width: '10%',
      style: { paddingLeft: '12px', paddingRight: '12px' }
    },
    {
      name: t('recoveryDate'),
      selector: (row) => (row.recoveredAt ? toYmdHmKST(row.recoveredAt) : '-'),
      sortable: true,
      width: '15%',
      style: { paddingLeft: '12px', paddingRight: '12px' }
    }
  ]

  useEffect(() => {
    if (deviceId) {
      loadErrorList()
    }
  }, [deviceId])

  const loadErrorList = useCallback(
    async (searchParams = {}) => {
      try {
        const data = await deviceApis.getDeviceErrors(deviceId)
        //console.info('data :', data)
        setRobotErrors(data.content)
      } catch (err) {
        console.error('Error loadGetDevices:', err)
      } finally {
      }
    },
    [deviceId]
  )

  const handleMoveLocation = useCallback(
    async (poi) => {
      const params = {
        userId: session?.userId,
        actions: [
          {
            actionType: 'move',
            actionId: crypto.randomUUID(),
            blockingType: 'NONE',
            actionParameters: [
              {
                key: 'poi_id',
                value: poi.poiId
              }
            ]
          }
        ]
      }

      try {
        if (channel === 'RF') {
          // 모바일 webview(RF): 서버 호출 대신 안드로이드 네이티브로 actions 전송
          sendToAndroidNative({ deviceId, userId: session?.userId, actions: params.actions })
        } else {
          await deviceApis.postInstanceActions(deviceId, params)
        }
        const poiName = getLocalizedName(poi.name, i18n.language) || poi.poiId
        setConfirmMessage(`${poiName} ${t('moveCommandSent')}`)
        setIsConfirmModalOpen(true)
      } catch (err) {
        console.error('장소 이동 명령 실패:', err)
        setConfirmMessage(t('errorReport'))
        setIsConfirmModalOpen(true)
      }
    },
    [deviceId, session?.userId, channel]
  )

  const isOnline = deviceInfo.state && deviceInfo.state != 'OFFLINE'

  // taskFlows(운영 업무 목록)의 operationStatus에 따라 시작/정지/일시정지/재개 버튼 활성 조건 계산
  const taskFlowControl = useMemo(() => getTaskFlowControlState(taskFlows), [taskFlows])

  // actions 배열을 로봇에 전송하는 공용 함수 (RF: 네이티브, 그 외: 서버)
  // 성공/실패 시 확인 모달 메시지를 표시한다.
  const sendActions = async (actions, successMessage) => {
    const params = { userId: session?.userId, actions }
    try {
      if (channel === 'RF') {
        // 모바일 webview(RF): 서버 호출 대신 안드로이드 네이티브로 actions 전송
        sendToAndroidNative({ deviceId, userId: session?.userId, actions })
      } else {
        await deviceApis.postInstanceActions(deviceId, params)
      }
      setConfirmMessage(successMessage)
      setIsConfirmModalOpen(true)
    } catch (err) {
      console.error('명령 전송 실패:', err)
      setConfirmMessage(t('errorReport'))
      setIsConfirmModalOpen(true)
    }
  }

  const handleRobotAction = async (action) => {
    if (!isOnline && action !== 'reboot' && action !== 'shutdown') {
      alert(t('offlineStatue'))
      return
    }

    // 업무 시작 — 업무(taskFlow) 선택 모달을 띄우고, 실제 명령 전송은 handleStartTaskFlow에서 처리
    if (action === 'start') {
      SelectTaskFlowModal.onOpen()
      return
    }

    // 정지/일시정지/재개 — 대상 taskFlow(현재 RUNNING 또는 PAUSED인 업무)를 찾아 tms_id를 담아 전송
    // statuses에 해당하는 taskFlow가 없으면(버튼이 비활성 상태여야 하는 경우) 아무 동작도 하지 않음
    const taskFlowActionMap = {
      stop: { actionType: 'stop', blockingType: 'HARD', labelKey: 'stop', statuses: ['RUNNING', 'PAUSED'] },
      pause_task: { actionType: 'startPause', blockingType: 'HARD', labelKey: 'workTempStop', statuses: ['RUNNING'] },
      resume_task: { actionType: 'stopPause', blockingType: 'HARD', labelKey: 'workReume', statuses: ['PAUSED'] }
    }

    const taskFlowAction = taskFlowActionMap[action]
    if (taskFlowAction) {
      const targetTaskFlow = taskFlows.find((tf) => taskFlowAction.statuses.includes(tf.operationStatus))
      if (!targetTaskFlow) return

      await sendActions(
        [
          {
            actionType: taskFlowAction.actionType,
            actionId: crypto.randomUUID(),
            blockingType: taskFlowAction.blockingType,
            actionParameters: [{ key: 'tms_id', value: targetTaskFlow.id }]
          }
        ],
        `${targetTaskFlow.name} ${t('sendCommand')}`
      )
      return
    }

    // actionType/blockingType만 다른 단순 명령 액션
    // messageKey가 있으면 해당 메시지를, 없으면 "라벨 + sendCommand"를 성공 메시지로 사용
    const commandActionMap = {
      reboot: { actionType: 'reboot', blockingType: 'HARD', labelKey: 'reboot' },
      listen: { actionType: 'searchByVoice', blockingType: 'NONE', labelKey: 'listen' },
      shutdown: { actionType: 'poweroff', blockingType: 'HARD', labelKey: 'powerEnd' },
      go_charging: { actionType: 'goCharging', blockingType: 'NONE', messageKey: 'chargingStationMoveSent' },
      gkr: {
        actionType: 'gkr',
        blockingType: 'HARD',
        labelKey: 'gkr',
        actionParameters: [{ key: 'map_id', value: mapServer?.mapId }]
      },
      freeRunOn: { actionType: 'tofuOn', blockingType: 'HARD', labelKey: 'freeRunModeOn' },
      freeRunOff: { actionType: 'tofuOff', blockingType: 'HARD', labelKey: 'freeRunModeOff' },
      zeroGainOn: { actionType: 'zeroGainOn', blockingType: 'HARD', labelKey: 'zeroGainModeOn' },
      zeroGainOff: { actionType: 'zeroGainOff', blockingType: 'HARD', labelKey: 'zeroGainModeOff' }
    }

    const command = commandActionMap[action]
    if (command) {
      await sendActions(
        [
          {
            actionType: command.actionType,
            actionId: crypto.randomUUID(),
            blockingType: command.blockingType,
            ...(command.actionParameters ? { actionParameters: command.actionParameters } : {})
          }
        ],
        command.messageKey ? t(command.messageKey) : `${t(command.labelKey)} ${t('sendCommand')}`
      )
      return
    }

    console.log(`Robot action: ${action}`)
    alert(`${action} ` + t('sendCommand'))
  }

  // 업무 선택 모달에서 taskFlow를 확정 → tms_id를 담아 move 액션 전송
  const handleStartTaskFlow = (taskFlow) => {
    sendActions(
      [
        {
          actionType: 'start',
          actionId: crypto.randomUUID(),
          blockingType: 'HARD',
          actionParameters: [{ key: 'tms_id', value: taskFlow.id }]
        }
      ],
      `${taskFlow.name} ${t('sendCommand')}`
    )
  }

  // 모션 명령 — RobotControlPanel에서 { actionType, blockingType, actionParameters }와 표시명을 전달받아 전송
  const handleMotion = (action, name) => {
    if (!isOnline) {
      alert(t('offlineStatue'))
      return
    }
    sendActions([{ ...action, actionId: crypto.randomUUID() }], `${name} ${t('sendCommand')}`)
  }

  // 회전 명령 — 시계방향(cw) → turnRight, 반시계방향(ccw) → turnLeft
  const handleRotate = (direction, degree) => {
    if (!isOnline) {
      alert(t('offlineStatue'))
      return
    }
    const actionType = direction === 'cw' ? 'turnRight' : 'turnLeft'
    const actions = [
      {
        actionType,
        actionId: crypto.randomUUID(),
        blockingType: 'HARD',
        actionParameters: [{ key: 'degree', value: String(degree) }]
      }
    ]
    sendActions(actions, `${degree}° ${t('sendCommand')}`)
  }

  // 수동 이동 명령 — 전진(forward) → moveForward, 후진(backward) → moveBackward
  const handleManualMove = (direction, distance) => {
    if (!isOnline) {
      alert(t('offlineStatue'))
      return
    }
    const actionType = direction === 'forward' ? 'moveForward' : 'moveBackward'
    const actions = [
      {
        actionType,
        actionId: crypto.randomUUID(),
        blockingType: 'HARD',
        actionParameters: [{ key: 'distance', value: String(distance) }]
      }
    ]
    sendActions(actions, `${distance}m ${t('sendCommand')}`)
  }

  // 3초마다 실행할 polling 함수 (mapUrl 갱신 제외)
  const pollDeviceInfo = useCallback(async () => {
    try {
      const data = await deviceApis.getDeviceInfo(deviceId)
      if (!data) return
      const c = pollCacheRef.current

      const st = data.state?.stateUpdatedAt ?? null
      const conn = data.connection?.connectionUpdatedAt ?? null
      const tms = data.tms?.tmsUpdatedAt ?? null

      // 최상위 변경 없음 → 아무것도 갱신하지 않음 (불필요 리렌더 차단)
      if (data.updatedAt === c.updatedAt && st === c.st && conn === c.conn && tms === c.tms) return

      // 상단 정보(이름/배터리/상태/위치)는 변경 시 갱신
      setDeviceInfo({
        ...parseDeviceInfo(data),
        wifi: getWifiStatus(data.state)
      })
      setRobotDatas([parseRobotData(data)])

      // 업무 제어 버튼(시작/정지/일시정지/재개) 활성 조건용 taskFlows는 tms 갱신 시에만 갱신
      if (tms !== c.tms) {
        setTaskFlows(filterActiveTaskFlows(data?.tms?.taskFlowState?.taskFlows))
        c.tms = tms
      }

      // PartsStatusPanel/GKR·TOFU·ZeroGain 상태 배지용 robotState는 hw/sen/sw 타임스탬프 또는
      // gkrState/tofuState/zerogainState 값이 바뀐 경우에만 갱신
      const hwTs = data.state?.hwComponentsUpdatedAt ?? null
      const senTs = data.state?.sensorsUpdatedAt ?? null
      const swTs = data.state?.sWmodulesUpdatedAt ?? null
      const gkr = data.state?.gkrState ?? null
      const tofu = data.state?.tofuState ?? null
      const zeroGain = data.state?.zerogainState ?? null
      if (
        hwTs !== c.hwTs ||
        senTs !== c.senTs ||
        swTs !== c.swTs ||
        gkr !== c.gkr ||
        tofu !== c.tofu ||
        zeroGain !== c.zeroGain
      ) {
        setRobotState(data.state)
        c.hwTs = hwTs
        c.senTs = senTs
        c.swTs = swTs
        c.gkr = gkr
        c.tofu = tofu
        c.zeroGain = zeroGain
      }

      c.updatedAt = data.updatedAt
      c.st = st
      c.conn = conn

      // 지도(sitePosition) 갱신 — 기존과 동일
      const sp = data.state?.sitePosition
      const key = sitePosKey(sp)
      const provisionData = data.provision
      if (key && key !== prevSitePosRef.current && provisionData && !provisionData.isDefaultSite) {
        prevSitePosRef.current = key
        getMapUrl(provisionData, sp)
      }
    } catch (err) {
      console.error('Error pollDeviceInfo:', err)
    }
  }, [deviceId, getMapUrl])

  const handleLivePlay = () => {
    setIsLive(true)
    liveIntervalRef.current = setInterval(pollDeviceInfo, 1000)
  }

  const handleLiveStop = () => {
    setIsLive(false)
    if (liveIntervalRef.current) {
      clearInterval(liveIntervalRef.current)
      liveIntervalRef.current = null
    }
  }

  // 컴포넌트 언마운트 시 interval 정리
  useEffect(() => {
    return () => {
      if (liveIntervalRef.current) {
        clearInterval(liveIntervalRef.current)
      }
    }
  }, [])

  useEffect(() => {
    // 1. 초기 상태 동기화 : web -> android native
    const syncInitialChannel = () => {
      if (window.Android && typeof window.Android.getChannel === 'function') {
        const initialChannel = window.Android.getChannel()
        console.log('request current channel:', initialChannel) // "CLOUD" or "RF"
        setChannel(initialChannel)
        // 모바일(Android WebView)에서 접근한 경우 진입 시점부터 실시간(Live) 갱신 시작
        handleLivePlay()
      }
    }

    syncInitialChannel()

    // 2. 변경 이벤트 리스너 등록 : android native -> web
    window.TMS_NATIVE_EVENT = (jsonString) => {
      try {
        const data = JSON.parse(jsonString)
        console.log(`received current channel: ${JSON.stringify(data)}`) // {"channel":"CLOUD" or "RF"}
        setChannel(data.channel)
      } catch (error) {
        console.error('Failed to parse native event:', error)
      }
    }

    return () => {}
  }, [])

  const sendToAndroidNative = (message) => {
    // message 포맷 미정
    const payloadText = JSON.stringify(message)

    try {
      // 안드로이드 브릿지 (window.Android) 존재 여부 확인
      const webViewBridge = window.Android

      // 오직 postMessage 메서드만 사용하여 메시지 전송
      if (webViewBridge && typeof webViewBridge.postMessage === 'function') {
        webViewBridge.postMessage(payloadText)
        console.log('[TMS_CONTROL][SENT]', message)
        return true
      } else {
        console.error('[TMS_CONTROL][SEND_FAILED_BRIDGE_NOT_FOUND]')
      }
    } catch (error) {
      console.error('[TMS_CONTROL][SEND_ERROR] failed to send native message', error)
    }

    return false
  }

  return (
    <>
      <div className="flex flex-col gap-4">
        <NoUnderlineExpandable>
          <ExpandableSection
            iconPosition="left"
            header={
              <div>
                <span>{deviceInfo.name}</span>
                <span style={{ marginLeft: 5 }}>{t('assetInfo')}</span>
                <span style={{ marginLeft: 15 }}>MAC: {deviceInfo.mac}</span>
                {/* <span style={{ marginLeft: 5 }}>|</span>
              <span style={{ marginLeft: 5 }}>S/W: {deviceInfo.version}</span> */}
              </div>
            }
            expandedHeader={
              <div>
                <span>{deviceInfo.name}</span>
                <span style={{ marginLeft: 5 }}>{t('assetInfo')}</span>
              </div>
            }
          >
            <Section>
              <Table
                className="no-table-head"
                noTableHead
                dense
                columns={[
                  {
                    name: 'label1',
                    grow: 0,
                    width: '15%',
                    style: { backgroundColor: 'var(--t-table-head-bg)' },
                    cell: (row) => (
                      <div style={{ fontSize: '14px' }}>
                        <span>{row.label1}</span>
                      </div>
                    )
                  },
                  {
                    name: 'value1',
                    grow: 1,
                    cell: (row) => (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}>
                        <span>{row.value1}</span>
                        {row.editable1 && (
                          <EditButton type="button" onClick={openModalEditRobot}>
                            {t('modify')}
                          </EditButton>
                        )}
                      </div>
                    )
                  },
                  {
                    name: 'label2',
                    grow: 0,
                    width: '15%',
                    style: { backgroundColor: 'var(--t-table-head-bg)' },
                    cell: (row) => (
                      <div style={{ fontSize: '14px' }}>
                        <span>{row.label2}</span>
                      </div>
                    )
                  },
                  {
                    name: 'value2',
                    grow: 1,
                    cell: (row) => (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}>
                        <span>{row.value2}</span>
                        {row.editable2 && (
                          <EditButton type="button" onClick={openModalEditRobot}>
                            {t('modify')}
                          </EditButton>
                        )}
                      </div>
                    )
                  }
                ]}
                data={toPairedRows([
                  { label: t('robotName'), value: deviceInfo.name, editable: true },
                  { label: t('model'), value: deviceInfo.model ?? 'no model' },
                  {
                    label: t('group'),
                    value: deviceInfo.groupName ? deviceInfo.groupName : t('unassigned')
                  },
                  {
                    label: t('site'),
                    value: deviceInfo.siteName ? deviceInfo.siteName : t('unassigned')
                  },
                  { label: t('swVersion'), value: deviceInfo.version ?? '' },
                  {
                    label: 'Serial Number',
                    value: deviceInfo.serial ?? '',
                    copyable: true
                  },
                  {
                    label: 'MAC Address',
                    value: deviceInfo.mac ?? '',
                    copyable: true
                  },
                  {
                    label: t('registerDate'),
                    value: deviceInfo.registerDate ? toYmdHmKST(deviceInfo.registerDate) : '-'
                  }
                ])}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: '1rem' }}>
                <MajorActionButton onClick={handleDeleteClick}>
                  <Trash className="w-[14px] h-[14px]" /> {t('deleteRobot')}
                </MajorActionButton>
              </div>
            </Section>
          </ExpandableSection>
        </NoUnderlineExpandable>
        <Section gap="1rem">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <label className="typographyBody4" style={{ fontWeight: 'bold' }}>
                {t('statusSummary')}
              </label>{' '}
              {isLive ? (
                <StopButton style={{ maxHeight: '25px', marginLeft: '12px' }} onClick={handleLiveStop}>
                  <StopCircle className="w-[14px] h-[14px]" />

                  {t('stop')}
                </StopButton>
              ) : (
                <PlayButton style={{ maxHeight: '25px', marginLeft: '12px' }} onClick={handleLivePlay}>
                  <Play className="w-[14px] h-[14px]" />

                  {t('realtime')}
                </PlayButton>
              )}
              {isLive && <LiveSpan>Live</LiveSpan>}
            </div>
          </div>
          <SectionList>
            {[
              {
                icon: Battery,
                label: t('batterySocSoh'),
                value:
                  (deviceInfo.batterySoc ? deviceInfo.batterySoc + '%' : '-') +
                  ' / ' +
                  (deviceInfo.batterySoh ? deviceInfo.batterySoh + '%' : '-')
                //warn: robot.battery <= 30
              },
              {
                icon: Wifi,
                label: t('network'),
                value: t(deviceInfo.wifi?.label ?? 'noData'),
                warn: deviceInfo.wifi?.warn ?? false
              },
              {
                icon: OperationStatus,
                label: t('operateStatus'),
                value: getStatus(deviceInfo.state ?? '', 'text'),
                warn: deviceInfo.state == 'ERROR'
              },
              {
                icon: Clock,
                label: t('finalUpdate'),
                value: deviceInfo.deviceStateUpdatedAt ? toYmdHmKST(deviceInfo.deviceStateUpdatedAt) : '-',
                warn: false
              }
            ].map((item, index) => (
              <Section key={item.label ?? index} className="gap-1.5">
                <div className="mb-5" style={{ display: 'flex', alignItems: 'center' }}>
                  <item.icon />
                  <span className="ml-5" style={{ fontSize: '1.2rem' }}>
                    {item.label}
                  </span>
                </div>
                <span className={`ml-10 ${item.warn ? 'text-[#dc2626]' : 'text-[#333]'}`}>{item.value}</span>
              </Section>
            ))}
          </SectionList>
        </Section>
        {showMap && (
          <Section className="mt-8">
            <div>
              <label className="typographyBody4" style={{ fontWeight: 'bold' }}>
                {t('currentLocation')}
              </label>
              {isLive && <LiveSpan>Live</LiveSpan>}
            </div>
            <div className="mt-4">
              <SiteMap3D
                mapData={mapData}
                robotDatas={robotDatas}
                mapServer={mapServer}
                clickPoi // ← 추가
                onMovePoi={handleMoveLocation} // ← 추가 (기존 함수 그대로)
              />
            </div>
          </Section>
        )}
        <Section className="mt-8">
          <label className="typographyBody4" style={{ fontWeight: 'bold' }}>
            {t('magorAction')}
          </label>
          <div className="mt-5 flex flex-wrap gap-2 sm:gap-2.5">
            <MajorActionButton onClick={handleLogPlayClick}>
              <Play className="w-[14px] h-[14px]" /> {t('drivingLogReplay')}
            </MajorActionButton>
            <MajorActionButton onClick={handleClick}>
              <GamePad className="w-[14px] h-[14px]" /> {t('manipulationLogReplay')}
            </MajorActionButton>
            <MajorActionButton onClick={LogUploadRequestModal.onOpen}>{t('logUploadRequest')}</MajorActionButton>
          </div>
        </Section>
        <Section className="mt-8">
          <label className="typographyBody4" style={{ fontWeight: 'bold' }}>
            {t('robotControl')}
          </label>
          <div style={{ marginTop: '1.25rem' }}>
            <RobotControlPanel
              t={t}
              isOnline={isOnline}
              showMap={showMap}
              canStart={taskFlowControl.canStart}
              canStop={taskFlowControl.canStop}
              canPause={taskFlowControl.canPause}
              canResume={taskFlowControl.canResume}
              onAction={handleRobotAction}
              onRotate={handleRotate}
              onManualMove={handleManualMove}
              onMotion={handleMotion}
              onMoveLocation={MoveLocationModal.onOpen}
              gkrState={robotState?.gkrState}
              tofuState={robotState?.tofuState}
              zeroGainState={robotState?.zerogainState}
            />
          </div>
        </Section>
        <Section>
          <label className="typographyBody4" style={{ fontWeight: 'bold' }}>
            {t('recentErrorSummary')}
          </label>
          <div
            style={{ marginTop: '1.25rem', overflowX: 'auto', overflowY: 'hidden', WebkitOverflowScrolling: 'touch' }}
          >
            <div style={{ minWidth: 'min-content' }}>
              <Table
                columns={errorColumns}
                data={robotErrors}
                noData={tCommon('noData')}
                pagination
                paginationRowsPerPageOptions={[10, 30, 50, 100]}
              />
            </div>
          </div>
        </Section>
        <Section>
          <div>
            <label className="typographyBody4" style={{ fontWeight: 'bold' }}>
              {t('partsStatus')}
            </label>
            {isLive && <LiveSpan>Live</LiveSpan>}
          </div>
          <div style={{ marginTop: '1.25rem' }}>
            <PartsStatusPanel robotState={robotState} />
          </div>
        </Section>
      </div>

      <ModalEditRobot
        isOpen={EditRobotModal.isOpen}
        onClose={EditRobotModal.onClose}
        onConfirm={conformModalEditRobot}
        t={t}
        deviceId={deviceId}
        deviceInfo={deviceInfo}
      />
      <Modal
        isOpen={isConfirmModalOpen}
        size="xs"
        onClose={() => setIsConfirmModalOpen(false)}
        renderButtonComponent={
          <div style={{ display: 'flex', gap: '1rem', width: '100%', justifyContent: 'center' }}>
            <Button variant="contained" theme="primary" onClick={conformModal}>
              {t('confirm')}
            </Button>
          </div>
        }
      >
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <p className="typographyBody2" style={{ whiteSpace: 'pre-wrap', textAlign: 'center' }}>
            {confirmMessage}
          </p>
        </div>
      </Modal>
      <ModalMoveLocation
        isOpen={MoveLocationModal.isOpen}
        onClose={MoveLocationModal.onClose}
        onConfirm={handleMoveLocation}
        mapServer={mapServer}
        t={t}
        lang={i18n.language}
      />
      <ModalSelectTaskFlow
        isOpen={SelectTaskFlowModal.isOpen}
        onClose={SelectTaskFlowModal.onClose}
        onConfirm={handleStartTaskFlow}
        taskFlows={taskFlows}
        t={t}
      />
      <ModalLogUploadRequest
        isOpen={LogUploadRequestModal.isOpen}
        onClose={LogUploadRequestModal.onClose}
        onConfirm={handleLogUploadRequest}
        deviceInfo={deviceInfo}
        t={t}
      />
      <Modal
        isOpen={DeleteRobotModal.isOpen}
        title={t('robotDeleteConfirm')}
        onClose={DeleteRobotModal.onClose}
        closeButton
        renderButtonComponent={
          <div style={{ display: 'flex', gap: '1rem', width: '100%', justifyContent: 'center' }}>
            <Button variant="contained" theme="tertiary" onClick={DeleteRobotModal.onClose}>
              {t('cancel')}
            </Button>
            <Button variant="contained" theme="primary" onClick={handleDeleteDevice}>
              {t('delete')}
            </Button>
          </div>
        }
      >
        <div style={{ maxHeight: '400px' }}>
          <p className="typographyBody4" style={{ whiteSpace: 'pre-wrap', marginBottom: '2rem' }}>
            {t('robotDeleteMessage')}
          </p>
          <p className="typographyBody3" style={{ whiteSpace: 'pre-wrap', marginLeft: '10px' }}>
            {deviceInfo.name}
          </p>
        </div>
      </Modal>
    </>
  )
}

export default AssetInfo
