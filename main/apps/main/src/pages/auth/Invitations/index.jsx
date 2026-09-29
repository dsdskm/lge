import { useEffect, useState } from 'react'
import { invitationTokensValidate, acceptInvitation } from '@repo/apis'
import { useForm, Controller } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Button, Input, LogoLogin } from '@repo/ui'
import { validatePassword } from '@repo/utils'
import { ClipLoader } from 'react-spinners'
import { useSearchParams } from 'react-router-dom'
import { useModalState } from '@repo/hooks'
import ModalBasic from '../modal/ModalBasic'
import { useUserStore } from '@repo/stores'
import {
  LoginContainer,
  LoginBox,
  LogoWrapper,
  FormGroup,
  ErrorMessage,
  ButtonWrapper,
  GreenDescBox,
  GreenDescItem
} from '../Login/styles'

function Invitations() {
  const { t } = useTranslation('login')
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [invitationId, setInvitationId] = useState('')

  const [searchParams] = useSearchParams()
  const invitationToken = searchParams.get('invitationToken') ?? ''
  const hasInvitationToken = Boolean(invitationToken)

  const [isTokenValidating, setIsTokenValidating] = useState(false)
  const [isTokenValid, setIsTokenValid] = useState(false)

  const {
    control,
    handleSubmit,
    getValues,
    formState: { errors }
  } = useForm({
    defaultValues: { email: '', nickname: '', pw: '', pwc: '' },
    mode: 'onSubmit',
    reValidateMode: 'onChange'
  })

  const handlePassError = (errorData) => {
    const isPasswordInvalid = errorData?.validationErrors?.some((err) => err.field === 'userPassword')

    if (isPasswordInvalid) {
      setErrorMessage(t('passwordInvalid'))
      return
    }

    setErrorMessage(t('unknownError'))
  }

  useEffect(() => {
    // 토큰 없으면 검증 불가 → 입력 disabled 유지
    if (!hasInvitationToken) {
      setIsTokenValid(false)
      setErrorMessage('error')
      return
    }

    const runValidate = async () => {
      setIsTokenValidating(true)
      setErrorMessage('')

      try {
        const res = await invitationTokensValidate(invitationToken)

        if (res) {
          setIsTokenValid(true)
          setInvitationId(res?.invitationId ?? '')
        } else {
          setIsTokenValid(false)
          handlePassError(res)
        }
      } catch (e) {
        setIsTokenValid(false)
        handlePassError(e?.response?.data)
      } finally {
        setIsTokenValidating(false)
      }
    }

    runValidate()
  }, [hasInvitationToken, invitationToken])

  const formDisabled = !hasInvitationToken || isTokenValidating || !isTokenValid

  const onSubmit = async (data) => {
    setIsLoading(true)
    setErrorMessage('')
    try {
      const response = await acceptInvitation(invitationId, data.nickname, data.email, data.pw)

      if (response || response == '') {
        openModalBasic()
      } else {
        handlePassError(response.data)
        setIsLoading(false)
        return
      }

      const store = useUserStore.getState()
      store.logout()
    } catch (error) {
      handlePassError(error.response?.data)
      setIsLoading(false)
    }
  }

  const BasicModal = useModalState()

  const openModalBasic = (data) => {
    setIsLoading(false)
    BasicModal.onOpen()
  }

  const moveToLogin = () => {
    BasicModal.onClose()
    window.location.href = '/login'
  }

  return (
    <>
      <LoginContainer>
        <LogoWrapper>
          <LogoLogin disableLink />
        </LogoWrapper>
        <LoginBox>
          <GreenDescBox>
            <GreenDescItem>{t('inputEmailPw')}</GreenDescItem>
          </GreenDescBox>
          <form onSubmit={handleSubmit(onSubmit)}>
            <FormGroup>
              <p className="typographyBody4" style={{ whiteSpace: 'pre-wrap', marginBottom: '0.7rem' }}>
                {t('email') + ' *'}
              </p>
              <Controller
                name="email"
                control={control}
                rules={{
                  required: t('emailRequired'),
                  pattern: {
                    value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                    message: t('emailInvalid')
                  }
                }}
                render={({ field, fieldState }) => (
                  <Input
                    type="text"
                    placeholder={t('emailPlaceholder')}
                    disabled={formDisabled}
                    isError={!!fieldState.error}
                    message={fieldState.error?.message}
                    size="md"
                    value={field.value ?? ''} // ✅ 항상 문자열로 유지
                    onChange={(e) => field.onChange(e?.target?.value ?? '')}
                    onBlur={field.onBlur}
                    name={field.name}
                    ref={field.ref}
                  />
                )}
              />
            </FormGroup>

            <FormGroup>
              <p className="typographyBody4" style={{ whiteSpace: 'pre-wrap', marginBottom: '0.7rem' }}>
                {t('nickname') + ' *'}
              </p>
              <Controller
                name="nickname"
                control={control}
                rules={{
                  required: t('required')
                }}
                render={({ field, fieldState }) => (
                  <Input
                    type="text"
                    placeholder={t('nickname')}
                    disabled={formDisabled}
                    isError={!!fieldState.error}
                    message={fieldState.error?.message}
                    size="md"
                    value={field.value ?? ''} // ✅ 항상 문자열로 유지
                    onChange={(e) => field.onChange(e?.target?.value ?? '')}
                    onBlur={field.onBlur}
                    name={field.name}
                    ref={field.ref}
                  />
                )}
              />
            </FormGroup>

            <FormGroup>
              <p className="typographyBody4" style={{ whiteSpace: 'pre-wrap', marginBottom: '0.7rem' }}>
                {t('newPassword') + ' *'}
              </p>

              <Controller
                name="pw"
                control={control}
                rules={{
                  required: t('required'),
                  validate: (value) => {
                    const { isValid } = validatePassword(value)
                    return isValid || t('passwordGuide')
                  }
                }}
                render={({ field, fieldState }) => (
                  <Input
                    type="password"
                    placeholder={t('passwordPlaceholder')}
                    disabled={formDisabled}
                    isError={!!fieldState.error}
                    message={fieldState.error?.message}
                    size="md"
                    value={field.value ?? ''} // ✅ 항상 문자열
                    onChange={(e) => field.onChange(e?.target?.value ?? '')}
                    onBlur={field.onBlur}
                    name={field.name}
                    ref={field.ref}
                  />
                )}
              />
            </FormGroup>

            <FormGroup>
              <p className="typographyBody4" style={{ whiteSpace: 'pre-wrap', marginBottom: '0.7rem' }}>
                {t('passwordConfirm') + ' *'}
              </p>

              <Controller
                name="pwc"
                control={control}
                rules={{
                  required: t('required'),
                  validate: (value) => value === getValues('pw') || t('passwordMismatch')
                }}
                render={({ field, fieldState }) => (
                  <Input
                    type="password"
                    disabled={formDisabled}
                    isError={!!fieldState.error}
                    message={fieldState.error?.message}
                    size="md"
                    value={field.value ?? ''} // ✅ 항상 문자열
                    onChange={(e) => field.onChange(e?.target?.value ?? '')}
                    onBlur={field.onBlur}
                    name={field.name}
                    ref={field.ref}
                  />
                )}
              />
            </FormGroup>

            {errorMessage && <ErrorMessage className="typographyBody6">{errorMessage}</ErrorMessage>}

            <ButtonWrapper>
              <Button type="submit" size="lg" disabled={isLoading} style={{ width: '100%' }}>
                {isLoading ? <ClipLoader color={'#ffffff'} loading={isLoading} size={20} /> : t('가입 완료')}
              </Button>
            </ButtonWrapper>
          </form>
        </LoginBox>
      </LoginContainer>
      <ModalBasic
        isOpen={BasicModal.isOpen}
        onClose={BasicModal.onClose}
        onConfirm={moveToLogin}
        t={t}
        descIdx={0}
        btnIdx={0}
      />
    </>
  )
}

export default Invitations
