import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Section, StyledPageContent, Title } from '@repo/ui'
import useRobotSetupStatus from '@/hooks/useRobotSetupStatus'
import { completeSetup } from '@/utils/setupProgress'
import UploadTable from './uploadTable'
/**
 * Upload
 *
 * 설치 순서의 마지막 단계. 실제 업로드 기능은 아직 없고, 여기서 셋업 전역 완료만 기록한다
 * (utils/setupProgress.completeSetup → robotSetup.status = 'completed').
 *
 * 이 단계까지 와야 완료가 되는 이유: status 'completed' 는 순서 잠금을 모두 풀고 초기 설정 메뉴를
 * 감춘다(App.jsx). 앞 단계에서 올리면 맵 스캔/시맨틱을 건너뛴 채 이 화면이 열린다.
 * 완료 이후 맵을 다시 스캔해도 이 상태는 유지된다(utils/setupProgress.advanceSetupProgress).
 */
const Upload = () => {
  const navigate = useNavigate()
  const { completed } = useRobotSetupStatus()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const handleComplete = async () => {
    if (busy) return
    setBusy(true)
    setErr('')
    try {
      await completeSetup()
      // 헤더 탭/사이드바 구성이 완료 여부로 달라지므로, 갱신된 상태로 다시 그린다.
      navigate('/download', { replace: true })
      window.location.reload()
    } catch (error) {
      setErr(`설치 완료 처리 실패: ${error.message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <StyledPageContent className="column">
      <Section gap="1.2rem">
        <UploadTable></UploadTable>
      </Section>
    </StyledPageContent>
  )
}

export default Upload
