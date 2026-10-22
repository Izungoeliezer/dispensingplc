'use client'
import { useEffect, useMemo, useState } from 'react'
import Shell from '@/components/Shell'
import { supabase, money, rxTotal } from '@/lib/supabase'

const FREQS = ['Once daily (OD)', 'Twice daily (BD)', 'Three times daily (TDS)', 'Four times daily (QID)', 'At night (Nocte)', 'Every 8 hours', 'Every 12 hours', 'As needed (PRN)', 'Single dose (STAT)']
const emptyItem = () => ({ key: Math.random(), medicine: null, q: '', dose: '', frequency: '', duration: '', quantity: 1 })

function MedicinePicker({ medicines, item, onChange }) {
  const [open, setOpen] = useState(false)
  const matches = useMemo(() => {
    const q = item.q.trim().toLowerCase()
    if (!q) return []
    return medicines.filter((m) => `${m.name} ${m.strength}`.toLowerCase().includes(q)).slice(0, 8)
  }, [item.q, medicines])
  return (
    <div className="picker">
      <input
        placeholder="Search medicine…"
        value={item.q}
        onChange={(e) => { onChange({ q: e.target.value, medicine: null }); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && matches.length > 0 && (
        <ul>
          {matches.map((m) => (
            <li key={m.id} onMouseDown={() => { onChange({ medicine: m, q: `${m.name} — ${m.strength}` }); setOpen(false) }}>
              {m.name} <span className="muted">{m.strength}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Prescribe() {
  const [medicines, setMedicines] = useState([])
  const [recent, setRecent] = useState([])
  const [f, setF] = useState({ patient_name: '', age: '', sex: '', history: '', diagnosis: '' })
  const [items, setItems] = useState([emptyItem()])
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  const loadRecent = async () => {
    const { data } = await supabase.from('prescriptions')
      .select('*, prescription_items(*, medicines(price))').order('created_at', { ascending: false }).limit(10)
    setRecent(data || [])
  }
  useEffect(() => {
    supabase.from('medicines').select('*').eq('active', true).order('name').limit(2000).then(({ data }) => setMedicines(data || []))
    loadRecent()
  }, [])

  const setItem = (key, patch) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)))
  const estimate = items.reduce((s, i) => s + Number(i.medicine?.price || 0) * Number(i.quantity || 0), 0)

  const submit = async (e) => {
    e.preventDefault(); setMsg(null)
    if (items.some((i) => !i.medicine)) return setMsg({ err: true, text: 'Pick each medicine from the search list.' })
    setBusy(true)
    const { error } = await supabase.rpc('create_prescription', {
      p_patient_name: f.patient_name, p_age: f.age, p_sex: f.sex, p_history: f.history, p_diagnosis: f.diagnosis,
      p_items: items.map((i) => ({ medicine_id: i.medicine.id, dose: i.dose, frequency: i.frequency, duration: i.duration, quantity: i.quantity })),
    })
    setBusy(false)
    if (error) return setMsg({ err: true, text: error.message })
    setMsg({ text: 'Prescription sent to the dispensary.' })
    setF({ patient_name: '', age: '', sex: '', history: '', diagnosis: '' }); setItems([emptyItem()]); loadRecent()
  }

  return (
    <>
      <form className="card" onSubmit={submit}>
        <h2>New prescription</h2>
        <div className="grid">
          <label className="span2">Patient name<input required value={f.patient_name} onChange={(e) => setF({ ...f, patient_name: e.target.value })} /></label>
          <label>Age<input value={f.age} onChange={(e) => setF({ ...f, age: e.target.value })} placeholder="e.g. 34 yrs" /></label>
          <label>Sex<select value={f.sex} onChange={(e) => setF({ ...f, sex: e.target.value })}><option value="">—</option><option>Female</option><option>Male</option></select></label>
        </div>
        <label>History<textarea rows={3} value={f.history} onChange={(e) => setF({ ...f, history: e.target.value })} /></label>
        <label>Diagnosis<textarea rows={2} required value={f.diagnosis} onChange={(e) => setF({ ...f, diagnosis: e.target.value })} /></label>

        <h3>Medicines</h3>
        {items.map((it) => (
          <div className="item" key={it.key}>
            <MedicinePicker medicines={medicines} item={it} onChange={(p) => setItem(it.key, p)} />
            <input placeholder="Dose (e.g. 500mg)" required value={it.dose} onChange={(e) => setItem(it.key, { dose: e.target.value })} />
            <input list="freqs" placeholder="Frequency" required value={it.frequency} onChange={(e) => setItem(it.key, { frequency: e.target.value })} />
            <input placeholder="Duration (e.g. 5 days)" required value={it.duration} onChange={(e) => setItem(it.key, { duration: e.target.value })} />
            <input type="number" min="1" step="any" title="Total quantity to dispense" required value={it.quantity} onChange={(e) => setItem(it.key, { quantity: e.target.value })} />
            <button type="button" className="ghost" disabled={items.length === 1} onClick={() => setItems((xs) => xs.filter((x) => x.key !== it.key))}>✕</button>
          </div>
        ))}
        <datalist id="freqs">{FREQS.map((x) => <option key={x} value={x} />)}</datalist>
        <p className="muted">Fields: medicine · dose · frequency · duration · total quantity to dispense</p>
        <button type="button" className="ghost" onClick={() => setItems([...items, emptyItem()])}>+ Add medicine</button>

        <div className="bar">
          <span>Estimated total: <b>{money(estimate)}</b></span>
          <button disabled={busy}>{busy ? 'Saving…' : 'Send to dispensary'}</button>
        </div>
        {msg && <p className={msg.err ? 'error' : 'ok'}>{msg.text}</p>}
      </form>

      <div className="card">
        <h3>Recent prescriptions</h3>
        {recent.length === 0 && <p className="muted">None yet.</p>}
        {recent.map((r) => (
          <div className="row" key={r.id}>
            <span><b>{r.patient_name}</b> — {r.diagnosis}</span>
            <span className="muted">{new Date(r.created_at).toLocaleString()}</span>
            <span>{money(rxTotal(r))}</span>
            <span className={'badge ' + r.status}>{r.status === 'dispensed' ? 'Dispensed' : 'Pending'}</span>
          </div>
        ))}
      </div>
    </>
  )
}

export default function Page() { return <Shell roles={['prescriber', 'admin']}><Prescribe /></Shell> }
