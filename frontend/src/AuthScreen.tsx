import { useState, type FormEvent } from 'react'
import { ArrowRight, Command, LoaderCircle } from 'lucide-react'

type RegistrationData = {
  email: string
  full_name: string
  password: string
  workspace_name: string
}

type AuthScreenProps = {
  backendOnline: boolean
  onLogin: (email: string, password: string) => Promise<void>
  onRegister: (data: RegistrationData) => Promise<void>
}

function AuthScreen({ backendOnline, onLogin, onRegister }: AuthScreenProps) {
  const [isRegistering, setIsRegistering] = useState(false)
  const [fullName, setFullName] = useState('')
  const [workspaceName, setWorkspaceName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setIsSubmitting(true)

    try {
      if (isRegistering) {
        await onRegister({
          email,
          full_name: fullName,
          password,
          workspace_name: workspaceName,
        })
      } else {
        await onLogin(email, password)
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to sign in.')
    } finally {
      setIsSubmitting(false)
    }
  }

  function changeMode(registerMode: boolean) {
    setIsRegistering(registerMode)
    setError('')
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-brand">
          <span className="brand-mark"><Command size={21} strokeWidth={2.4} /></span>
          <span className="brand-name">sync<span>space</span></span>
        </div>
        <p className="auth-eyebrow">A calmer way to work together</p>
        <h1 id="auth-title">{isRegistering ? 'Create your workspace' : 'Welcome back'}</h1>
        <p className="auth-subtitle">
          {isRegistering
            ? 'Set up your account to organize projects and tasks.'
            : 'Sign in to continue to your SyncSpace workspace.'}
        </p>

        {!backendOnline && (
          <p className="auth-error" role="alert">
            The SyncSpace API is unavailable. Start the backend and try again.
          </p>
        )}

        <form className="auth-form" onSubmit={(event) => void submit(event)}>
          {isRegistering && (
            <>
              <label className="form-field">
                <span>Your name</span>
                <input
                  autoComplete="name"
                  required
                  maxLength={100}
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                />
              </label>
              <label className="form-field">
                <span>Workspace name</span>
                <input
                  autoComplete="organization"
                  required
                  maxLength={100}
                  value={workspaceName}
                  onChange={(event) => setWorkspaceName(event.target.value)}
                />
              </label>
            </>
          )}
          <label className="form-field">
            <span>Email address</span>
            <input
              type="email"
              autoComplete="email"
              required
              maxLength={320}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className="form-field">
            <span>Password</span>
            <input
              type="password"
              autoComplete={isRegistering ? 'new-password' : 'current-password'}
              required
              minLength={isRegistering ? 12 : 1}
              maxLength={128}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            {isRegistering && <small>Use at least 12 characters.</small>}
          </label>

          {error && <p className="auth-error" role="alert">{error}</p>}

          <button className="button button-primary auth-submit" type="submit" disabled={isSubmitting || !backendOnline}>
            {isSubmitting ? <LoaderCircle className="auth-spinner" size={17} /> : null}
            {isRegistering ? 'Create account' : 'Sign in'}
            {!isSubmitting && <ArrowRight size={16} />}
          </button>
        </form>

        <p className="auth-switch">
          {isRegistering ? 'Already have an account?' : 'New to SyncSpace?'}
          <button type="button" onClick={() => changeMode(!isRegistering)}>
            {isRegistering ? 'Sign in' : 'Create an account'}
          </button>
        </p>
      </section>
    </main>
  )
}

export default AuthScreen
