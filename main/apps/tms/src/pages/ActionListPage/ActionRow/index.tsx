import { Icon } from '@repo/ui'
import { useTranslation } from 'react-i18next'
import { ACTION_CONTENT_TARGET_NONE, capabilityColor, capabilityIcon, type Action } from '@/types/action'
import { useActionOrgLabel } from '@/pages/hooks/useActionOrgLabel'
import {
  ActionIdText,
  ActionName,
  BuiltInBadge,
  CapabilityTag,
  Card,
  CardMain,
  Chevron,
  ContentTag,
  Desc,
  DescRow,
  IconBox,
  LocationBadge,
  StatusBadge,
  TitleRow
} from './styles'

interface ActionRowProps {
  action: Action
  onClick: (action: Action) => void
}

export default function ActionRow({ action, onClick }: ActionRowProps) {
  const { t } = useTranslation('tms')
  const actionOrgLabel = useActionOrgLabel()
  const color = capabilityColor(action.capability)
  // INACTIVE · DEPRECATED 는 지금 쓰이지 않는 Task 다. 배경을 눌러 구분한다.
  const isInactive = action.status !== 'ACTIVE'

  return (
    <Card $inactive={isInactive} onClick={() => onClick(action)}>
      <IconBox $color={color}>
        <Icon name={capabilityIcon(action.capability)} size={22} color="#ffffff" />
      </IconBox>

      <CardMain>
        <TitleRow>
          <ActionName>{action.name}</ActionName>
          {/* 서버에 별도 코드 필드가 없어 taskType 을 보조 정보로 보여준다. */}
          <ActionIdText>{action.taskType}</ActionIdText>
          {/*
            생성 위치. 목록에는 전체공용 + 그룹공용 + 사이트전용이 섞여 오므로 범위를 구분해서 보여준다.
            전체 공용은 "기본 제공" 뱃지가 이미 같은 사실을 말하므로(둘 다 groupId·siteId 가 비어 있다는 뜻)
            같은 자리에서 둘 중 하나만 보여준다.
          */}
          {action.builtIn ? (
            <BuiltInBadge>{t('action.builtIn')}</BuiltInBadge>
          ) : (
            <LocationBadge>
              <Icon name="location" size={12} color="#9ca3af" />
              {actionOrgLabel(action.groupId, action.siteId)}
            </LocationBadge>
          )}
          {/* ACTIVE 는 정상 상태이므로 뱃지를 달지 않는다. */}
          {isInactive && <StatusBadge>{action.status}</StatusBadge>}
        </TitleRow>

        <DescRow>
          {/* skill 이 지정되지 않은 Task 가 많아 없으면 태그를 그리지 않는다. */}
          {action.capability && <CapabilityTag $color={color}>{action.capability}</CapabilityTag>}
          {/* MoveTo(POI), PlayFace(FACE:VIDEO) 처럼 연동 콘텐츠가 필요한 Task 를 구분해서 보여준다. */}
          {action.contentTarget !== ACTION_CONTENT_TARGET_NONE && (
            <ContentTag>
              <Icon name="content" size={12} color="#9ca3af" />
              {action.contentTarget}
            </ContentTag>
          )}
          <Desc>{action.description}</Desc>
        </DescRow>
      </CardMain>

      <Chevron>
        <Icon name="arrow_right" size={20} color="#9ca3af" />
      </Chevron>
    </Card>
  )
}
