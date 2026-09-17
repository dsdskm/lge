import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Button,
  Dropdown,
  HeaderTitleGroup,
  Icon,
  NoData,
  OrganizationSelector,
  Search,
  Section,
  StyledPageContent,
  Title
} from '@repo/ui'
import { useOrganizationStore } from '@repo/stores'
import { TOTAL_GROUP_ID, TOTAL_SITE_ID } from '@/common/constants'
import { useListActions } from '@/api/actionApis'
import {
  ACTION_CAPABILITIES,
  MANAGED_TASK_TYPES,
  type Action,
  type ActionCapability,
  type ManagedTaskType
} from '@/types/action'
import ActionRow from './ActionRow'
import { ButtonWrap, ListBody, ListControls, TotalCount } from './styles'

/** 필터에서 "전체"를 뜻하는 값. */
const FILTER_ALL = 'ALL'
/** skill 이 지정되지 않은 Task 만 보기. */
const FILTER_NO_SKILL = 'NONE'

type TaskTypeFilter = typeof FILTER_ALL | ManagedTaskType
type SkillFilter = typeof FILTER_ALL | typeof FILTER_NO_SKILL | ActionCapability

export default function ActionListPage() {
  const { t } = useTranslation(['tms', 'common'])
  const navigate = useNavigate()
  const { allOrgs } = useOrganizationStore()

  // tasks API 는 groupId/siteId 가 필수이고 'all' 이 와일드카드다. 초기값은 전체 공용 조회.
  const [orgFilter, setOrgFilter] = useState<{ groupId: string | null; siteId: string | null }>({
    groupId: TOTAL_GROUP_ID,
    siteId: TOTAL_SITE_ID
  })
  const [searchQuery, setSearchQuery] = useState('')
  const [taskTypeFilter, setTaskTypeFilter] = useState<TaskTypeFilter>(FILTER_ALL)
  const [skillFilter, setSkillFilter] = useState<SkillFilter>(FILTER_ALL)

  const { data: actions, isLoading } = useListActions(orgFilter)

  // 드롭다운 위에 라벨을 두지 않으므로, "전체" 항목 문구가 그 드롭다운이 무엇인지 알려주는 역할을 한다.
  const taskTypeOptions = useMemo(
    () => [
      { value: FILTER_ALL, name: t('action.filterAllTypes') },
      ...MANAGED_TASK_TYPES.map((type) => ({ value: type, name: type }))
    ],
    [t]
  )

  const skillOptions = useMemo(
    () => [
      { value: FILTER_ALL, name: t('action.filterAllSkills') },
      ...ACTION_CAPABILITIES.map((capability) => ({ value: capability, name: capability })),
      // skill 없이 동작하는 Task 가 많아 따로 골라볼 수 있게 둔다.
      { value: FILTER_NO_SKILL, name: t('action.noCapability') }
    ],
    [t]
  )

  // 그룹=전체인데 사이트만 고른 경우 상위 그룹 코드를 채워준다(TaskFlowListPage 와 동일 규칙).
  const handleOrgChange = ({ values }: any) => {
    let groupId = values?.[0] ?? null
    const siteId = values?.[1] ?? null

    const isGroupAll = groupId == null || groupId === TOTAL_GROUP_ID
    const isSiteSelected = siteId != null && siteId !== TOTAL_SITE_ID && siteId !== 'none'

    if (isGroupAll && isSiteSelected) {
      const site = allOrgs.find((org: any) => String(org.code) === String(siteId))
      if (site?.parentCode != null) {
        groupId = site.parentCode
      }
    }

    setOrgFilter({ groupId, siteId })
  }

  const filteredActions = useMemo(() => {
    const keyword = searchQuery.trim().toLowerCase()

    return (actions ?? []).filter((action) => {
      if (taskTypeFilter !== FILTER_ALL && action.taskType !== taskTypeFilter) return false

      if (skillFilter === FILTER_NO_SKILL) {
        if (action.capability != null) return false
      } else if (skillFilter !== FILTER_ALL && action.capability !== skillFilter) {
        return false
      }

      if (!keyword) return true

      // 서버에 별도 코드 필드가 없어 이름·설명으로 검색한다.
      return action.name.toLowerCase().includes(keyword) || (action.description ?? '').toLowerCase().includes(keyword)
    })
  }, [actions, searchQuery, taskTypeFilter, skillFilter])

  const handleClickRow = (action: Action) => {
    navigate(`/tms/actions/${action.id}/detail`)
  }

  return (
    <StyledPageContent className="column">
      <Title>{t('action.title')}</Title>
      <OrganizationSelector onChange={handleOrgChange} supportAlls={[true, true]} />

      <Section>
        <HeaderTitleGroup>
          {/*
            검색 + 드롭다운 2개를 한 줄에 두고 공간이 부족할 때만 줄바꿈한다(ListControls 가 flex-wrap).
            - @repo/ui 의 SearchContainer 는 width:100% 라 한 줄을 다 차지하므로 쓰지 않는다.
              Search 자체가 width prop 으로 폭을 갖는다.
            - Search 의 label 도 쓰지 않는다 — 위에 문구가 붙으면 드롭다운과 높이가 어긋난다.
          */}
          <ListControls>
            <Search
              width="250px"
              value={searchQuery}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(event.target.value)}
              onReset={() => setSearchQuery('')}
              placeholder={t('action.searchPlaceholder')}
            />

            <Dropdown
              value={taskTypeFilter}
              options={taskTypeOptions}
              onChange={(value: TaskTypeFilter) => setTaskTypeFilter(value)}
              minWidth="150px"
            />
            <Dropdown
              value={skillFilter}
              options={skillOptions}
              onChange={(value: SkillFilter) => setSkillFilter(value)}
              minWidth="170px"
            />
          </ListControls>

          <ButtonWrap>
            <Button
              variant="contained"
              style={{ whiteSpace: 'nowrap' }}
              onClick={() => navigate('/tms/actions/new/detail')}
            >
              <Icon name="add" size={18} />
              {t('action.create')}
            </Button>
          </ButtonWrap>
        </HeaderTitleGroup>

        {isLoading ? (
          <TotalCount>{t('common:loading', { defaultValue: 'Loading...' })}</TotalCount>
        ) : filteredActions.length === 0 ? (
          <NoData>{t('list.noData')}</NoData>
        ) : (
          <>
            <TotalCount>{t('action.totalCount', { count: filteredActions.length })}</TotalCount>
            <ListBody>
              {filteredActions.map((action) => (
                <ActionRow key={action.id} action={action} onClick={handleClickRow} />
              ))}
            </ListBody>
          </>
        )}
      </Section>
    </StyledPageContent>
  )
}
