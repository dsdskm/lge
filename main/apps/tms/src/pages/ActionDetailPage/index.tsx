import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button, Checkbox, Icon, Title } from '@repo/ui'
import { toast } from 'react-toastify'
import { useOrganizationStore } from '@repo/stores'
import { TOTAL_GROUP_ID } from '@/common/constants'
import { useDeleteAction, useGetAction, useSaveAction } from '@/api/actionApis'
import { useActionOrgLabel } from '@/pages/hooks/useActionOrgLabel'
import ConfirmModal from '@/pages/components/modal/ConfirmModal'
import {
  ACTION_CAPABILITIES,
  ACTION_CONTENT_TARGET_NONE,
  ACTION_CONTENT_TARGETS,
  ACTION_PARAM_TYPES,
  ACTION_STATUSES,
  CAPABILITY_COLOR,
  MANAGED_TASK_TYPES,
  capabilityColor,
  capabilityIcon,
  type Action,
  type ActionCapability,
  type ActionDraft,
  type ActionParam,
  type ActionParamType,
  type ActionStatus
} from '@/types/action'
import {
  BooleanText,
  CapabilityChip,
  Card,
  CardBody,
  CardHeader,
  CardHeaderRight,
  CapabilityIconBox,
  CardTitle,
  ChipGroup,
  ChipRow,
  Container,
  CountBadge,
  DragHandle,
  EmptyText,
  Field,
  FieldLabel,
  FormGrid,
  Header,
  HeaderButtonGroup,
  HeaderLeft,
  PageMessage,
  ParamListTable,
  ParamRow,
  ParamTable,
  ReadOnlyValue,
  RequiredCheckLabel,
  RequiredText,
  RowDeleteButton,
  SectionBadge,
  SelectInput,
  TextInput,
  TypeChip,
  TypeText
} from './styles'

/** 신규 추가 진입 경로(/tms/actions/new/detail)의 파라미터 값 */
const NEW_ACTION_PARAM = 'new'

/** OrganizationSelector 의 미지정 값. 조회·생성 파라미터로는 쓸 수 없다. */
const ORG_NONE = 'none'

/**
 * 삭제할 수 있는 상태.
 *
 * DEPRECATED 는 더 이상 쓰지 않기로 표시된 Task 이므로 정리(삭제) 대상이다.
 * ACTIVE·INACTIVE 는 Task Flow 에서 쓰이고 있을 수 있어 막는다.
 * (서버 Task 에 생성자 정보가 없어 "만든 사람만 삭제" 같은 제약은 걸 수 없다)
 */
const DELETABLE_STATUS: ActionStatus = 'DEPRECATED'

function makeParamUid() {
  return `param-${crypto.randomUUID()}`
}

/**
 * 신규 Task 의 생성 위치. 목록 화면에서 고른 그룹/사이트를 그대로 쓴다.
 * 'none'(미지정)으로는 만들 수 없으므로 'all'(공용)로 낮춘다.
 */
function toCreateOrg(value?: string | null): string {
  if (!value || value === ORG_NONE) return TOTAL_GROUP_ID
  return value
}

function emptyDraft(groupId: string, siteId: string): ActionDraft {
  return {
    groupId,
    siteId,
    name: '',
    taskType: 'ACTION',
    capability: null,
    robotSkillId: null,
    description: '',
    builtIn: false,
    // contentTarget 은 content_reference 파라미터에서 유도되는 값이라 직접 편집하지 않는다.
    contentTarget: 'NONE',
    version: '1.0.0',
    minExecVer: '1.0.0',
    isDeployable: true,
    status: 'ACTIVE',
    inputs: [],
    outputs: []
  }
}

/**
 * 타입 옆에 덧붙일 보조 정보.
 *  - content_reference → 연동 콘텐츠 종류(POI, FACE:VIDEO 등)
 *  - array            → 요소 타입
 * 둘 다 서버 propertySchema 의 원본 필드(content_type / item_type)에서 온다.
 */
