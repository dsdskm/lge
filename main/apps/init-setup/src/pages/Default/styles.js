import styled, { css, keyframes } from 'styled-components'

export const StyledPageContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: 1.6rem;
  padding: 2.4rem;
  width: 100%;
  height: auto;
  min-height: 100%;
  overflow: visible;
`

export const PageHero = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 2rem;
  padding-bottom: 2.2rem;
  border-bottom: 1px solid #e6ebf2;

  @media (max-width: 768px) {
    flex-direction: column;
  }
`

export const HeroText = styled.div``

export const HeroEyebrow = styled.div`
  color: #38a3c7;
  font-size: 1.25rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
`

export const HeroTitle = styled.h2`
  margin: 0.4rem 0 0;
  color: #1f2937;
  font-size: 3rem;
  font-weight: 900;
  letter-spacing: -0.03em;
`

export const HeroDescription = styled.p`
  margin: 0.8rem 0 0;
  color: #667085;
  font-size: 1.4rem;
  line-height: 1.65;
`

export const BadgeGroup = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.8rem;
`

const badgeTone = {
  blue: css`
    color: #1681a7;
    background: #eaf6fb;
    border-color: #bce5f3;
  `,
  green: css`
    color: #178a4b;
    background: #e8f7ef;
    border-color: #bfe8d0;
  `,
  orange: css`
    color: #b76a00;
    background: #fff4e5;
    border-color: #ffd79a;
  `,
  red: css`
    color: #c43d3d;
    background: #fdecec;
    border-color: #f4b9b9;
  `,
  gray: css`
    color: #667085;
    background: #f3f5f8;
    border-color: #d9dee7;
  `
}

export const StatusBadge = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
  border: 1px solid;
  border-radius: 999px;
  padding: 0.55rem 1.05rem;
  font-size: 1.2rem;
  font-weight: 800;
  ${({ tone = 'gray' }) => badgeTone[tone] || badgeTone.gray}
`

// 남은 카드가 '접속 주소 안내' 하나뿐이라(연결 상태 카드는 상단 배지와 중복이라 없앴다)
// 더는 2열 그리드가 필요 없다 — 카드 하나를 전체 폭으로 보여준다.
export const SummaryGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr;
  gap: 1.4rem;
  margin-top: 2.2rem;
`

export const SummaryCard = styled.div`
  border: 1px solid #e3e8ef;
  border-radius: 1.8rem;
  background: #f8fafc;
  padding: 1.7rem 1.8rem;
`

export const SummaryLabel = styled.div`
  color: #667085;
  font-size: 1.15rem;
  font-weight: 900;
  letter-spacing: 0.04em;
  text-transform: uppercase;
`

export const SummaryValue = styled.div`
  margin-top: 0.8rem;
  color: ${({ accent }) => (accent ? '#1681a7' : '#1f2937')};
  font-size: 1.55rem;
  font-weight: 900;
  word-break: break-all;
`

export const SummaryHint = styled.div`
  margin-top: 0.5rem;
  color: #8a94a6;
  font-size: 1.22rem;
  line-height: 1.55;
`

export const SectionCard = styled.div`
  margin-top: 2.4rem;
  border: 1px solid #e1e6ef;
  border-radius: 2rem;
  background: rgb(248, 250, 252);
  padding: 2rem;
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.04);
`

export const SectionHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1.4rem;

  @media (max-width: 640px) {
    flex-direction: column;
  }
`

export const SectionTitle = styled.h3`
  margin: 0;
  color: #1f2937;
  font-size: 1.9rem;
  font-weight: 900;
`

export const SectionDescription = styled.p`
  margin: 0.55rem 0 0;
  color: #667085;
  font-size: 1.28rem;
  line-height: 1.55;
`

