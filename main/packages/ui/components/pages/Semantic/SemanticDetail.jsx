import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Section, SectionTitle, Button, Input, Dropdown, IconButton, Icon } from '@repo/ui'
import { generateUuid36 } from '@repo/utils'
import { ButtonWrapper, DetailHeader, DetailWrapper, FieldGrid, MetaText, PropertyRow } from './styles'

const DEG2RAD = Math.PI / 180
const RAD2DEG = 180 / Math.PI
const round6 = (n) => Math.round(n * 1e6) / 1e6
// yaw(도) → Z축 회전 쿼터니언 (REP-103; init-setup tf.js 의 yawOf 와 동일 규약)
const yawDegToQuaternion = (deg) => {
  const half = ((Number(deg) || 0) * DEG2RAD) / 2
  return { x: 0, y: 0, z: round6(Math.sin(half)), w: round6(Math.cos(half)) }
}

/**
 * 로봇 현재 위치를 폼의 좌표 필드 모양으로 바꾼다 — { yawDeg, position, orientation }.
 *
 * yaw 는 rad 로 들어오므로 도(度)로 바꿔 넣고, orientation 은 다른 입력과 같은 경로로 yaw 에서
 * 파생시킨다. z 는 TF 합성 결과에 없으므로(2D 주행) 값이 있을 때만 넣는다.
 */
const poseFieldsFrom = (robotPose) => {
  const yawDeg = round6((Number(robotPose.yaw) || 0) * RAD2DEG)
  return {
    yawDeg,
    position: {
      x: round6(Number(robotPose.x) || 0),
      y: round6(Number(robotPose.y) || 0),
      ...(Number.isFinite(robotPose.z) ? { z: round6(robotPose.z) } : {})
    },
    orientation: yawDegToQuaternion(yawDeg)
  }
}

/**
 * @param {object|null} [robotPose] 로봇 현재 위치 { x, y, yaw(rad), z? } — 지도와 같은 프레임이어야 한다.
 *   주입한 쪽이 프레임을 확인해서 넘긴다(init-setup 은 map 프레임일 때만 넘긴다).
 *   있으면 Position 에 '현재 위치로 설정' 버튼이 열리고, initialPose 가 없으면 새 POI 는 이 좌표로
 *   시작한다.
 * @param {object|null} [initialPose] 지도에서 직접 찍은 좌표 { x, y, yaw(rad)? } — robotPose 와 같은
 *   프레임이어야 한다. 있으면 새 POI 는 로봇 현재 위치 대신 이 좌표로 시작한다(사용자가 지도에서
 *   짚은 지점이 로봇 위치보다 우선한다). '현재 위치로 설정' 버튼은 그대로 robotPose 를 쓴다 —
 *   지도에서 찍은 뒤에도 로봇 위치로 바꿔 넣을 수 있어야 한다.
 */
/** 이름 입력 칸들 — 기본 / 영문 / 한글. 하나라도 채워져야 저장할 수 있다(아래 hasAnyName). */
const NAME_LANGS = ['default', 'en-US', 'ko-KR']

