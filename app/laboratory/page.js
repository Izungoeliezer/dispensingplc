'use client'
import { useCallback, useEffect, useState } from 'react'
import Shell from '@/components/Shell'
import { supabase } from '@/lib/supabase'

const when = (t) => new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
const keyOf = (o) => o.visit_id || 'p:' + o.patient_id

function Test({ o, reload }) {
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
    <div className="card lab-card rx-card" style={done ? { borderLeftColor: '#10b981' } : undefined}>
      <div className="bar" style={{ margin: 0 }}>
        <b><span className={'tag ' + o.test_type.toLowerCase()}>{o.test_type}</span>{o.test_name}</b>
        <span className={'badge ' + (done ? 'c' : o.status === 'In progress' ? 'progress' : 'p')}>{o.status}</span>
      </div>
      <div className="muted">Requested by {o.requested_by_name} · {when(o.requested_at)}</div>
      {done ? (
        <>
          <div className="result">{o.result}</div>
          <div className="muted">Completed by {o.completed_by_name} · {when(o.completed_at)}{o.result_seen_at ? ' · seen by doctor' : ' · sent to doctor'}</div>
        </>
      ) : (
        <>
          <label style={{ margin: '4px 0 0' }}>Result
            <textarea rows={3} value={result} onChange={(e) => setResult(e.target.value)} placeholder="Enter the result, e.g. Hb 11.2 g/dL, or: Malaria parasites not seen" />
          </label>
          {err && <div className="error">{err}</div>}
          <div className="actions">
            {o.status === 'Pending' && <button type="button" className="ghost" disabled={busy} onClick={() => run('lab_start', { p_id: o.id })}>Start / sample collected</button>}
            <button type="button" disabled={busy || !result.trim()} onClick={() => run('lab_complete', { p_id: o.id, p_result: result })}>Save &amp; send result to doctor</button>
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
  const [sel, setSel] = useState(null)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('lab_orders').select('*').order('requested_at', { ascending: true }).limit(1000)
    if (error) setErr(error.message); else setList(data || [])
  }, [])
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t) }, [load])

  const groups = {}
  for (const o of list) (groups[keyOf(o)] ||= { key: keyOf(o), first: o, orders: [] }).orders.push(o)
  const all = Object.values(groups).map((g) => ({ ...g, open: g.orders.filter((o) => o.status !== 'Completed').length,
    last: g.orders.reduce((m, o) => (o.completed_at && o.completed_at > m ? o.completed_at : m), '') }))
  const shown = all
    .filter((g) => (tab === 'open' ? g.open > 0 : g.open === 0))
    .filter((g) => !type || g.orders.some((o) => o.test_type === type))
    .filter((g) => `${g.first.patient_name} ${g.first.patient_no}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (tab === 'open' ? a.first.requested_at.localeCompare(b.first.requested_at) : b.last.localeCompare(a.last)))
  const nOpen = all.filter((g) => g.open > 0).length
  const cur = sel ? groups[sel] : null

  return (
    <div className="split">
      <div className="card queue">
        <div className="tabs">
          <button className={tab === 'open' ? 'on' : ''} onClick={() => setTab('open')}>Pending ({nOpen})</button>
          <button className={tab === 'done' ? 'on' : ''} onClick={() => setTab('done')}>Completed</button>
        </div>
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option><option>Laboratory</option><option>Radiology</option>
        </select>
        <input placeholder="Search patient…" value={q} onChange={(e) => setQ(e.target.value)} />
        {err && <p className="error">{err}</p>}
        {shown.length === 0 && <p className="empty">{tab === 'open' ? 'No patients waiting for lab work.' : 'No completed patients yet.'}</p>}
        {shown.map((g) => (
          <button key={g.key} className={'q-item ' + (sel === g.key ? 'sel' : '')} onClick={() => setSel(g.key)}>
            <div className="top1"><b>{g.first.patient_name}</b>
              <span className={'badge ' + (g.open ? 'p' : 'c')}>{g.open ? `${g.open} pending` : 'Done'}</span></div>
            <div className="muted">{g.first.patient_no} · {g.first.age} · {g.first.sex}</div>
            <div className="muted">{g.orders.length} test{g.orders.length === 1 ? '' : 's'} · sent {when(g.first.requested_at)}</div>
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gap: 14 }}>
        {!cur ? (
          <div className="card pane-empty">Select a patient from the list to enter results.</div>
        ) : (
          <>
            <div className="card">
              <div className="patient-card">
                <div><b style={{ fontSize: 17 }}>{cur.first.patient_name}</b> <span className="muted">{[cur.first.patient_no, cur.first.age, cur.first.sex].filter(Boolean).join(' · ')}</span>
                  {cur.first.clinical_notes && <div className="muted"><b>Clinical notes:</b> {cur.first.clinical_notes}</div>}</div>
                <span className={'badge ' + (cur.open ? 'p' : 'c')}>{cur.open ? `${cur.open} of ${cur.orders.length} pending` : 'All results sent'}</span>
              </div>
            </div>
            {cur.orders.filter((o) => !type || o.test_type === type).map((o) => <Test key={o.id} o={o} reload={load} />)}
          </>
        )}
      </div>
    </div>
  )
}

export default function Page() { return <Shell roles={['lab', 'admin']} title="Laboratory"><Laboratory /></Shell> }
