'use client'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Shell from '@/components/Shell'
import { supabase } from '@/lib/supabase'

const when = (t) => (t ? new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '')
const TABS = [
  ['waiting', 'Pending'],
  ['in_consultation', 'In consultation'],
  ['seen', 'Seen'],
]

function Patients() {
  const router = useRouter()
  const [tab, setTab] = useState('waiting')
  const [list, setList] = useState([])
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('visits').select('*, patients(*)').order('checked_in_at', { ascending: false }).limit(500)
    if (error) setErr(error.message); else setList(data || [])
  }, [])
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t) }, [load])

  const count = (s) => list.filter((v) => v.status === s).length
  const term = q.toLowerCase()
  const shown = list
    .filter((v) => v.status === tab && `${v.patients?.full_name} ${v.patients?.patient_no} ${v.patients?.phone}`.toLowerCase().includes(term))
    .sort((a, b) => (tab === 'waiting' ? new Date(a.checked_in_at) - new Date(b.checked_in_at)
      : new Date(b.completed_at || b.updated_at) - new Date(a.completed_at || a.updated_at)))

  return (
    <div className="card">
      <div className="bar">
        <div className="tabs">
          {TABS.map(([k, label]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label} ({count(k)})</button>)}
        </div>
        <input placeholder="Search name, number or phone…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {err && <p className="error">{err}</p>}
      {shown.length === 0 ? (
        <p className="empty">{tab === 'waiting' ? 'No patients waiting. New patients appear here after registration.' : tab === 'seen' ? 'No seen patients yet.' : 'No consultations in progress.'}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>{tab === 'waiting' ? 'Queue' : '#'}</th><th>Patient</th><th>Age / Sex</th><th>Payment</th>
              <th>{tab === 'seen' ? 'Seen at' : 'Registered'}</th><th>Doctor</th><th /></tr></thead>
            <tbody>
              {shown.map((v, i) => (
                <tr key={v.id}>
                  <td>{i + 1}</td>
                  <td><b>{v.patients?.full_name}</b><div className="muted">{v.patients?.patient_no} · {v.patients?.phone}</div></td>
                  <td>{v.patients?.age} · {v.patients?.sex}</td>
                  <td><span className={'badge ' + (v.patients?.payment_method === 'Insurance' ? 'ins' : 'cash')}>{v.patients?.payment_method === 'Insurance' ? 'Insured' : 'Cash'}</span></td>
                  <td className="muted">{when(tab === 'seen' ? v.completed_at : v.checked_in_at)}</td>
                  <td>{v.doctor_name || <span className="muted">—</span>}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button onClick={() => router.push('/consult/' + v.id)}>{tab === 'waiting' ? 'Attend' : tab === 'seen' ? 'View / edit' : 'Continue'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function Page() { return <Shell roles={['prescriber', 'admin']} title="Patients"><Patients /></Shell> }
