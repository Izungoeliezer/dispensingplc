'use client'
import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

const LINKS = [
  { href: '/prescribe', label: 'Prescribe', roles: ['prescriber', 'admin'] },
  { href: '/dispense', label: 'Dispense', roles: ['dispenser', 'admin'] },
  { href: '/admin', label: 'Admin', roles: ['admin'] },
]

export default function Shell({ roles, children }) {
  const router = useRouter()
  const path = usePathname()
  const [profile, setProfile] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return router.replace('/login')
      const { data, error } = await supabase.from('profiles').select('*').eq('id', session.user.id).single()
      if (error) return setError(error.message)
      setProfile(data)
    })()
  }, [router])

  const logout = async () => { await supabase.auth.signOut(); router.replace('/login') }

  if (error) return <div className="center card">{error}</div>
  if (!profile) return <div className="center">Loading…</div>
  if (profile.role === 'pending')
    return (
      <div className="center card">
        <h2>Waiting for approval</h2>
        <p>Your account ({profile.email}) has no role yet. Ask the administrator to assign you one.</p>
        <button onClick={logout}>Sign out</button>
      </div>
    )
  const allowed = roles.includes(profile.role)
  return (
    <>
      <header>
        <b>Dispensing Unit</b>
        <nav>
          {LINKS.filter((l) => l.roles.includes(profile.role)).map((l) => (
            <Link key={l.href} href={l.href} className={path === l.href ? 'active' : ''}>{l.label}</Link>
          ))}
        </nav>
        <span className="grow" />
        <span className="muted">{profile.full_name || profile.email} · {profile.role}</span>
        <button className="ghost" onClick={logout}>Sign out</button>
      </header>
      <main>
        {allowed ? children : <div className="card">You do not have access to this page.</div>}
      </main>
    </>
  )
}
