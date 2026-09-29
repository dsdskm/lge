import styled from 'styled-components'

export const LoginContainer = styled.div`
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  background-color: var(--color-secondary-10);
  background: linear-gradient(136deg, #80c3e2 0%, #95c2dc 95.46%);
  overflow-y: auto;
  --login-language-icon-color: var(--t-primary-btn-bg);
`

export const LoginBox = styled.div`
  width: 100%;
  max-width: 55rem;
  padding: 4.8rem 4rem;
  background: var(--color-neutral-10);
  border-radius: 1.6rem;
  box-shadow: 0 1rem 3rem rgba(0, 0, 0, 0.05);
  display: flex;
  flex-direction: column;
`

export const LogoWrapper = styled.div`
  align-items: center;
  flex-direction: column;
  display: flex;
  margin-bottom: 2em;
  font-size: initial !important;
`

export const Title = styled.h2`
  margin-bottom: 4rem;
  color: var(--color-neutral-80);
`

export const FormGroup = styled.div`
  margin-bottom: 1.6rem;
`

export const ErrorMessage = styled.p`
  color: var(--color-error-70);
  margin: 0.8rem 0 2rem;
  font-weight: 500;
`

export const LanguageSelectWrapper = styled.div`
  align-self: flex-end;
  display: flex;
  align-items: center;
  gap: 0.8rem;

  button.language {
    color: var(--login-language-icon-color) !important;

    @media all and (max-width: 767px) {
      background: transparent !important;
      border-radius: var(--radius-xs) !important;
    }

    .icon {
      &:hover {
        background: transparent;
      }

      &:active {
        background: transparent;
      }

      @media all and (max-width: 767px) {
        border-radius: var(--radius-xs) !important;
      }
    }
  }

  .languageSelect {
    @media all and (max-width: 767px) {
      position: relative;
      right: auto;
      z-index: auto;
      bottom: auto;

      .languageOption {
        top: calc(100% + 0.2rem) !important;
      }
    }
  }
`

export const ButtonWrapper = styled.div`
  margin-top: 3.2rem;
  display: flex;
  gap: 1.6rem;
`

export const Footer = styled.div`
  position: absolute;
  bottom: 2.4rem;
  right: 2.4rem;
  color: var(--color-neutral-80);
`

export const FieldLabel = styled.p`
  white-space: pre-wrap;
  margin-bottom: 0.7rem;
`