function paramTypeDetail(param: ActionParam): string | null {
  if (param.type === 'content_reference') return param.contentType || null
  if (param.type === 'array' && param.itemType) return `${param.itemType}[]`
  return null
}

/**
 * 파라미터 타입 선택지.
 *
 * 출력(BT output port)은 콘텐츠를 참조하지 않으므로 content_reference 를 뺀다.
 * 단, 서버에 이미 그런 값이 들어 있는 경우 선택이 비어 보이지 않도록 현재 값은 남긴다.
 */
function typeOptionsFor(kind: 'inputs' | 'outputs', current: ActionParamType): ActionParamType[] {
  if (kind === 'inputs') return [...ACTION_PARAM_TYPES]

  const options = ACTION_PARAM_TYPES.filter((type) => type !== 'content_reference')
  return options.includes(current) ? options : [current, ...options]
}

/** 서버가 속성별로 주는 설명. 표에 그대로 보여준다. */
function paramDescription(param: ActionParam): string {
  const description = param.raw?.description
  return typeof description === 'string' ? description : ''
}

/** boolean/number 기본값을 표에서 눈에 띄게 그린다(목업의 true 초록 표기). */
function DefaultValueCell({ param }: { param: ActionParam }) {
  const value = param.defaultValue?.trim()
  if (!value) return <>—</>
  if (param.type === 'bool') return <BooleanText>{value}</BooleanText>
  return <>{value}</>
}

