import styled, { keyframes } from 'styled-components'

/* ─── Panel shell ─────────────────────────────────────────────── */
export const StyledAiAssistantDock = styled.aside`
  width: ${({ $isOpen }) => ($isOpen ? '36rem' : '0')};
  min-width: ${({ $isOpen }) => ($isOpen ? '36rem' : '0')};
  max-width: ${({ $isOpen }) => ($isOpen ? '36rem' : '0')};
  height: 100%;
  min-height: 0;
  border-left: ${({ $isOpen }) => ($isOpen ? '1px solid var(--alpha-black-10)' : 'none')};
  background: #ffffff;
  box-shadow: ${({ $isOpen }) => ($isOpen ? '-4px 0 20px rgba(18,24,40,0.07)' : 'none')};
  transition:
    width 0.22s ease,
    min-width 0.22s ease,
    max-width 0.22s ease;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  overflow: hidden;

  @media all and (max-width: 1280px) {
    width: ${({ $isOpen }) => ($isOpen ? '32rem' : '0')};
    min-width: ${({ $isOpen }) => ($isOpen ? '32rem' : '0')};
    max-width: ${({ $isOpen }) => ($isOpen ? '32rem' : '0')};
  }

  @media all and (max-width: 767px) {
    display: none;
  }
`

/* ─── Floating trigger (collapsed state) ─────────────────────── */
export const StyledAiFloatingTrigger = styled.button`
  position: fixed;
  right: 0;
  z-index: 900;
  width: 4.4rem;
  height: 4.4rem;
  border-radius: 50% 0 0 50%;
  background: linear-gradient(135deg, #cd7b94 0%, #bf2d59 50%, #b91c4c 100%);
  color: #fff;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.8rem;
  box-shadow: -3px 3px 14px rgba(205, 123, 148, 0.45);
  cursor: grab;
  user-select: none;
  touch-action: none;
  transform: translateY(-50%);
  transition:
    box-shadow 0.15s,
    opacity 0.15s;

  &:hover {
    box-shadow: -4px 4px 18px rgba(205, 123, 148, 0.6);
    opacity: 0.95;
  }

  &:active {
    cursor: grabbing;
  }

  @media all and (max-width: 767px) {
    display: none;
  }
`

/* ─── Header ──────────────────────────────────────────────────── */
export const StyledAiAssistantDockHeader = styled.header`
  height: 5.2rem;
  padding: 0 1.4rem;
  border-bottom: 1px solid var(--alpha-black-10);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.8rem;
  flex-shrink: 0;
  background: #ffffff;
`

export const StyledAiHeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 0.8rem;
  min-width: 0;
