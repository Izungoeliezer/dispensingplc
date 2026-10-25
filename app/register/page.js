'use client'
import { useCallback, useEffect, useState } from 'react'
import Shell from '@/components/Shell'
import { supabase } from '@/lib/supabase'

const blank = { full_name: '', ageNum: '', ageUnit: 'years', sex: '', address: '', phone: '', payment_method: 'Cash', insurance_provider: '', insurance_number: '' }

function Register() {
  const [f, setF] = useState(blank)
  const [editing, setEditing] = useState(null)
  const [list, setList] = useState([])
  const [queue, setQueue] = useState({})
  const [q, setQ] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const term = q.replace(/[,()%*\\]/g, ' ').trim()
    let query = supabase.from('patients').select('*').order('created_at', { ascending: false }).limit(50)
    if (term) query = query.or(`full_name.ilike.%${term}%,patient_no.ilike.%${term}%,phone.ilike.%${term}%`)
    const { data } = await query
    setList(data || [])
    const { data: vs } = await supabase.from('visits').select('patient_id, status').in('status', ['waiting', 'in_consultation'])
    setQueue(Object.fromEntries((vs || []).map((v) => [v.patient_id, v.status])))
  }, [q])
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t) }, [load])

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setMsg(null)
    const row = {
      full_name: f.full_name.trim(),
      age: `${f.ageNum} ${f.ageUnit}`,
      sex: f.sex, address: f.address.trim(), phone: f.phone.trim(), payment_method: f.payment_method,
      insurance_provider: f.payment_method === 'Insurance' ? f.insurance_provider.trim() : null,
      insurance_number: f.payment_method === 'Insurance' ? f.insurance_number.trim() : null,
    }
    const res = editing
      ? await supabase.from('patients').update(row).eq('id', editing.id).select().single()
      : await supabase.from('patients').insert(row).select().single()
    setBusy(false)
    if (res.error) return setMsg({ err: true, text: res.error.message })
    if (editing) setMsg({ text: `Updated ${res.data.full_name} (${res.data.patient_no}).` })
    else {
      const { error: qe } = await supabase.rpc('check_in', { p_patient_id: res.data.id })
      setMsg(qe ? { err: true, text: `Registered ${res.data.full_name} (${res.data.patient_no}) but could not add to the queue: ${qe.message}` }
        : { text: `Registered ${res.data.full_name}. Patient No. ${res.data.patient_no} – sent to the doctors' queue.` })
    }
    setF(blank); setEditing(null); load()
  }

  const sendToDoctor = async (p) => {
    const { error } = await supabase.rpc('check_in', { p_patient_id: p.id })
    setMsg(error ? { err: true, text: error.message } : { text: `${p.full_name} sent to the doctors' queue.` })
    load()
  }

  const edit = (p) => {
    const m = (p.age || '').match(/^([\d.]+)\s*(\w+)?/)
    setEditing(p); setMsg(null)
    setF({ full_name: p.full_name, ageNum: m?.[1] || '', ageUnit: m?.[2] || 'years', sex: p.sex, address: p.address || '', phone: p.phone || '',
      payment_method: p.payment_method, insurance_provider: p.insurance_provider || '', insurance_number: p.insurance_number || '' })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <>
      <form className="card" onSubmit={submit}>
        <h2>{editing ? `Edit patient ${editing.patient_no}` : 'Register patient'}</h2>
        <div className="grid2">
          <label>Full name<input required value={f.full_name} onChange={set('full_name')} /></label>
          <label>Age
            <div className="pair">
              <input type="number" min="0" step="any" required value={f.ageNum} onChange={set('ageNum')} />
              <select value={f.ageUnit} onChange={set('ageUnit')}><option>years</option><option>months</option><option>days</option></select>
            </div>
          </label>
          <label>Sex
            <select required value={f.sex} onChange={set('sex')}><option value="">Select…</option><option>Female</option><option>Male</option></select>
          </label>
          <label>Contact (phone)<input required value={f.phone} onChange={set('phone')} placeholder="e.g. 0712 345 678" /></label>
          <label className="wide">Address<input required value={f.address} onChange={set('address')} /></label>
        </div>
        <label>Payment method
          <div className="radios">
            {['Cash', 'Insurance'].map((m) => (
              <label key={m} className="inline">
                <input type="radio" name="pm" checked={f.payment_method === m} onChange={() => setF({ ...f, payment_method: m })} /> {m === 'Cash' ? 'Cash' : 'Insured'}
              </label>
            ))}
          </div>
        </label>
        {f.payment_method === 'Insurance' && (
          <div className="grid2">
            <label>Insurance provider<input required value={f.insurance_provider} onChange={set('insurance_provider')} placeholder="e.g. NHIF" /></label>
            <label>Membership / card number<input required value={f.insurance_number} onChange={set('insurance_number')} /></label>
          </div>
        )}
        <div className="bar">
          <span>{editing && <button type="button" className="ghost" onClick={() => { setEditing(null); setF(blank) }}>Cancel edit</button>}</span>
          <button disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Register patient'}</button>
        </div>
        {msg && <p className={msg.err ? 'error' : 'ok'}>{msg.text}</p>}
      </form>

      <div className="card">
        <div className="bar">
          <h3>Registered patients</h3>
          <input placeholder="Search name, number or phone…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="table-wrap"><table>
          <thead><tr><th>No.</th><th>Name</th><th>Age</th><th>Sex</th><th>Contact</th><th>Address</th><th>Payment</th><th>Queue</th><th /></tr></thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id}>
                <td>{p.patient_no}</td><td>{p.full_name}</td><td>{p.age}</td><td>{p.sex}</td><td>{p.phone}</td><td>{p.address}</td>
                <td><span className={'badge ' + (p.payment_method === 'Insurance' ? 'ins' : 'cash')}>{p.payment_method === 'Insurance' ? 'Insured' : 'Cash'}</span>
                  {p.payment_method === 'Insurance' && <div className="muted">{[p.insurance_provider, p.insurance_number].filter(Boolean).join(' · ')}</div>}</td>
                <td>{queue[p.id] ? <span className={'badge ' + (queue[p.id] === 'waiting' ? 'waiting' : 'consult')}>{queue[p.id] === 'waiting' ? 'Waiting' : 'With doctor'}</span> : <span className="muted">—</span>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button type="button" className="ghost" onClick={() => edit(p)}>Edit</button>{' '}
                  <button type="button" disabled={!!queue[p.id]} onClick={() => sendToDoctor(p)}>Send to doctor</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
        {list.length === 0 && <p className="muted">No patients found.</p>}
      </div>
    </>
  )
}

export default function Page() { return <Shell roles={['registrar', 'admin']} title="Patient registration"><Register /></Shell> }
