'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import Icon from '@/components/Icons'

export default function Login() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (error) setErr(error.message); else router.replace('/')
  }
  return (
    <div className="login-wrap">
      <div className="login-art">
        <span className="logo"><Icon name="cross" size={26} /></span>
        <h1>Afya HMS</h1>
        <p>Registration, consultation, laboratory and pharmacy in one connected system.</p>
      </div>
      <div className="login-form">
        <form onSubmit={submit}>
          <h2>Sign in</h2>
          <p className="muted" style={{ marginTop: 0 }}>Use the account created for you by the administrator.</p>
          <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
          {err && <p className="error">{err}</p>}
          <button disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
      </div>
    </div>
  )
}