export const ActionButton = styled.button`
  border: none;
  border-radius: 1.2rem;
  background: var(--t-primary-btn-bg);
  color: var(--t-primary-btn-text);
  padding: 1.05rem 1.7rem;
  font-size: 1.35rem;
  font-weight: 900;
  cursor: pointer;
  transition: 0.15s ease;
  box-shadow: 0 6px 14px rgba(125, 119, 106, 0.22);

  &:hover:not(:disabled) {
    background: var(--t-primary-btn-hover-bg);
    transform: translateY(-1px);
  }

  &:active:not(:disabled) {
    background: var(--t-primary-btn-active-bg);
  }

  &:disabled {
    cursor: not-allowed;
    color: var(--color-neutral-50);
    background: var(--color-neutral-30);
    box-shadow: none;
    transform: none;
  }
`

export const WifiGrid = styled.div`
  display: grid;
  gap: 1.1rem;
  margin-top: 1.6rem;
  max-height: 36rem;
  overflow-y: auto;
  padding: 0.4rem;
`

// 카드 자체는 더 이상 클릭 전체가 선택 버튼이 아니다 — 선택은 안의 WifiCardRow 가 맡고,
// 카드는 선택 시 그 아래에 이어지는 비밀번호 입력(WifiConnectInline)까지 함께 담는 그릇이다.
export const WifiCard = styled.div`
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 1.2rem;
  border: 1px solid #e3e8ef;
  border-radius: 1.8rem;
  background: #ffffff;
  padding: 1.55rem 1.6rem;
  transition: 0.15s ease;
  box-shadow: 0 3px 10px rgba(15, 23, 42, 0.03);

  &:hover {
    border-color: #cfd8e5;
    background: #f8fafc;
  }

  &.active {
    border-color: var(--t-primary-btn-bg);
    background: var(--color-neutral-15);
    box-shadow: 0 0 0 3px rgba(125, 119, 106, 0.13);
  }
`

export const WifiCardRow = styled.div`
  width: 100%;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1.6rem;
  text-align: left;
  cursor: pointer;
`

export const WifiMain = styled.div`
  min-width: 0;
  flex: 1;
`

export const WifiNameRow = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.7rem;
`

export const WifiName = styled.div`
  max-width: 42rem;
  overflow: hidden;
  color: #1f2937;
  font-size: 1.55rem;
  font-weight: 900;
  text-overflow: ellipsis;
  white-space: nowrap;
`

export const WifiMeta = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.6rem;
  margin-top: 1rem;
`

export const WifiChip = styled.span`
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 0.42rem 0.8rem;
  color: #667085;
  background: #f2f5f8;
  font-size: 1.12rem;
  font-weight: 800;
  ${({ tone }) =>
    tone === 'green' &&
    css`
      color: #178a4b;
      background: #e8f7ef;
    `}
  ${({ tone }) =>
    tone === 'blue' &&
    css`
      color: #1681a7;
      background: #eaf6fb;
    `}
`

export const SignalBars = styled.div`
  display: flex;
  align-items: flex-end;
  gap: 0.35rem;
  padding-top: 0.25rem;
`

export const SignalBar = styled.div`
  width: 0.55rem;
  border-radius: 999px;
  background: #d8dee8;
  height: ${({ height }) => `${height * 0.6 + 0.6}rem`};

  &.on {
    background: var(--t-primary-btn-bg);
  }
`

export const EmptyState = styled.div`
  margin-top: 1.6rem;
  border: 1px dashed #cfd8e5;
  border-radius: 1.8rem;
  background: #f8fafc;
  padding: 4rem 2rem;
  text-align: center;

  h4 {
    margin: 1.2rem 0 0;
    color: #1f2937;
    font-size: 1.55rem;
    font-weight: 900;
  }

  p {
    margin: 0.6rem 0 0;
    color: #667085;
    font-size: 1.25rem;
  }
`

const spin = keyframes`
  to {
    transform: rotate(360deg);
  }
`

