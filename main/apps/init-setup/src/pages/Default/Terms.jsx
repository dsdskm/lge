import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Modal, Section } from '@repo/ui'
import {
  StyledPageContent,
  PageHero,
  HeroText,
  HeroTitle,
  HeroDescription,
  SetupFormCard,
  SetupCardIntro,
  TermsList,
  TermRow,
  TermCheckButton,
  TermCheckMark,
  TermLabel,
  TermArrowButton,
  TermsDetailHeader,
  TermsBackButton,
  TermsDetailTitle,
  TermsDetailBody,
  ActionButton,
  SecondaryActionButton,
  WizardButtonWrap,
  ErrorText
} from './styles'
import { completeInitialSetup } from '@/utils/setupProgress'

const TERMS = [
  { id: 'service', title: '(필수) 서비스 이용 약관' },
  { id: 'software', title: '(필수) 소프트웨어 사용권 계약' }
]

const Terms = () => {
  const navigate = useNavigate()
  const [checked, setChecked] = useState({ service: false, software: false })
  const [detailId, setDetailId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // 완료 전 확인 모달 — 약관 동의가 초기 설정의 마지막이고, 완료하면 초기 설정 메뉴 자체가
  // 사라져(App.jsx setupCompleted) 되돌릴 수 없으므로 누르기 전에 한 번 알린다.
  const [confirmOpen, setConfirmOpen] = useState(false)

  const allChecked = TERMS.every(({ id }) => checked[id])
  const detail = TERMS.find(({ id }) => id === detailId)

  const toggle = (id) => {
    setChecked((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const openDetail = (id) => {
    setDetailId(id)
  }

  const closeDetailAndAgree = () => {
    if (detailId) {
      setChecked((prev) => ({ ...prev, [detailId]: true }))
    }
    setDetailId(null)
  }

  const handleComplete = async () => {
    if (!allChecked || busy) return

    setBusy(true)
    setErr('')
    setConfirmOpen(false)
    try {
      // 약관 동의가 초기 설정(1~6단계)의 마지막이다 — status 를 'completed' 로 올려 헤더에서
      // 초기 설정 탭이 사라지게 하고(App.jsx setupCompleted), 작업 단계는 맵 스캔으로 옮긴다.
      // 같은 값이 단계 순서 잠금도 풀기 때문에 이후에는 맵 스캔·시맨틱을 건너뛰고 업로드로도
      // 들어갈 수 있다(routes.jsx getSetupProgress).
      await completeInitialSetup()
      // '/download' 맵 설정 첫 화면으로 리다이렉트된다(router/routes.jsx mapIndex).
      navigate('/download', { replace: true })
      window.location.reload()
    } catch (error) {
      setErr(`초기 설정 완료 처리 실패: ${error.message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <StyledPageContent>
      <Section>
        <PageHero>
          <HeroText>
            <HeroTitle>서비스 이용약관</HeroTitle>
            <HeroDescription>서비스 이용에 필요한 약관을 확인하고 동의하세요.</HeroDescription>
          </HeroText>
        </PageHero>

        <SetupFormCard>
          {detail ? (
            <>
              <TermsDetailHeader>
                <TermsBackButton type="button" onClick={closeDetailAndAgree} aria-label="약관 목록으로 돌아가기">
                  ←
                </TermsBackButton>
                <TermsDetailTitle>{detail.title}</TermsDetailTitle>
              </TermsDetailHeader>
              <TermsDetailBody aria-label={`${detail.title} 상세 내용`} />
            </>
          ) : (
            <>
              <SetupCardIntro>이용 약관 및 정책을 확인하세요.</SetupCardIntro>

              <TermsList>
                {TERMS.map((term) => (
                  <TermRow key={term.id}>
                    <TermCheckButton
                      type="button"
                      $checked={checked[term.id]}
                      onClick={() => toggle(term.id)}
                      aria-label={`${term.title} ${checked[term.id] ? '동의 취소' : '동의'}`}
                      aria-pressed={checked[term.id]}
                    >
                      {checked[term.id] && <TermCheckMark>✓</TermCheckMark>}
                    </TermCheckButton>
                    <TermLabel>{term.title}</TermLabel>
                    <TermArrowButton
                      type="button"
                      onClick={() => openDetail(term.id)}
                      aria-label={`${term.title} 상세 보기`}
                    >
                      ›
                    </TermArrowButton>
                  </TermRow>
                ))}
              </TermsList>

              {err && <ErrorText>{err}</ErrorText>}

              <WizardButtonWrap>
                <SecondaryActionButton type="button" onClick={() => navigate('/robot-info')} disabled={busy}>
                  이전
                </SecondaryActionButton>
                {/* 완료는 곧바로 처리하지 않고 확인 모달을 먼저 띄운다 — 되돌릴 수 없는 단계다. */}
                <ActionButton type="button" onClick={() => setConfirmOpen(true)} disabled={!allChecked || busy}>
                  {busy ? '완료 처리 중...' : '완료'}
                </ActionButton>
              </WizardButtonWrap>
            </>
          )}
        </SetupFormCard>
      </Section>

      {/* 초기 설정 완료 확인 — 완료하면 초기 설정 그룹이 헤더·사이드바·라우트에서 사라지므로
          (App.jsx setupCompleted) 이 화면으로 돌아와 값을 고칠 수 없다. 그 사실을 누르기 전에
          알린다. Modal 의 footer 는 renderButtonComponent.props.children.length 로 버튼 폭을
          계산하므로 실제 버튼만 배열로 넘긴다(SetupOrderModal 과 같은 규약). */}
      <Modal
        isOpen={confirmOpen}
        size="sm"
        title="초기 설정 완료"
        onClose={() => setConfirmOpen(false)}
        renderButtonComponent={
          <>
            {[
              <Button key="cancel" size="lg" theme="secondary" onClick={() => setConfirmOpen(false)} disabled={busy}>
                취소
              </Button>,
              <Button key="confirm" size="lg" onClick={handleComplete} disabled={busy}>
                {busy ? '완료 처리 중...' : '완료'}
              </Button>
            ]}
          </>
        }
      >
        {/* 본문 레이아웃은 공용 GlobalErrorModal·SetupOrderModal 과 같은 형태로 맞춘다 */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.8rem',
            justifyContent: 'center',
            alignItems: 'center',
            textAlign: 'center',
            minHeight: '8rem',
            lineHeight: 1.5,
            width: '100%'
          }}
        >
          <div>약관에 동의하고 완료하면 초기 설정은 더 이상 수정할 수 없습니다.</div>
          <div>(언어 · 사이트 코드 · 설치 위치 · 로봇 정보 · 약관 동의)</div>
          <div>계속하시겠습니까?</div>
        </div>
      </Modal>
    </StyledPageContent>
  )
}

export default Terms
