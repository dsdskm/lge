import React from 'react'
import { Icon } from '@repo/ui'
import { StyledInfoAnchor } from './styles'

/**
 * 마우스 호버 시 설명을 보여주는 info 아이콘.
 * Icon 컴포넌트가 data-* 속성을 svg로 전달하지 않으므로 래퍼 span에 툴팁 속성을 붙인다.
 * 같은 화면에서 tooltipId에 해당하는 <UITooltip id={tooltipId} /> 를 한 번 렌더해야 동작한다.
 */
const InfoTooltipIcon = ({ tooltipId, title, desc, size = 16, name = 'info' }) => (
  <StyledInfoAnchor data-tooltip-id={tooltipId} data-tooltip-title={title} data-tooltip-desc={desc} aria-label={desc}>
    <Icon name={name} size={size} />
  </StyledInfoAnchor>
)

export default InfoTooltipIcon