// 큰 스피너(목록 첫 로딩)와 헤더 옆 작은 스피너(이미 목록이 있는 채로 재스캔) 모두 이걸 쓴다 —
// $size 로만 구분해서, 크기 다른 스피너가 서로 다른 애니메이션 규칙을 갖지 않게 한다.
export const Spinner = styled.span`
  display: inline-block;
  width: ${({ $size }) => $size || '2rem'};
  height: ${({ $size }) => $size || '2rem'};
  border: 3px solid #e3e8ef;
  border-top-color: var(--t-primary-btn-bg);
  border-radius: 50%;
  vertical-align: middle;
  animation: ${spin} 0.7s linear infinite;
`

// Wi‑Fi 목록을 처음 불러오는 동안(아직 보여줄 목록이 없을 때) EmptyState 자리에 대신 뜬다 —
// 검색 결과가 없다는 오해(EmptyState) 대신 아직 찾고 있다는 것을 보여준다.
export const WifiLoadingState = styled.div`
  margin-top: 1.6rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1.2rem;
  padding: 4rem 2rem;
  color: #667085;
  font-size: 1.3rem;
`

export const EmptyIcon = styled.div`
  width: 4.6rem;
  height: 4.6rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #e3e8ef;
  border-radius: 999px;
  background: white;
  font-size: 2.2rem;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.05);
`

export const ConnectPanel = styled.div`
  margin-top: 2rem;
  border: 1px solid #e1e6ef;
  border-radius: 2rem;
  background: #f8fafc;
  padding: 2rem;
`

export const ConnectPanelTop = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1.4rem;
  margin-bottom: 1.6rem;

  h3 {
    margin: 0;
    color: #1f2937;
    font-size: 1.75rem;
    font-weight: 900;
  }

  p {
    margin: 0.55rem 0 0;
    color: #667085;
    font-size: 1.3rem;
    line-height: 1.55;
  }