export default function ActionDetailPage() {
  const { t } = useTranslation(['tms', 'common'])
  const navigate = useNavigate()
  const { actionId: actionIdParam } = useParams()

  const isNew = actionIdParam === NEW_ACTION_PARAM
  const actionId = Number(actionIdParam)

  // 신규 생성 위치. OrganizationSelector 가 이 스토어를 공유하므로
  // 목록 화면에서 고른 값이 그대로 들어온다.
  const { selectedOrgs } = useOrganizationStore()
  const createGroupId = toCreateOrg(selectedOrgs?.[0])
  const createSiteId = toCreateOrg(selectedOrgs?.[1])
  const actionOrgLabel = useActionOrgLabel()

  const { data: action, isLoading } = useGetAction(isNew ? -1 : actionId)
  const { mutateAsync: saveAction, isPending: isSaving } = useSaveAction()
  const { mutateAsync: deleteAction, isPending: isDeleting } = useDeleteAction()

  // 신규는 처음부터 편집 모드, 기존은 보기 모드로 시작한다.
  const [editing, setEditing] = useState(isNew)
  const [draft, setDraft] = useState<ActionDraft>(() => emptyDraft(createGroupId, createSiteId))
  const [deleteOpen, setDeleteOpen] = useState(false)

  // 편집 시작 시점의 값을 draft 로 복사한다(취소하면 그대로 버린다).
  useEffect(() => {
    if (isNew) {
      setDraft(emptyDraft(createGroupId, createSiteId))
      return
    }
    if (action) setDraft({ ...action, inputs: [...action.inputs], outputs: [...action.outputs] })
  }, [isNew, action, createGroupId, createSiteId])

  const viewModel: Action | ActionDraft | undefined = editing ? draft : action
  // skill 이 지정되지 않은 Task 가 많아 capability 는 null 일 수 있다.
  const capability = viewModel?.capability ?? null
  const color = capabilityColor(capability)

  const orgLabel = actionOrgLabel(viewModel?.groupId, viewModel?.siteId)
  // 편집 중인 draft 가 아니라 저장된 값으로 판단한다(상태를 바꿔 저장하기 전에는 삭제할 수 없다).
  const canDelete = action?.status === DELETABLE_STATUS

  // 연동 콘텐츠 선택지. 'NONE' 은 파라미터 단위에서는 의미가 없어 뺀다.
  const contentTypeOptions = useMemo(
    () => ACTION_CONTENT_TARGETS.filter((target) => target !== ACTION_CONTENT_TARGET_NONE),
    []
  )

  const updateDraft = (patch: Partial<ActionDraft>) => setDraft((prev) => ({ ...prev, ...patch }))

  const updateParam = (kind: 'inputs' | 'outputs', uid: string, patch: Partial<ActionParam>) => {
    setDraft((prev) => ({
      ...prev,
      [kind]: prev[kind].map((param) => (param.uid === uid ? { ...param, ...patch } : param))
    }))
  }

  const addParam = (kind: 'inputs' | 'outputs') => {
    setDraft((prev) => ({
      ...prev,
      [kind]: [
        ...prev[kind],
        {
          uid: makeParamUid(),
          name: '',
          type: 'string' as ActionParamType,
          required: false,
          // BT 의 input/output port 구분이 그대로 서버 direction 이 된다.
          direction: kind === 'inputs' ? ('in' as const) : ('out' as const)
        }
      ]
    }))
  }

  const removeParam = (kind: 'inputs' | 'outputs', uid: string) => {
    setDraft((prev) => ({ ...prev, [kind]: prev[kind].filter((param) => param.uid !== uid) }))
  }

  const handleCancel = () => {
    if (isNew) {
      navigate('/tms/actions')
      return
    }
    // 편집 내용을 버리고 저장된 값으로 되돌린다.
    if (action) setDraft({ ...action, inputs: [...action.inputs], outputs: [...action.outputs] })
    setEditing(false)
  }

  const handleSave = async () => {
    if (!draft.name.trim() || !draft.version.trim()) {
      toast.warning(t('action.requiredFieldMissing'), { autoClose: 2000 })
      return
    }
    // 이름 없는 파라미터는 저장 대상에서 뺀다(행만 추가하고 비워둔 경우).
    const cleaned: ActionDraft = {
      ...draft,
      name: draft.name.trim(),
      version: draft.version.trim(),
      inputs: draft.inputs.filter((param) => param.name.trim()),
      outputs: draft.outputs.filter((param) => param.name.trim())
    }

    try {
      const saved = await saveAction(cleaned)
      toast.info(t('action.saved'), { autoClose: 2000 })
      if (isNew) {
        navigate(`/tms/actions/${saved.id}/detail`, { replace: true })
        return
      }
      setEditing(false)
    } catch (error) {
      console.error('Action 저장 실패', error)
      toast.warning(t('action.saveFailed'), { autoClose: 2000 })
    }
  }

  const handleDelete = async () => {
    try {
      await deleteAction(actionId)
      setDeleteOpen(false)
      toast.info(t('action.deleted'), { autoClose: 2000 })
      navigate('/tms/actions', { replace: true })
    } catch (error) {
      console.error('Action 삭제 실패', error)
      setDeleteOpen(false)
      toast.warning(t('action.deleteFailed'), { autoClose: 2000 })
    }
  }

  if (!isNew && isLoading) {
    return (
      <Container>
        <PageMessage>{t('common:loading', { defaultValue: 'Loading...' })}</PageMessage>
      </Container>
    )
  }

  if (!isNew && !action) {
    return (
      <Container>
        <PageMessage>{t('action.notFound')}</PageMessage>
      </Container>
    )
  }

  const renderParamTable = (params: ActionParam[], kind: 'inputs' | 'outputs') => {
    if (params.length === 0) return <EmptyText>{t('action.noParams')}</EmptyText>

    return (
      // 모바일에서는 열이 사라지고 각 td 의 data-label 이 앞에 붙는다(ParamListTable 참고).
      <ParamListTable>
        <thead>
          <tr>
            <th>{t('action.param')}</th>
            <th>{t('action.type')}</th>
            {kind === 'inputs' && <th>{t('action.defaultValue')}</th>}
            {kind === 'inputs' && <th>{t('action.required')}</th>}
            <th>{t('action.paramDescription')}</th>
          </tr>
        </thead>
        <tbody>
          {params.map((param) => (
            <tr key={param.uid}>
              <td data-label={t('action.param')}>{param.name}</td>
              <td data-label={t('action.type')}>
                {/*
                  content_reference 는 "어떤 콘텐츠인지"가 실제 정보다(MoveTo→POI, PlayFace→FACE:VIDEO).
                  array 는 요소 타입을 함께 보여준다. 괄호로 덧붙인다.
                */}
                <TypeText>
                  {param.type}
                  {paramTypeDetail(param) ? ` (${paramTypeDetail(param)})` : ''}
                </TypeText>
              </td>
              {kind === 'inputs' && (
                <td data-label={t('action.defaultValue')}>
                  <DefaultValueCell param={param} />
                </td>
              )}
              {kind === 'inputs' && (
                <td data-label={t('action.required')}>
                  <RequiredText $required={param.required}>
                    {param.required ? t('action.requiredMark') : t('action.optionalMark')}
                  </RequiredText>
                </td>
              )}
              <td data-label={t('action.paramDescription')}>
                <ChipGroup>
                  {paramDescription(param)}
                  {param.internal && <TypeChip>{t('action.internalParam')}</TypeChip>}
                </ChipGroup>
              </td>
            </tr>
          ))}
        </tbody>
      </ParamListTable>
    )
  }

  const renderParamEditor = (params: ActionParam[], kind: 'inputs' | 'outputs') => (
    <CardBody>
      {params.length === 0 && <EmptyText>{t('action.noParams')}</EmptyText>}
      {params.map((param) => (
        <ParamRow key={param.uid}>
          <DragHandle title={t('action.reorderHint')}>
            <Icon name="reorder" size={16} color="#cbd5e1" />
          </DragHandle>

          <TextInput
            value={param.name}
            placeholder={t('action.param')}
            onChange={(event) => updateParam(kind, param.uid, { name: event.target.value })}
          />

          <SelectInput
            value={param.type}
            onChange={(event) => updateParam(kind, param.uid, { type: event.target.value as ActionParamType })}
          >
            {typeOptionsFor(kind, param.type).map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </SelectInput>

          {/*
            타입 상세 열. 타입에 따라 입력이 달라진다.
              content_reference → 연동 콘텐츠 종류(content_type)
              array             → 요소 타입(item_type)
            그 외 타입에서는 빈 칸으로 두어 행 정렬을 유지한다.
          */}
          {param.type === 'content_reference' ? (
            <SelectInput
              value={param.contentType ?? ''}
              onChange={(event) => updateParam(kind, param.uid, { contentType: event.target.value })}
            >
              <option value="">{t('action.selectContentType')}</option>
              {contentTypeOptions.map((contentType) => (
                <option key={contentType} value={contentType}>
                  {contentType}
                </option>
              ))}
            </SelectInput>
          ) : param.type === 'array' ? (
            <TextInput
              value={param.itemType ?? ''}
              placeholder={t('action.itemType')}
              onChange={(event) => updateParam(kind, param.uid, { itemType: event.target.value })}
            />
          ) : (
            <span />
          )}

          <TextInput
            value={param.defaultValue ?? ''}
            placeholder={t('action.defaultValue')}
            onChange={(event) => updateParam(kind, param.uid, { defaultValue: event.target.value })}
          />

          {kind === 'inputs' ? (
            <RequiredCheckLabel>
              <Checkbox
                checked={!!param.required}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                  updateParam(kind, param.uid, { required: event.target.checked })
                }
              />
              {t('action.required')}
            </RequiredCheckLabel>
          ) : (
            <span />
          )}

          <RowDeleteButton
            type="button"
            onClick={() => removeParam(kind, param.uid)}
            aria-label={t('action.removeParam')}
            title={t('action.removeParam')}
          >
            <Icon name="close" size={16} />
          </RowDeleteButton>
        </ParamRow>
      ))}
    </CardBody>
  )

  return (
    <Container>
      <Header>
        <HeaderLeft>
          {/* 아이콘·뱃지는 기본 정보 영역에서 보여준다. 타이틀에는 이름만 둔다. */}
          <Title onBack={() => navigate('/tms/actions')}>{isNew ? t('action.createTitle') : viewModel?.name}</Title>
        </HeaderLeft>

        <HeaderButtonGroup>
          {editing ? (
            <>
              <Button theme="secondary" type="button" onClick={handleCancel} disabled={isSaving}>
                {t('common:cancel')}
              </Button>
              <Button theme="primary" type="button" onClick={handleSave} disabled={isSaving}>
                <Icon name="check" size={18} />
                {isSaving ? t('action.saving') : t('common:save')}
              </Button>
            </>
          ) : (
            <>
              <Button theme="secondary" type="button" onClick={() => setEditing(true)}>
                <Icon name="edit" size={18} />
                {t('detail.edit')}
              </Button>
              <Button
                theme="delete"
                type="button"
                onClick={() => setDeleteOpen(true)}
                disabled={!canDelete || isDeleting}
                title={canDelete ? undefined : t('action.deleteDisabledHint')}
              >
                <Icon name="delete" size={18} />
                {isDeleting ? t('action.deleting') : t('actions.delete')}
              </Button>
            </>
          )}
        </HeaderButtonGroup>
      </Header>

      <ConfirmModal
        open={deleteOpen}
        title={t('action.deleteConfirmTitle')}
        description={t('action.deleteConfirmDesc', { name: action?.name ?? '' })}
        confirmVariant="danger"
        confirmDisabled={isDeleting}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
      />

      {/* 기본 정보 */}
      {editing ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('action.basicInfo')}</CardTitle>
          </CardHeader>
          <CardBody>
            <FormGrid>
              <Field>
                <FieldLabel>
                  {t('action.name')}
                  <span className="required">*</span>
                </FieldLabel>
                <TextInput
                  value={draft.name}
                  placeholder="MoveTo"
                  onChange={(event) => updateDraft({ name: event.target.value })}
                />
              </Field>

              <Field>
                <FieldLabel>
                  {t('action.version')}
                  <span className="required">*</span>
                </FieldLabel>
                <TextInput
                  value={draft.version}
                  placeholder="1.0.0"
                  onChange={(event) => updateDraft({ version: event.target.value })}
                />
              </Field>

              <Field>
                <FieldLabel>{t('action.taskType')}</FieldLabel>
                <ChipRow>
                  {MANAGED_TASK_TYPES.map((item) => (
                    <CapabilityChip
                      key={item}
                      type="button"
                      $active={draft.taskType === item}
                      $color="#64748b"
                      onClick={() => updateDraft({ taskType: item })}
                    >
                      {item}
                    </CapabilityChip>
                  ))}
                </ChipRow>
              </Field>

              <Field>
                <FieldLabel>{t('action.capability')}</FieldLabel>
                <ChipRow>
                  {/* 선택한 skill 의 아이콘. 타이틀에서 옮겨온 표시다. */}
                  <CapabilityIconBox $color={capabilityColor(draft.capability)}>
                    <Icon name={capabilityIcon(draft.capability)} size={14} color="#ffffff" />
                  </CapabilityIconBox>
                  {/* skill 없이 동작하는 Task 가 많아 "없음" 을 고를 수 있어야 한다. */}
                  <CapabilityChip
                    type="button"
                    $active={draft.capability == null}
                    $color="#94a3b8"
                    onClick={() => updateDraft({ capability: null })}
                  >
                    {t('action.noCapability')}
                  </CapabilityChip>
                  {ACTION_CAPABILITIES.map((item) => (
                    <CapabilityChip
                      key={item}
                      type="button"
                      $active={draft.capability === item}
                      $color={CAPABILITY_COLOR[item]}
                      onClick={() => updateDraft({ capability: item })}
                    >
                      {item}
                    </CapabilityChip>
                  ))}
                </ChipRow>
              </Field>

              <Field>
                {/*
                  생성 위치는 목록 화면의 조직 선택을 따른다. 여기서 바꾸지 않는 이유는
                  같은 값으로 조회·생성이 이뤄져야 만든 Task 가 바로 목록에 보이기 때문이다.
                */}
                <FieldLabel>{t('action.location')}</FieldLabel>
                <ReadOnlyValue>{orgLabel}</ReadOnlyValue>
              </Field>

              <Field>
                <FieldLabel>{t('action.status')}</FieldLabel>
                <SelectInput
                  value={draft.status}
                  onChange={(event) => updateDraft({ status: event.target.value as ActionStatus })}
                >
                  {ACTION_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </SelectInput>
              </Field>

              <Field>
                <FieldLabel>{t('action.description')}</FieldLabel>
                <TextInput
                  value={draft.description ?? ''}
                  placeholder={t('action.descriptionPlaceholder')}
                  onChange={(event) => updateDraft({ description: event.target.value })}
                />
              </Field>
            </FormGrid>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{t('action.basicInfo')}</CardTitle>
          </CardHeader>
          <ParamTable>
            <tbody>
              <tr>
                {/* 타이틀에서 뺀 아이콘·skill 을 여기서 보여준다. */}
                <th style={{ width: '180px' }}>{t('action.capability')}</th>
                <td>
                  <ChipGroup>
                    <CapabilityIconBox $color={color}>
                      <Icon name={capabilityIcon(capability)} size={14} color="#ffffff" />
                    </CapabilityIconBox>
                    {capability ?? t('action.noCapability')}
                  </ChipGroup>
                </td>
              </tr>
              <tr>
                <th>{t('action.location')}</th>
                <td>{orgLabel}</td>
              </tr>
              <tr>
                <th>{t('action.taskType')}</th>
                <td>{viewModel?.taskType}</td>
              </tr>
              <tr>
                <th>{t('action.version')}</th>
                <td>{viewModel?.version}</td>
              </tr>
              <tr>
                <th>{t('action.status')}</th>
                <td>{viewModel?.status}</td>
              </tr>
              <tr>
                {/* content_reference 파라미터에서 유도한 값이라 직접 편집하지 않는다. */}
                <th>{t('action.contentTarget')}</th>
                <td>{viewModel?.contentTarget}</td>
              </tr>
              <tr>
                <th>{t('action.description')}</th>
                <td>{viewModel?.description}</td>
              </tr>
            </tbody>
          </ParamTable>
        </Card>
      )}

      {/* INPUT */}
      <Card>
        <CardHeader>
          <SectionBadge $tone="input">INPUT</SectionBadge>
          <CardTitle>{t('action.inputParams')}</CardTitle>
          <CountBadge>{(viewModel?.inputs ?? []).length}</CountBadge>
          {editing && (
            <CardHeaderRight>
              <Button theme="secondary" size="sm" type="button" onClick={() => addParam('inputs')}>
                <Icon name="add" size={16} />
                {t('action.addParam')}
              </Button>
            </CardHeaderRight>
          )}
        </CardHeader>
        {editing ? renderParamEditor(draft.inputs, 'inputs') : renderParamTable(action?.inputs ?? [], 'inputs')}
      </Card>

      {/*
        OUTPUT — BT 의 output port. 현재 서버 데이터에는 direction:'out' 인 속성이 없어
        보기 모드에서는 비어 있으면 섹션을 숨긴다(편집 중에는 추가할 수 있어야 하므로 항상 보인다).
      */}
      {(editing || (viewModel?.outputs ?? []).length > 0) && (
        <Card>
          <CardHeader>
            <SectionBadge $tone="output">OUTPUT</SectionBadge>
            <CardTitle>{t('action.outputParams')}</CardTitle>
            <CountBadge>{(viewModel?.outputs ?? []).length}</CountBadge>
            {editing && (
              <CardHeaderRight>
                <Button theme="secondary" size="sm" type="button" onClick={() => addParam('outputs')}>
                  <Icon name="add" size={16} />
                  {t('action.addParam')}
                </Button>
              </CardHeaderRight>
            )}
          </CardHeader>
          {editing ? renderParamEditor(draft.outputs, 'outputs') : renderParamTable(action?.outputs ?? [], 'outputs')}
        </Card>
      )}
    </Container>
  )
}
