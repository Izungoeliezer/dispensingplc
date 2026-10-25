'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import Shell from '@/components/Shell'
import { supabase } from '@/lib/supabase'

const count = async (table, build) => {
  let q = supabase.from(table).select('id', { count: 'exact', head: true })
  if (build) q = build(q)
  const { count } = await q
  return count ?? 0
}

function Dashboard() {
  const [s, setS] = useState(null)
  const [role, setRole] = useState('')
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const { data: me } = await supabase.from('profiles').select('role, full_name').eq('id', session.user.id).single()
      setRole(me?.role)
      const start = new Date(); start.setHours(0, 0, 0, 0)
      const iso = start.toISOString()
      const uid = session.user.id
      const [patientsToday, rxPending, rxToday, dispensedToday, labPending, labDone, waiting, inConsult, seenToday, resultsReady] = await Promise.all([
        count('patients', (q) => q.gte('created_at', iso)),
        count('prescriptions', (q) => q.eq('status', 'pending')),
        count('prescriptions', (q) => q.gte('created_at', iso)),
        count('prescriptions', (q) => q.eq('status', 'dispensed').gte('dispensed_at', iso)),
        count('lab_orders', (q) => q.neq('status', 'Completed')),
        count('lab_orders', (q) => q.eq('status', 'Completed').gte('completed_at', iso)),
        count('visits', (q) => q.eq('status', 'waiting')),
        count('visits', (q) => q.eq('status', 'in_consultation')),
        count('visits', (q) => q.eq('status', 'seen').gte('completed_at', iso)),
        count('lab_orders', (q) => q.eq('status', 'Completed').is('result_seen_at', null).eq('requested_by', uid)),
      ])
      setS({ patientsToday, rxPending, rxToday, dispensedToday, labPending, labDone, waiting, inConsult, seenToday, resultsReady })
    })()
  }, [])

  const cards = {
    registrar: [['Patients registered today', 'patientsToday', ''], ['Waiting for a doctor', 'waiting', 'warn']],
    prescriber: [['Patients waiting', 'waiting', 'warn'], ['In consultation', 'inConsult', 'info'], ['Seen today', 'seenToday', 'ok'], ['Lab results to review', 'resultsReady', 'warn']],
    dispenser: [['Awaiting dispensing', 'rxPending', 'warn'], ['Dispensed today', 'dispensedToday', 'ok']],
    lab: [['Lab requests pending', 'labPending', 'warn'], ['Completed today', 'labDone', 'ok']],
    admin: [['Patients registered today', 'patientsToday', ''], ['Patients waiting', 'waiting', 'warn'], ['Seen today', 'seenToday', 'ok'], ['Awaiting dispensing', 'rxPending', 'warn'],
      ['Dispensed today', 'dispensedToday', 'ok'], ['Lab requests pending', 'labPending', 'warn'], ['Lab completed today', 'labDone', 'ok']],
  }[role] || []
  const go = {
    registrar: [['/register', 'Register a patient']],
    prescriber: [['/patients', 'Open patient queue']],
    dispenser: [['/dispense', 'Open pharmacy queue']],
    lab: [['/laboratory', 'Open lab requests']],
    admin: [['/register', 'Register patient'], ['/patients', 'Patients'], ['/laboratory', 'Laboratory'], ['/dispense', 'Pharmacy'], ['/admin', 'Prices & staff']],
  }[role] || []

  return (
    <>
      <div className="stats">
        {cards.map(([label, key, tone]) => (
          <div className={'stat ' + tone} key={key}><small>{label}</small><b>{s ? s[key] : '…'}</b></div>
        ))}
      </div>
      <div className="card">
        <h3>Quick actions</h3>
        <div className="actions">
          {go.map(([href, label]) => <Link key={href} href={href}><button className="ghost" type="button">{label}</button></Link>)}
        </div>
      </div>
    </>
  )
}

export default function Page() { return <Shell roles={['registrar', 'prescriber', 'dispenser', 'lab', 'admin']}><Dashboard /></Shell> }