const SemanticDetail = ({
  row,
  readOnly = false,
  robotPose = null,
  initialPose = null,
  onPoiCreated,
  onPoiEdited,
  onPoiCancel
}) => {
  // POI 타입은 BE 에 저장되는 값이므로 번역하지 않는다(표시 문자열이 곧 저장 값이다).
  const POI_TYPES = ['GENERAL', 'CHARGING']

  const { t } = useTranslation('semantic')
  const { t: tCommon } = useTranslation('common')

  const [loading, setLoading] = useState(false)
  const [workObj, setWorkObj] = useState(null)
  // properties 편집용 로컬 배열. key 이름 변경/추가/삭제를 다루기 쉽게 배열로 들고,
  // 저장 시점의 workObj.properties(객체)로는 syncProperties 가 직렬화한다.
  const [propEntries, setPropEntries] = useState([])

  const handlePoiCreate = () => {
    const retObj = { ...workObj }
    retObj.editStatus.needToSave = true
    retObj.editStatus.created = true
    onPoiCreated(retObj)
  }

  const handlePoiEdit = () => {
    console.log('handlePoiEdit')
    const retObj = { ...workObj }
    retObj.editStatus.needToSave = true
    retObj.editStatus.edited = true
    onPoiEdited(retObj)
  }

  const handleTypeChange = (value) => {
    setWorkObj((prev) => ({
      ...prev,
      type: value
    }))
  }

  const handleNameChange = (lang, value) => {
    const newName = { ...workObj.name }
    newName[lang] = value
    setWorkObj((prev) => ({
      ...prev,
      name: newName
    }))
  }

  const handlePosChange = (axis, value) => {
    const newPose = { ...workObj.pose }
    const floatValue = value === '' ? '' : parseFloat(value)
    newPose.position[axis] = floatValue
    setWorkObj((prev) => ({
      ...prev,
      pose: newPose
    }))
  }

  /**
   * 로봇이 지금 서 있는 자리를 POI 좌표로 그대로 넣는다 — 로봇을 원하는 지점에 세워 두고
   * 이 버튼을 누르는 것이 좌표를 손으로 입력하는 것보다 정확하다.
   * 새 POI 는 폼이 열릴 때 이미 이 좌표로 채워지므로(아래 마운트 effect), 이 버튼은
   * 그 뒤에 로봇을 옮겼을 때 다시 가져오는 용도다.
   */
  const handleUseRobotPose = () => {
    if (!robotPose) return
    const fields = poseFieldsFrom(robotPose)
    setWorkObj((prev) => ({
      ...prev,
      yawDeg: fields.yawDeg,
      pose: {
        ...prev.pose,
        // z 가 없는 pose 면 이전 값을 남긴다(2D 주행에서는 TF 에 z 가 없다).
        position: { ...prev.pose?.position, ...fields.position },
        orientation: fields.orientation
      }
    }))
  }

  const handleYawDegChange = (value) => {
    const floatValue = value === '' ? '' : parseFloat(value)
    setWorkObj((prev) => ({
      ...prev,
      yawDeg: floatValue,
      // orientation 은 사용자가 직접 입력하지 않고 yaw 로부터 파생한다.
      pose: { ...prev.pose, orientation: yawDegToQuaternion(floatValue === '' ? 0 : floatValue) }
    }))
  }

  const handleToleranceChange = (value) => {
    const floatValue = value === '' ? '' : parseFloat(value)
    setWorkObj((prev) => ({
      ...prev,
      tolerance: floatValue
    }))
  }

  // 편집 배열 → properties 객체(string 값). 빈 key 는 제외, 중복 key 는 나중 값이 우선.
  const syncProperties = (entries) => {
    const obj = {}
    entries.forEach(({ key, value }) => {
      const k = key.trim()
      if (k) obj[k] = value
    })
    setWorkObj((prev) => ({
      ...prev,
      properties: obj
    }))
  }

  const handlePropKeyChange = (poiId, key) => {
    const next = propEntries.map((e) => (e.poiId === poiId ? { ...e, key } : e))
    setPropEntries(next)
    syncProperties(next)
  }

  const handlePropValueChange = (poiId, value) => {
    const next = propEntries.map((e) => (e.poiId === poiId ? { ...e, value } : e))
    setPropEntries(next)
    syncProperties(next)
  }

  const handleAddProp = () => {
    if (propEntries.length >= 5) return
    setPropEntries((prev) => [...prev, { poiId: generateUuid36(), key: '', value: '' }])
  }

  const handleRemoveProp = (poiId) => {
    const next = propEntries.filter((e) => e.poiId !== poiId)
    setPropEntries(next)
    syncProperties(next)
  }

  useEffect(() => {
    if (row) {
      const tempObj = { ...row }
      if (!tempObj.properties) tempObj.properties = {}
      setWorkObj(tempObj)
      setPropEntries(
        Object.entries(tempObj.properties).map(([key, value]) => ({
          poiId: generateUuid36(),
          key,
          value: String(value)
        }))
      )
    } else {
      const tempObj = {}
      tempObj.poiId = generateUuid36()
      tempObj.type = 'GENERAL'
      tempObj.name = {}
      tempObj.name['default'] = ''
      tempObj.name['ko-KR'] = ''
      tempObj.name['en-US'] = ''
      // 새 POI 는 지도에서 직접 짚은 자리(initialPose)가 있으면 그 좌표로, 없으면 로봇이 지금
      // 서 있는 자리(robotPose)로 시작한다 — 지도를 짚어 여기에 POI 를 두겠다고 정한 지점이
      // 로봇의 지금 위치보다 우선한다. 둘 다 없으면 원점에서 시작하고 손으로 채운다.
      const poseSource = initialPose ?? robotPose
      const poseFields = poseSource ? poseFieldsFrom(poseSource) : null
      tempObj.pose = {}
      tempObj.pose.position = {
        x: 0.0,
        y: 0.0,
        z: 0.0,
        ...(poseFields?.position ?? {})
      }
      tempObj.yawDeg = poseFields?.yawDeg ?? 0.0
      // orientation 은 yaw 에서 파생한다(yaw 0 이면 { x:0, y:0, z:0, w:1 }).
      tempObj.pose.orientation = poseFields?.orientation ?? yawDegToQuaternion(0)
      tempObj.properties = {}
      tempObj.editStatus = {}
      setWorkObj(tempObj)
    }
    setLoading(true)
  }, [])

  // 이름 세 칸이 모두 비어 있으면 저장을 막는다 — 목록과 지도 말풍선에서 POI 를 가리키는 것은
  // 이름뿐이라(SemanticTable / init-setup 의 poiLabel), 이름 없이 저장하면 어느 지점인지 구분할 수
  // 없는 POI 가 남는다. 공백만 넣은 경우도 비어 있는 것으로 본다.
  const hasAnyName = NAME_LANGS.some((lang) => String(workObj?.name?.[lang] ?? '').trim() !== '')

  return (
    loading && (
      <Section>
        <DetailWrapper key={workObj.id}>
          {/* 상단: 제목만. 액션 버튼(생성/수정/취소)은 폼 아래에 둔다 — 필드를 다 채운 다음
              누르는 순서라 시선이 위로 되돌아가지 않는 편이 낫다(아래 ButtonWrapper).
              제목만 남았으므로 Section 으로 감싸지 않는다 — 카드 안에 제목 한 줄만 있는 모양이 된다. */}
          <DetailHeader>
            <SectionTitle title={readOnly ? t('detailTitleReadOnly') : t('detailTitle')} />
          </DetailHeader>

          {/* 기본 정보 */}
          <Section gap="1.2rem">
            <SectionTitle title={t('basicInfo')} />
            <Dropdown
              label={t('poiType')}
              size="md"
              value={workObj.type}
              options={POI_TYPES.map((type) => ({ name: type, value: type }))}
              onChange={(value) => handleTypeChange(value)}
              disabled={readOnly}
            />
            <Input
              label={t('nameDefault')}
              size="md"
              readOnly={readOnly}
              value={workObj.name?.default || ''}
              onChange={(e) => handleNameChange('default', e.target.value)}
            />
            <FieldGrid>
              <Input
                label={t('nameEn')}
                size="md"
                readOnly={readOnly}
                value={workObj.name?.['en-US'] || ''}
                onChange={(e) => handleNameChange('en-US', e.target.value)}
              />
              <Input
                label={t('nameKo')}
                size="md"
                readOnly={readOnly}
                value={workObj.name?.['ko-KR'] || ''}
                onChange={(e) => handleNameChange('ko-KR', e.target.value)}
              />
            </FieldGrid>
          </Section>

          {/* Position — 좌표 직접 입력, 또는 로봇이 서 있는 자리를 그대로 가져오기 */}
          <Section gap="1.2rem">
            <SectionTitle title={t('position')}>
              {!readOnly && (
                <Button
                  size="md"
                  onClick={handleUseRobotPose}
                  disabled={!robotPose}
                  title={robotPose ? undefined : t('useRobotPoseUnavailable')}
                >
                  {t('useRobotPose')}
                </Button>
              )}
            </SectionTitle>
            <FieldGrid>
              {['x', 'y', 'z'].map((axis) => (
                <Input
                  key={axis}
                  label={axis.toUpperCase()}
                  type="number"
                  step="0.001"
                  size="md"
                  readOnly={readOnly}
                  value={workObj.pose?.position?.[axis] ?? ''}
                  onChange={(e) => handlePosChange(axis, e.target.value)}
                />
              ))}
            </FieldGrid>
          </Section>

          {/* Orientation */}
          <Section gap="1.2rem">
            <SectionTitle title={t('orientation')} />
            <MetaText>{t('orientationFromYaw')}</MetaText>
            <FieldGrid>
              {['x', 'y', 'z', 'w'].map((axis) => (
                <Input
                  key={axis}
                  label={axis.toUpperCase()}
                  type="number"
                  step="0.001"
                  size="md"
                  readOnly
                  value={workObj.pose?.orientation?.[axis] ?? ''}
                />
              ))}
            </FieldGrid>
          </Section>

          {/* 기타 */}
          <Section gap="1.2rem">
            <SectionTitle title={t('etc')} />
            <FieldGrid>
              <Input
                label={t('yawDeg')}
                type="number"
                step="0.001"
                unit="°"
                size="md"
                readOnly={readOnly}
                value={workObj.yawDeg ?? 0.0}
                onChange={(e) => handleYawDegChange(e.target.value)}
              />
              <Input
                label={t('tolerance')}
                type="number"
                step="0.001"
                size="md"
                readOnly={readOnly}
                value={workObj.tolerance ?? 0.0}
                onChange={(e) => handleToleranceChange(e.target.value)}
              />
            </FieldGrid>
          </Section>

          {/* Properties (사용자 정의 key/value, string 값, 최대 5개) */}
          <Section gap="1.2rem">
            <SectionTitle title={t('properties')}>
              {!readOnly && (
                <IconButton size="sm" onClick={handleAddProp} disabled={propEntries.length >= 5}>
                  <Icon name="add" size={18} />
                </IconButton>
              )}
            </SectionTitle>
            {!readOnly && <MetaText>{t('propertiesHint')}</MetaText>}
            {propEntries.map((entry) => (
              <PropertyRow key={entry.poiId}>
                <div className="field">
                  <Input
                    size="sm"
                    placeholder={t('propertyKey')}
                    readOnly={readOnly}
                    value={entry.key}
                    onChange={(e) => handlePropKeyChange(entry.poiId, e.target.value)}
                  />
                </div>
                <div className="field">
                  <Input
                    size="sm"
                    placeholder={t('propertyValue')}
                    readOnly={readOnly}
                    value={entry.value}
                    onChange={(e) => handlePropValueChange(entry.poiId, e.target.value)}
                  />
                </div>
                {!readOnly && (
                  <IconButton size="sm" onClick={() => handleRemoveProp(entry.poiId)}>
                    <Icon name="subtract" size={18} />
                  </IconButton>
                )}
              </PropertyRow>
            ))}
          </Section>

          {/* 액션 버튼 — 폼 맨 아래(오른쪽 정렬). 목록의 저장/취소와 같은 ButtonWrapper 를 쓴다. */}
          <ButtonWrapper>
            {readOnly ? (
              <Button size="md" theme="tertiary" onClick={onPoiCancel}>
                {tCommon('close')}
              </Button>
            ) : (
              <>
                {/* 이름이 하나도 없으면 둘 다 잠근다(hasAnyName) — 비활성 버튼은 이유를 말하지 못하므로
                    title 로 무엇을 채워야 하는지 알려 준다.
                    새 POI 의 버튼은 '생성' 이 아니라 '저장' 이다 — 목록의 생성 버튼(SemanticTable)이
                    이 폼을 여는 동작이고, 여기서 누르는 것은 채운 내용을 확정하는 것이다. */}
                {row ? (
                  <Button
                    size="md"
                    onClick={handlePoiEdit}
                    disabled={!hasAnyName}
                    title={hasAnyName ? undefined : t('nameRequired')}
                  >
                    {t('edit')}
                  </Button>
                ) : (
                  <Button
                    size="md"
                    onClick={handlePoiCreate}
                    disabled={!hasAnyName}
                    title={hasAnyName ? undefined : t('nameRequired')}
                  >
                    {t('save')}
                  </Button>
                )}
                <Button size="md" theme="tertiary" onClick={onPoiCancel}>
                  {tCommon('cancel')}
                </Button>
              </>
            )}
          </ButtonWrapper>
        </DetailWrapper>
      </Section>
    )
  )
}

export default SemanticDetail
