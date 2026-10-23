'use client'
import { useCallback, useEffect, useState } from 'react'
import Shell from '@/components/Shell'
import { supabase } from '@/lib/supabase'

const when = (t) => new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })

function Order({ o, reload }) {
  const [result, setResult] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const run = async (fn, args) => {
    setBusy(true); setErr('')
    const { error } = await supabase.rpc(fn, args)
    setBusy(false)
    if (error) setErr(error.message); else reload()
  }
  const done = o.status === 'Completed'
  return (
    <div className={'card lab-card rx-card ' + (done ? 'done' : '')}>
      <div className="bar" style={{ margin: 0 }}>
        <h3 style={{ border: 0, padding: 0, margin: 0 }}>
          <span className={'tag ' + o.test_type.toLowerCase()}>{o.test_type}</span>{o.test_name}
        </h3>
        <span className={'badge ' + (done ? 'c' : o.status === 'In progress' ? 'progress' : 'p')}>{o.status}</span>
      </div>
      <div><b>{o.patient_name}</b> <span className="muted">{[o.patient_no, o.age, o.sex].filter(Boolean).join(' · ')}</span></div>
      <div className="muted">Requested by {o.requested_by_name} · {when(o.requested_at)}</div>
      {o.clinical_notes && <div className="muted"><b>Clinical notes:</b> {o.clinical_notes}</div>}
      {done ? (
        <>
          <div className="result">{o.result}</div>
          <div className="muted">Completed by {o.completed_by_name} · {when(o.completed_at)}</div>
        </>
      ) : (
        <>
          <label style={{ margin: '6px 0 0' }}>Result
            <textarea rows={3} value={result} onChange={(e) => setResult(e.target.value)} placeholder="Enter the result, e.g. Hb 11.2 g/dL, or: Malaria parasites not seen" />
          </label>
          {err && <div className="error">{err}</div>}
          <div className="actions">
            {o.status === 'Pending' && <button type="button" className="ghost" disabled={busy} onClick={() => run('lab_start', { p_id: o.id })}>Start / sample collected</button>}
            <button type="button" disabled={busy || !result.trim()} onClick={() => run('lab_complete', { p_id: o.id, p_result: result })}>Save result &amp; complete</button>
          </div>
        </>
      )}
    </div>
  )
}

function Laboratory() {
  const [list, setList] = useState([])
  const [tab, setTab] = useState('open')
  const [type, setType] = useState('')
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('lab_orders').select('*').order('requested_at', { ascending: false }).limit(300)
    if (error) setErr(error.message); else setList(data || [])
  }, [])
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t) }, [load])

  const open = list.filter((o) => o.status !== 'Completed')
  const shown = list.filter((o) => (tab === 'open' ? o.status !== 'Completed' : o.status === 'Completed')
    && (!type || o.test_type === type)
    && `${o.patient_name} ${o.patient_no} ${o.test_name}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (tab === 'open' ? new Date(a.requested_at) - new Date(b.requested_at) : new Date(b.completed_at) - new Date(a.completed_at)))

  return (
    <>
      <div className="bar">
        <div className="tabs">
          <button className={tab === 'open' ? 'on' : ''} onClick={() => setTab('open')}>Pending ({open.length})</button>
          <button className={tab === 'done' ? 'on' : ''} onClick={() => setTab('done')}>Completed</button>
        </div>
        <div className="actions">
          <select style={{ width: 'auto' }} value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All types</option><option>Laboratory</option><option>Radiology</option>
          </select>
          <input placeholder="Search patient or test…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      {err && <p className="error">{err}</p>}
      {shown.length === 0 && <div className="card muted">{tab === 'open' ? 'No pending requests.' : 'No completed results yet.'}</div>}
      {shown.map((o) => <Order key={o.id} o={o} reload={load} />)}
    </>
  )
}

export default function Page() { return <Shell roles={['lab', 'admin']}><Laboratory /></Shell> }
