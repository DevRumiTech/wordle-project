import { useEffect, useState } from 'react'
import { authApi } from './api/auth'
import WordleGame from './game/WordleGame'
import './App.css'

function AuthForm({ onLogin }) {
  const [mode, setMode] = useState('login')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const registering = mode === 'register'

  async function submit(event) {
    event.preventDefault()
    if (pending) return
    const form = event.currentTarget
    const values = new FormData(form)
    setPending(true)
    setError('')
    setNotice('')
    try {
      if (registering) {
        await authApi.register({ username: values.get('username'), email: values.get('email'), password: values.get('password') })
        form.reset()
        setMode('login')
        setNotice('Account created. You can now sign in.')
      } else {
        await authApi.login({ identifier: values.get('identifier'), password: values.get('password') })
        form.reset()
        await onLogin()
      }
    } catch (failure) {
      setError(failure.message)
    } finally {
      // Clear the password after every submission, including failed requests.
      const passwordInput = form.elements.namedItem('password')
      if (passwordInput) passwordInput.value = ''
      setPending(false)
    }
  }

  return <section className="auth-card" aria-labelledby="auth-title">
    <h2 id="auth-title">{registering ? 'Create your account' : 'Sign in'}</h2>
    <p>{registering ? 'Keep your Wordle account ready for your games.' : 'Welcome back to Wordle.'}</p>
    {notice && <p className="auth-notice" role="status">{notice}</p>}
    {error && <p className="auth-error" role="alert">{error}</p>}
    <form key={mode} onSubmit={submit} aria-busy={pending}>
      <fieldset disabled={pending}>
        {registering ? <>
          <label htmlFor="username">Username</label>
          <input id="username" name="username" autoComplete="username" maxLength={30} required />
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" maxLength={255} required />
        </> : <>
          <label htmlFor="identifier">Username or email</label>
          <input id="identifier" name="identifier" autoComplete="username" maxLength={255} required />
        </>}
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password"
          autoComplete={registering ? 'new-password' : 'current-password'}
          minLength={registering ? 8 : undefined} required
          aria-describedby={registering ? 'password-help' : undefined} />
        {registering && <p id="password-help" className="auth-help">At least 8 characters; maximum 72 bytes.</p>}
        <button type="submit">{pending ? 'Please wait…' : registering ? 'Create account' : 'Sign in'}</button>
      </fieldset>
    </form>
    <button type="button" className="auth-secondary" disabled={pending} onClick={() => {
      setMode(registering ? 'login' : 'register')
      setError('')
      setNotice('')
    }}>{registering ? 'Already have an account? Sign in' : 'Create an account'}</button>
  </section>
}

function App() {
  const [user, setUser] = useState(null)
  const [state, setState] = useState('loading')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  useEffect(() => {
    let active = true
    authApi.me().then(account => {
      if (active) { setUser(account); setState('ready') }
    }).catch(failure => {
      if (active) { setError(failure.message); setState('error') }
    })
    return () => { active = false }
  }, [])

  async function refresh() {
    setState('loading')
    setError('')
    try {
      setUser(await authApi.me())
      setState('ready')
    } catch (failure) {
      setError(failure.message)
      setState('error')
    }
  }

  async function logout() {
    if (pending) return
    setPending(true)
    setError('')
    try {
      await authApi.logout()
      setUser(null)
    } catch (failure) {
      if (failure.status === 401) setUser(null)
      else setError(failure.message)
    } finally { setPending(false) }
  }

  return <main className={user ? "auth-page playing" : "auth-page"}>
    <header><h1>Wordle Game</h1><p>Welcome to my Wordle project!</p></header>
    {state === 'loading' ? <p role="status">Checking your session…</p> : state === 'error' ?
      <section className="auth-card"><p role="alert" className="auth-error">{error}</p>
        <button onClick={refresh}>Try again</button></section> : user ?
      <section className="game-page" aria-labelledby="account-title">
        <h2 id="account-title">You’re signed in</h2>
        <WordleGame />
        {error && <p role="alert" className="auth-error">{error}</p>}
        <button onClick={logout} disabled={pending}>{pending ? 'Signing out…' : 'Sign out'}</button>
      </section> : <AuthForm onLogin={refresh} />}
  </main>
}

export default App