`

export const StyledAiBotAvatar = styled.div`
  width: 2.8rem;
  height: 2.8rem;
  border-radius: 50%;
  background: linear-gradient(135deg, #cd7b94 0%, #bf2d59 50%, #b91c4c 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 1.4rem;
  color: #fff;
`

export const StyledAiAssistantPanelTitle = styled.strong`
  font-size: 1.4rem;
  font-weight: 700;
  color: var(--color-secondary-90, #262f44);
  white-space: nowrap;
  overflow: hidden;
`

export const StyledAiHeaderActions = styled.div`
  display: flex;
  align-items: center;
  gap: 0.2rem;
  flex-shrink: 0;
`

export const StyledAiAssistantDockToggle = styled.button`
  width: 3rem;
  height: 3rem;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border: 0;
  background: transparent;
  color: var(--color-secondary-50, #848c9d);
  cursor: pointer;
  transition: background 0.15s;

  &:hover {
    background: var(--color-secondary-10, #f4f5f7);
    color: var(--color-secondary-80, #3a4256);
  }
`

/* ─── Body ────────────────────────────────────────────────────── */
export const StyledAiAssistantDockBody = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`

/* ─── Collapsed state ─────────────────────────────────────────── */
export const StyledAiCollapsed = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 2rem;
  gap: 2rem;
  cursor: pointer;
  color: var(--color-secondary-50, #848c9d);

  &:hover {
    color: var(--color-secondary-80, #3a4256);
  }
`

/* ─── Welcome / greeting ──────────────────────────────────────── */
export const StyledAiGreeting = styled.div`
  padding: 2rem 1.8rem 1.4rem;
  flex-shrink: 0;
`

export const StyledAiGreetingLine = styled.p`
  margin: 0 0 0.4rem;
  font-size: 1.5rem;
  color: var(--color-secondary-90, #262f44);
  line-height: 1.5;

  strong {
    font-weight: 700;
  }
`

export const StyledAiGreetingCta = styled.p`
  margin: 1rem 0 0;
  font-size: 1.3rem;
  color: var(--color-secondary-60, #6b7280);
  line-height: 1.5;
`

/* ─── Suggested questions ─────────────────────────────────────── */
export const StyledAiSuggestions = styled.div`
  padding: 0 1.8rem 1.6rem;
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  flex-shrink: 0;
`

export const StyledAiSuggestLabel = styled.p`
  margin: 0 0 0.4rem;
  font-size: 1.2rem;
  font-weight: 600;
  color: var(--color-secondary-50, #848c9d);
`

export const StyledAiSuggestChip = styled.button`
  width: 100%;
  padding: 1rem 1.2rem;
  border-radius: 8px;
  border: 1px solid var(--color-secondary-20, #dadde2);
  background: #ffffff;
  color: var(--color-secondary-80, #3a4256);
  font-size: 1.25rem;
  text-align: left;
  cursor: pointer;
  line-height: 1.45;
  transition:
    background 0.15s,
    border-color 0.15s;

  &:hover {
    background: var(--color-secondary-10, #f4f5f7);
    border-color: var(--color-secondary-30, #c0c4cc);
  }
`

/* ─── Message list ────────────────────────────────────────────── */
export const StyledAiAssistantMessageList = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1.2rem;
  padding: 1.4rem 1.6rem;
`

export const StyledAiAssistantMessage = styled.div`
  display: flex;
  flex-direction: column;
  align-items: ${({ $role }) => ($role === 'user' ? 'flex-end' : 'flex-start')};
  gap: 0.4rem;
`

export const StyledAiAssistantMessageMeta = styled.span`
  color: var(--color-secondary-40, #adb5bd);
  font-size: 1.1rem;
`

export const StyledAiAssistantMessageBubble = styled.div`
  max-width: 90%;
  border-radius: ${({ $role }) => ($role === 'user' ? '1.6rem 1.6rem 0.4rem 1.6rem' : '1.6rem 1.6rem 1.6rem 0.4rem')};
  padding: 1rem 1.3rem;
  background: ${({ $role }) =>
    $role === 'user' ? 'linear-gradient(135deg,#CD7B94,#BF2D59,#B91C4C)' : 'var(--color-secondary-10, #f4f5f7)'};
  color: ${({ $role }) => ($role === 'user' ? '#ffffff' : 'var(--color-secondary-90, #262f44)')};
  font-size: 1.3rem;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
`

export const StyledAiHelpContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: 1.4rem;
  width: 100%;
`

export const StyledAiHelpIntro = styled.p`
  margin: 0;
  color: var(--color-secondary-70, #525b70);
  white-space: pre-wrap;
`

export const StyledAiHelpSection = styled.section`
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  padding-top: 1.2rem;
  border-top: 1px solid var(--color-secondary-20, #dadde2);

  &:first-of-type {
    padding-top: 0;
    border-top: 0;
  }
`

export const StyledAiHelpSectionTitle = styled.h3`
  margin: 0;
  color: var(--color-secondary-90, #262f44);
  font-size: 1.55rem;
  font-weight: 700;
  line-height: 1.45;
`

export const StyledAiHelpCommandList = styled.div`
  display: flex;
  flex-direction: column;
`

export const StyledAiHelpCommand = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.75rem 0;
  border-bottom: 1px solid rgba(173, 181, 189, 0.35);

  &:last-child {
    border-bottom: 0;
  }
`

export const StyledAiHelpCommandExample = styled.strong`
  color: #a71945;
  font-size: 1.35rem;
  font-weight: 700;
  line-height: 1.45;
`

export const StyledAiHelpCommandDescription = styled.span`
  color: var(--color-secondary-60, #687086);
  font-size: 1.2rem;
  line-height: 1.5;
`

export const StyledAiAssistantPipelineTrace = styled.div`
  max-width: 90%;
  margin-top: 0.2rem;
  padding: 0.35rem 0.7rem;
  border-radius: 999px;
  border: 1px solid rgba(107, 114, 128, 0.25);
  background: rgba(243, 244, 246, 0.85);
  color: #4b5563;
  font-size: 1.05rem;
  line-height: 1.35;
  letter-spacing: 0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`

export const StyledAiAssistantImageList = styled.div`
  width: 90%;
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.8rem;
`

export const StyledAiAssistantImageCard = styled.figure`
  margin: 0;
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 14px;
  overflow: hidden;
  background: #ffffff;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06);
`

export const StyledAiAssistantImage = styled.img`
  display: block;
  width: 100%;
  height: auto;
  background: linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%);
`

export const StyledAiAssistantImageCaption = styled.figcaption`
  display: grid;
  gap: 0.2rem;
  padding: 0.9rem 1rem 1rem;
`

export const StyledAiAssistantImageTitle = styled.div`
  font-size: 1.18rem;
  font-weight: 700;
  color: var(--color-secondary-90, #262f44);
  line-height: 1.4;
`

export const StyledAiAssistantImageText = styled.div`
  font-size: 1.1rem;
  color: var(--color-secondary-60, #6b7280);
  line-height: 1.5;
  white-space: pre-wrap;
`

export const StyledAiActionCards = styled.div`
  width: 90%;
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.6rem;
`

export const StyledAiActionCard = styled.button`
  width: 100%;
  border: 1px solid var(--color-secondary-20, #dadde2);
  border-radius: 10px;
  background: #ffffff;
  text-align: left;
  padding: 0.9rem 1rem;
  cursor: pointer;
  transition:
    border-color 0.15s,
    background 0.15s;

  &:hover {
    border-color: var(--color-secondary-30, #c0c4cc);
    background: var(--color-secondary-10, #f4f5f7);
  }
`

export const StyledAiActionCardTitle = styled.div`
  font-size: 1.22rem;
  font-weight: 700;
  color: var(--color-secondary-90, #262f44);
  line-height: 1.45;
`

export const StyledAiActionCardKeyword = styled.div`
  margin-top: 0.2rem;
  font-size: 1.12rem;
  color: var(--color-secondary-60, #6b7280);
  line-height: 1.45;
`

export const StyledAiAssistantEmpty = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-secondary-40, #adb5bd);
  font-size: 1.3rem;
`

/* ─── Loading animation ───────────────────────────────────────── */
const aiDotBounce = keyframes`
  0%, 80%, 100% { transform: translateY(0); opacity: 0.35; }
  40%           { transform: translateY(-4px); opacity: 1; }
`

const resolveLoadingTone = (stage) => {
  switch (stage) {
    case 'requesting':
      return '59, 130, 246'
    case 'thinking':
      return '37, 99, 235'
    case 'generating':
      return '30, 64, 175'
    case 'completed':
      return '29, 78, 216'
    default:
      return '100, 116, 139'
  }
}

const resolveLoadingStrength = (elapsed) => {
  const sec = Number.isFinite(Number(elapsed)) ? Number(elapsed) : 0
  return Math.min(1, 0.28 + sec * 0.12)
}

export const StyledAiAssistantLoadingBubble = styled.div`
  max-width: 90%;
  border-radius: 1.6rem 1.6rem 1.6rem 0.4rem;
  padding: 1rem 1.3rem;
  background: ${({ $stage, $elapsed }) => {
    const tone = resolveLoadingTone($stage)
    const strength = resolveLoadingStrength($elapsed)
    const lightAlpha = (0.08 + strength * 0.08).toFixed(3)
    const strongAlpha = (0.14 + strength * 0.14).toFixed(3)
    return `linear-gradient(135deg, rgba(${tone}, ${lightAlpha}), rgba(${tone}, ${strongAlpha}))`
  }};
  border: 1px solid
    ${({ $stage, $elapsed }) => {
      const tone = resolveLoadingTone($stage)
      const strength = resolveLoadingStrength($elapsed)
      const borderAlpha = (0.16 + strength * 0.22).toFixed(3)
      return `rgba(${tone}, ${borderAlpha})`
    }};
  transition:
    background 0.22s ease,
    border-color 0.22s ease;
`

export const StyledAiAssistantLoadingRow = styled.div`
  display: flex;
  align-items: center;
  gap: 0.8rem;
`

export const StyledAiAssistantLoadingDots = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;

  & > span {
    width: 0.65rem;
    height: 0.65rem;
    border-radius: 50%;
    background: ${({ $stage, $elapsed }) => {
      const tone = resolveLoadingTone($stage)
      const strength = resolveLoadingStrength($elapsed)
      const alpha = (0.42 + strength * 0.52).toFixed(3)
      return `rgba(${tone}, ${alpha})`
    }};
    animation: ${aiDotBounce} 1.2s infinite ease-in-out;
    transition: background 0.18s ease;
  }

  & > span:nth-child(1) {
    animation-delay: 0s;
  }
  & > span:nth-child(2) {
    animation-delay: 0.2s;
  }
  & > span:nth-child(3) {
    animation-delay: 0.4s;
  }
`

export const StyledAiAssistantLoadingText = styled.div`
  font-size: 1.2rem;
  color: ${({ $stage, $elapsed }) => {
    const tone = resolveLoadingTone($stage)
    const strength = resolveLoadingStrength($elapsed)
    const alpha = (0.48 + strength * 0.5).toFixed(3)
    return `rgba(${tone}, ${alpha})`
  }};
  transition: color 0.18s ease;
`

/* ─── Composer ────────────────────────────────────────────────── */
export const StyledAiAssistantComposer = styled.form`
  flex-shrink: 0;
  padding: 1rem 1.4rem;
  border-top: 1px solid var(--alpha-black-10);
  display: flex;
  flex-direction: column;
  gap: 0;
`

export const StyledAiComposerBox = styled.div`
  border: 1px solid var(--color-secondary-20, #dadde2);
  border-radius: 12px;
  background: #fff;
  overflow: hidden;
  transition:
    border-color 0.15s,
    box-shadow 0.15s;

  &:focus-within {
    border-color: #bf2d59;
    box-shadow: 0 0 0 3px rgba(191, 45, 89, 0.12);
  }
`

export const StyledAiAssistantTextarea = styled.textarea`
  width: 100%;
  min-height: 7rem;
  max-height: 14rem;
  resize: none;
  border: none;
  outline: none;
  padding: 1.1rem 1.3rem 0.6rem;
  background: transparent;
  color: var(--color-secondary-90, #262f44);
  font-size: 1.3rem;
  line-height: 1.6;
  font-family: inherit;

  &::placeholder {
    color: var(--color-secondary-40, #adb5bd);
  }
`

export const StyledAiComposerFooter = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.6rem 0.8rem 0.8rem;
`

export const StyledAiComposerActions = styled.div`
  display: flex;
  align-items: center;
  gap: 0.6rem;
`

export const StyledAiContextChips = styled.div`
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
`

export const StyledAiContextChip = styled.button`
  padding: 0.4rem 0.9rem;
  border-radius: 20px;
  border: 1px solid ${({ $active }) => ($active ? '#BF2D59' : 'var(--color-secondary-20, #dadde2)')};
  background: ${({ $active }) => ($active ? 'rgba(191,45,89,0.08)' : 'transparent')};
  color: ${({ $active }) => ($active ? '#BF2D59' : 'var(--color-secondary-50, #848c9d)')};
  font-size: 1.15rem;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;

  &:hover {
    border-color: #bf2d59;
    color: #bf2d59;
    background: rgba(191, 45, 89, 0.06);
  }
`

export const StyledAiSendButton = styled.button`
  width: 3.2rem;
  height: 3.2rem;
  border-radius: 50%;
  border: none;
  background: ${({ disabled }) =>
    disabled ? 'var(--color-secondary-20, #dadde2)' : 'linear-gradient(135deg,#CD7B94,#BF2D59,#B91C4C)'};
  color: ${({ disabled }) => (disabled ? 'var(--color-secondary-40, #adb5bd)' : '#fff')};
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: ${({ disabled }) => (disabled ? 'not-allowed' : 'pointer')};
  flex-shrink: 0;
  font-size: 1.6rem;
  line-height: 1;
  transition:
    background 0.15s,
    opacity 0.15s;

  &:hover:not(:disabled) {
    opacity: 0.88;
  }
`

export const StyledAiStopButton = styled.button`
  height: 3.2rem;
  padding: 0 1.2rem;
  border-radius: 999px;
  border: 1px solid #fda4af;
  background: #fff1f2;
  color: #be123c;
  font-size: 1.2rem;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
  transition:
    background 0.15s,
    border-color 0.15s,
    color 0.15s;

  &:hover {
    background: #ffe4e6;
    border-color: #fb7185;
    color: #9f1239;
  }
`

/* ─── Reset / disclaimer ──────────────────────────────────────── */
export const StyledAiResetRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 0.4rem 0 0;
`

export const StyledAiResetBtn = styled.button`
  background: none;
  border: none;
  font-size: 1.15rem;
  color: var(--color-secondary-40, #adb5bd);
  cursor: pointer;
  padding: 0.2rem 0.4rem;

  &:hover {
    color: var(--color-secondary-60, #6b7280);
    text-decoration: underline;
  }
`

export const StyledAiDisclaimer = styled.p`
  margin: 0;
  padding: 0.8rem 1.4rem 1rem;
  font-size: 1.1rem;
  color: var(--color-secondary-40, #adb5bd);
  line-height: 1.45;
  flex-shrink: 0;
  text-align: center;
`

/* ─── Context badges ──────────────────────────────────────────── */
export const StyledAiAssistantContextList = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  margin-top: 0.8rem;
`

export const StyledAiAssistantContextBadge = styled.div`
  padding: 0.4rem 0.9rem;
  border-radius: 999px;
  background: var(--color-secondary-10, #f4f5f7);
  color: var(--color-secondary-60, #6b7280);
  font-size: 1.15rem;
  font-weight: 500;
`

/* ─── Unused legacy exports ───────────────────────────────────── */
export const StyledAiAssistantPanelIntro = styled.p``
export const StyledAiAssistantComposerActions = styled.div``

// 임시 회귀 테스트 버튼의 글자. (1/12) 처럼 다음 순번이 보이고, 실행 중에는 정지 색이 된다.
export const StyledAiTestLabel = styled.span`
  padding: 0 0.4rem;
  font-size: 1.1rem;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.02em;
  white-space: nowrap;
  color: ${({ $running }) => ($running ? '#be123c' : '#475569')};
`

/* ─── 회귀 테스트 문장 목록(임시) ─────────────────────────────── */
export const StyledAiTestListOverlay = styled.div`
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(18, 24, 40, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4rem 2rem;
`

export const StyledAiTestListPanel = styled.div`
  width: min(72rem, 100%);
  max-height: 100%;
  background: #ffffff;
  border-radius: 10px;
  box-shadow: 0 12px 40px rgba(18, 24, 40, 0.25);
  display: flex;
  flex-direction: column;
  overflow: hidden;
`

export const StyledAiTestListHeader = styled.header`
  padding: 1.4rem 1.6rem;
  border-bottom: 1px solid var(--alpha-black-10);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;

  strong {
    font-size: 1.4rem;
    font-weight: 700;
    color: var(--color-secondary-90, #262f44);
  }
`

export const StyledAiTestListBody = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0.8rem 0;
`

export const StyledAiTestListRow = styled.button`
  width: 100%;
  padding: 1rem 1.6rem;
  border: 0;
  border-left: 3px solid ${({ $current }) => ($current ? '#BF2D59' : 'transparent')};
  background: ${({ $current }) => ($current ? '#fff1f2' : 'transparent')};
  text-align: left;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;

  &:hover {
    background: var(--color-secondary-10, #f4f5f7);
  }
`

export const StyledAiTestListTitle = styled.span`
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--color-secondary-90, #262f44);
`

export const StyledAiTestListText = styled.span`
  font-size: 1.2rem;
  line-height: 1.5;
  color: var(--color-secondary-70, #525b70);
  white-space: pre-wrap;
  word-break: break-word;
`
