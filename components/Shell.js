'use client'
import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import Icon from '@/components/Icons'
import ResultsAlert from '@/components/ResultsAlert'

const ALL = ['registrar', 'prescriber', 'dispenser', 'lab', 'admin']
const LINKS = [
  { href: '/dashboard', label: 'Dashboard', icon: 'dashboard', roles: ALL },
  { href: '/register', label: 'Registration', icon: 'register', roles: ['registrar', 'admin'] },
  { href: '/patients', label: 'Patients', icon: 'consult', roles: ['prescriber', 'admin'] },
  { href: '/laboratory', label: 'Laboratory', icon: 'lab', roles: ['lab', 'admin'] },
  { href: '/dispense', label: 'Pharmacy', icon: 'pharmacy', roles: ['dispenser', 'admin'] },
  { href: '/admin', label: 'Administration', icon: 'admin', roles: ['admin'] },
]
const ROLE_NAMES = { registrar: 'Registration', prescriber: 'Doctor', dispenser: 'Pharmacist', lab: 'Laboratory', admin: 'Administrator' }

export default function Shell({ roles, title, children }) {
  const router = useRouter()
  const path = usePathname()
  const [profile, setProfile] = useState(null)
  const [error, setError] = useState('')
  const [menu, setMenu] = useState(false)

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
  if (!profile) return <div className="center muted">Loading…</div>
  if (profile.role === 'pending')
    return (
      <div className="center card">
        <h2>Waiting for approval</h2>
        <p>Your account ({profile.email}) has no role yet. Ask the administrator to assign you one.</p>
        <button onClick={logout}>Sign out</button>
      </div>
    )
  const allowed = roles.includes(profile.role)
  const name = profile.full_name || profile.email
  return (
    <div className={'app' + (menu ? ' menu-open' : '')}>
      <aside className="side">
        <div className="brand"><span className="logo"><Icon name="cross" size={18} /></span><div><b>Afya HMS</b><small>Hospital management</small></div></div>
        <nav>
          {LINKS.filter((l) => l.roles.includes(profile.role)).map((l) => (
            <Link key={l.href} href={l.href} className={path === l.href || path.startsWith(l.href + '/') ? 'active' : ''} onClick={() => setMenu(false)}>
              <Icon name={l.icon} /> {l.label}
            </Link>
          ))}
        </nav>
        <div className="me">
          <div className="avatar">{name.slice(0, 1).toUpperCase()}</div>
          <div className="who"><b>{name}</b><small>{ROLE_NAMES[profile.role]}</small></div>
          <button className="icon" title="Sign out" onClick={logout}><Icon name="logout" /></button>
        </div>
      </aside>
      <div className="content">
        <header className="top">
          <button className="icon burger" onClick={() => setMenu(!menu)}><Icon name="menu" /></button>
          <h1>{title || LINKS.find((l) => path.startsWith(l.href))?.label}</h1>
          <span className="grow" />
          <span className="today">{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
        </header>
        {['prescriber', 'admin'].includes(profile.role) && <ResultsAlert userId={profile.id} />}
        <main>{allowed ? children : <div className="card">You do not have access to this page.</div>}</main>
      </div>
    </div>
  )
}