`

// 카드가 선택되며 이 패널이 나타날 때, 위 WifiCardRow 가 그 무게에 살짝 눌려 내려오는
// 느낌을 준다 — 등장이 뚝 끊기지 않고 위에서 부드럽게 펼쳐지는 것처럼 보이게 한다.
const slideDown = keyframes`
  from {
    transform: translateY(-0.6rem);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
`

// 목록에서 고른 Wi-Fi 카드 안에 이어지는 비밀번호 입력 + 연결 버튼.
// 타이틀/설명 없이 입력과 버튼만 두어, 카드를 고르는 것과 접속을 시작하는 것 사이에
// 눈길이 다른 곳(멀리 떨어진 섹션)으로 튀지 않게 한다.
export const WifiConnectInline = styled.div`
  display: flex;
  flex-direction: column;
  gap: 1.2rem;
  padding-top: 1.4rem;
  border-top: 1px dashed #d8dee8;
  animation: ${slideDown} 0.22s ease-out;
`

export const PasswordField = styled.div`
  position: relative;
  width: 100%;
`

export const PasswordInput = styled.input`
  width: 100%;
  border: 1px solid #cfd8e5;
  border-radius: 1.2rem;
  background: white;
  color: #1f2937;
  outline: none;
  padding: 1.15rem 5rem 1.15rem 1.3rem;
  font-size: 1.35rem;
  transition: 0.15s ease;

  &:focus {
    border-color: var(--t-primary-btn-bg);
    box-shadow: 0 0 0 4px rgba(125, 119, 106, 0.13);
  }
`

export const TogglePasswordButton = styled.button`
  position: absolute;
  top: 50%;
  right: 0.8rem;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 3.6rem;
  height: 3.6rem;
  border: none;
  border-radius: 1rem;
  background: transparent;
  color: #667085;
  font-size: 1.65rem;
  cursor: pointer;
  transition: 0.15s ease;

  &:hover {
    background: var(--color-neutral-20);
    color: var(--t-primary-btn-bg);
  }

  &:focus-visible {
    outline: 2px solid var(--t-primary-btn-bg);
    outline-offset: 2px;
  }
`

export const ButtonWrap = styled.div`
  display: flex;
  gap: 1rem;
  margin-top: 1.8rem;

  &.alignLeft {
    justify-content: flex-start;
  }

  &.alignRight {
    justify-content: flex-end;
  }

  &.alignCenter {
    justify-content: center;
  }
`

export const SwitchingPanel = styled.div`
  display: flex;
  gap: 1.8rem;
  margin-top: 2rem;
  border-radius: 2rem;
  background: linear-gradient(135deg, #5db7d8 0%, #32b8c8 100%);
  color: white;
  padding: 2.2rem;
  box-shadow: 0 14px 30px rgba(50, 184, 200, 0.24);
`

export const SwitchingIcon = styled.div`
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 5.2rem;
  height: 5.2rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
  font-size: 2.4rem;
`

export const SwitchingContent = styled.div`
  flex: 1;

  > span {
    display: block;
    color: rgba(255, 255, 255, 0.78);
    font-size: 1.15rem;
    font-weight: 900;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  h3 {
    margin: 0.45rem 0 0;
    color: white;
    font-size: 2.25rem;
    font-weight: 900;
  }

  p {
    margin: 1.1rem 0 0;
    max-width: 78rem;
    color: rgba(255, 255, 255, 0.9);
    font-size: 1.35rem;
    line-height: 1.75;
  }
`

export const ReconnectBox = styled.div`
  margin-top: 1.5rem;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 1.4rem;
  background: rgba(255, 255, 255, 0.12);
  padding: 1.25rem 1.4rem;

  span {
    display: block;
    color: rgba(255, 255, 255, 0.76);
    font-size: 1.1rem;
    font-weight: 900;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
`

export const ReconnectLink = styled.a`
  display: block;
  margin-top: 0.5rem;
  color: white;
  font-size: 1.45rem;
  font-weight: 900;
  text-decoration: underline;
  text-underline-offset: 0.35rem;
  word-break: break-all;
`

export const CountdownPill = styled.div`
  display: inline-flex;
  align-items: center;
  margin-top: 1.4rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
  padding: 0.65rem 1.05rem;
  color: white;
  font-size: 1.25rem;
  font-weight: 900;
`

export const SimplePanel = styled.div`
  margin-top: 1.4rem;
  border: 1px solid #e1e6ef;
  border-radius: 1.8rem;
  background: #f8fafc;
  padding: 1.8rem;
`

export const MiniButton = styled.button`
  border: none;
  border-radius: 1.1rem;
  background: var(--t-primary-btn-bg);
  color: var(--t-primary-btn-text);
  padding: 1rem 1.6rem;
  font-size: 1.3rem;
  font-weight: 900;
  cursor: pointer;

  &:hover {
    background: var(--t-primary-btn-hover-bg);
  }
`

export const SmallNote = styled.div`
  margin-top: 0.2rem;
  border: 1px solid #e3e8ef;
  border-radius: 1.4rem;
  background: #f8fafc;
  padding: 1.3rem 1.5rem;
  color: #667085;
  font-size: 1.2rem;
  line-height: 1.6;
`

// Compatibility exports for older imports/usages.
export const HeaderRow = SectionHeader
export const WifiList = WifiGrid
export const WifiItem = WifiCard
export const ConnectArea = ConnectPanel


export const SetupFormCard = styled.div`
  width: min(82rem, 100%);
  max-width: 82rem;
  align-self: flex-start;
  margin: 1.2rem 0 0;
  border: 1px solid var(--color-neutral-20);
  border-radius: 2rem;
  background: var(--color-neutral-10);
  padding: 3rem 3.2rem;
  box-shadow: var(--shadow-00);

  @media (max-width: 768px) {
    padding: 2.2rem 1.8rem;
  }
`

export const SetupCardIntro = styled.h3`
  margin: 0 0 2.4rem;
  color: var(--color-neutral-90);
  font-size: 1.65rem;
  font-weight: 800;
  line-height: 1.5;
`

export const FormRow = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  margin-top: 1.7rem;
`

export const FormLabel = styled.label`
  color: var(--color-neutral-80);
  font-size: 1.3rem;
  font-weight: 800;
`

export const FormInput = styled.input`
  width: 100%;
  border: 1px solid var(--color-neutral-30);
  border-radius: 1.2rem;
  padding: 1.25rem 1.35rem;
  color: var(--color-neutral-90);
  background: ${({ disabled }) => disabled ? 'var(--color-neutral-15)' : 'var(--color-neutral-10)'};
  font-size: 1.4rem;
  outline: none;

  &:focus {
    border-color: var(--t-primary-btn-bg);
    box-shadow: 0 0 0 3px rgba(125, 119, 106, 0.13);
  }
`

export const FormSelect = styled.select`
  width: 100%;
  border: 1px solid var(--color-neutral-30);
  border-radius: 1.2rem;
  padding: 1.25rem 1.35rem;
  background: var(--color-neutral-10);
  color: var(--color-neutral-90);
  font-size: 1.4rem;
  outline: none;

  &:focus {
    border-color: var(--t-primary-btn-bg);
    box-shadow: 0 0 0 3px rgba(125, 119, 106, 0.13);
  }

  &:disabled {
    background: var(--color-neutral-15);
    color: var(--color-neutral-50);
  }
`

export const RadioLine = styled.label`
  display: flex;
  align-items: center;
  gap: 0.9rem;
  margin-top: 1.6rem;
  color: var(--color-neutral-90);
  font-size: 1.4rem;
  font-weight: 800;
  cursor: pointer;

  &:first-of-type {
    margin-top: 0;
  }

  input {
    accent-color: var(--t-primary-btn-bg);
  }
`

export const InfoText = styled.p`
  margin: 0.8rem 0 0;
  color: var(--color-neutral-60);
  font-size: 1.22rem;
  line-height: 1.6;
`

export const ErrorText = styled.p`
  margin: 1rem 0 0;
  color: var(--color-error-70);
  font-size: 1.25rem;
  font-weight: 700;
`

export const SuccessText = styled.p`
  margin: 1rem 0 0;
  color: var(--color-success-70);
  font-size: 1.25rem;
  font-weight: 800;
`

export const SecondaryActionButton = styled(ActionButton)`
  background: var(--color-neutral-20);
  color: var(--color-neutral-80);
  box-shadow: none;

  &:hover:not(:disabled) {
    background: var(--color-neutral-30);
    transform: none;
  }
`

export const WizardButtonWrap = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1.2rem;
  margin-top: 3.2rem;

  > button {
    width: 100%;
    min-height: 5.2rem;
    font-size: 1.4rem;
  }

  @media (max-width: 560px) {
    grid-template-columns: 1fr;
  }
`

export const ManualGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1.2rem;

  @media (max-width: 768px) {
    grid-template-columns: 1fr;
  }
`

export const ManualLabel = styled.div`
  margin-bottom: 0.6rem;
  color: var(--color-neutral-60);
  font-size: 1.15rem;
  font-weight: 900;
  letter-spacing: 0.04em;
  text-transform: uppercase;
`



// Language / Terms (EULA) — legacy GUI guide의 흐름을 Modern Neutral 테마에 맞춰 재구성.
export const LanguageList = styled.div`
  display: grid;
  gap: 1rem;
`

export const LanguageOption = styled.button`
  width: 100%;
  min-height: 8rem;
  display: flex;
  align-items: center;
  gap: 1.4rem;
  border: 1px solid ${({ $active }) => ($active ? 'var(--t-primary-btn-bg)' : 'var(--color-neutral-20)')};
  border-radius: 1.4rem;
  background: ${({ $active }) => ($active ? 'var(--color-neutral-15)' : 'var(--color-neutral-10)')};
  padding: 1.4rem 1.6rem;
  text-align: left;
  cursor: pointer;
  transition: 0.15s ease;
  box-shadow: ${({ $active }) => ($active ? '0 0 0 3px rgba(125, 119, 106, 0.10)' : 'none')};

  &:hover {
    border-color: var(--color-neutral-40);
    background: var(--color-neutral-15);
  }
`

export const LanguageRadio = styled.span`
  width: 2rem;
  height: 2rem;
  flex: 0 0 2rem;
  border: 2px solid ${({ $active }) => ($active ? 'var(--t-primary-btn-bg)' : 'var(--color-neutral-40)')};
  border-radius: 50%;
  background: ${({ $active }) => ($active ? 'var(--t-primary-btn-bg)' : 'transparent')};
  box-shadow: ${({ $active }) => ($active ? 'inset 0 0 0 5px var(--color-neutral-10)' : 'none')};
`

export const LanguageBadge = styled.span`
  width: 5.2rem;
  height: 5.2rem;
  flex: 0 0 5.2rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: ${({ $active }) => ($active ? 'var(--t-primary-btn-text)' : 'var(--color-neutral-70)')};
  background: ${({ $active }) => ($active ? 'var(--t-primary-btn-bg)' : 'var(--color-neutral-20)')};
  font-size: 1.55rem;
  font-weight: 900;
`

export const LanguageText = styled.span`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
`

export const LanguageName = styled.span`
  color: var(--color-neutral-90);
  font-size: 1.65rem;
  font-weight: 800;
`

export const LanguageSubName = styled.span`
  color: var(--color-neutral-60);
  font-size: 1.2rem;
  font-weight: 600;
`

export const WizardButtonWrapSingle = styled.div`
  display: flex;
  justify-content: flex-end;
  margin-top: 3.2rem;

  > button {
    width: min(36rem, 100%);
    min-height: 5.2rem;
    font-size: 1.4rem;
  }
`

export const TermsList = styled.div`
  overflow: hidden;
  border: 1px solid var(--color-neutral-20);
  border-radius: 1.5rem;
  background: var(--color-neutral-10);
`

export const TermRow = styled.div`
  min-height: 7.4rem;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 1.3rem;
  padding: 1.2rem 1.5rem;

  & + & {
    border-top: 1px solid var(--color-neutral-20);
  }
`

export const TermCheckButton = styled.button`
  width: 2.5rem;
  height: 2.5rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 2px solid ${({ $checked }) => ($checked ? 'var(--t-primary-btn-bg)' : 'var(--color-neutral-40)')};
  border-radius: 50%;
  background: ${({ $checked }) => ($checked ? 'var(--t-primary-btn-bg)' : 'transparent')};
  color: var(--t-primary-btn-text);
  cursor: pointer;
  padding: 0;
`

export const TermCheckMark = styled.span`
  font-size: 1.45rem;
  font-weight: 900;
  line-height: 1;
`

export const TermLabel = styled.div`
  color: var(--color-neutral-90);
  font-size: 1.5rem;
  font-weight: 750;
  line-height: 1.45;
`

export const TermArrowButton = styled.button`
  min-width: 4.2rem;
  min-height: 4.2rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 1rem;
  background: transparent;
  color: var(--color-neutral-60);
  font-size: 3.2rem;
  font-weight: 300;
  line-height: 1;
  cursor: pointer;

  &:hover {
    background: var(--color-neutral-15);
    color: var(--color-neutral-90);
  }
`

export const TermsDetailHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 1.2rem;
  margin-bottom: 1.8rem;
`

export const TermsBackButton = styled.button`
  width: 4.4rem;
  height: 4.4rem;
  flex: 0 0 4.4rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--color-neutral-20);
  border-radius: 1.1rem;
  background: var(--color-neutral-10);
  color: var(--color-neutral-90);
  font-size: 2.4rem;
  cursor: pointer;

  &:hover {
    background: var(--color-neutral-15);
  }
`

export const TermsDetailTitle = styled.h3`
  margin: 0;
  color: var(--color-neutral-90);
  font-size: 1.7rem;
  font-weight: 850;
`

export const TermsDetailBody = styled.div`
  min-height: 38rem;
  max-height: 52rem;
  overflow-y: auto;
  border: 1px solid var(--color-neutral-20);
  border-radius: 1.5rem;
  background: var(--color-neutral-15);
  padding: 2rem;
`
