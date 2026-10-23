'use client'
import { useEffect, useMemo, useState } from 'react'
import Shell from '@/components/Shell'
import { supabase, money, rxTotal } from '@/lib/supabase'
import { autoQuantity, defaultDoseUnit, FREQUENCIES, DOSE_UNITS, DURATION_UNITS, isLiquid } from '@/lib/calc'

const emptyItem = () => ({ key: Math.random(), medicine: null, q: '', doseNum: '', doseUnit: 'mg', frequency: '', durNum: '', durUnit: 'days', liquid: false })

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

function DiagnosisPicker({ value, onChange }) {
  const [q, setQ] = useState('')
  const [res, setRes] = useState([])
  const [searched, setSearched] = useState(false)
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)

  useEffect(() => {
    const term = q.replace(/[,()%*\\]/g, ' ').trim()
    setSearched(false)
    if (term.length < 2) { setRes([]); return }
    const t = setTimeout(async () => {
      let query = supabase.from('icd10_codes').select('code, description').limit(15)
      if (/^[a-z]\d/i.test(term)) query = query.ilike('code', term.replace(/\s+/g, '') + '%').order('code')
      else for (const w of term.split(/\s+/)) query = query.ilike('description', `%${w}%`)
      const { data } = await query
      setRes(data || []); setHi(0); setSearched(true)
    }, 250)
    return () => clearTimeout(t)
  }, [q])

  const add = (d) => { if (d && !value.some((v) => v.code === d.code)) onChange([...value, d]); setQ(''); setRes([]) }
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, res.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); add(res[hi]) }  // only a listed ICD-10 entry can be added
  }
  return (
    <div className="dx">
      <label>Diagnosis (ICD-10) – type a code or name, then choose from the list
        <div className="picker">
          <input placeholder="e.g. malaria, J06, pneumonia…" value={q} autoComplete="off"
            onChange={(e) => { setQ(e.target.value); setOpen(true) }} onKeyDown={onKey}
            onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
          {open && res.length > 0 && (
            <ul>
              {res.map((d, i) => (
                <li key={d.code} className={i === hi ? 'hi' : ''} onMouseDown={() => add(d)}><b>{d.code}</b> {d.description}</li>
              ))}
            </ul>
          )}
          {open && searched && res.length === 0 && (
            <ul><li className="muted">No matching ICD-10 diagnosis. Only diagnoses from the ICD-10 list can be used.</li></ul>
          )}
        </div>
      </label>
      <div className="chips">
        {value.map((d) => (
          <span className="chip" key={d.code}>
            <b>{d.code}</b> {d.description}
            <button type="button" onClick={() => onChange(value.filter((v) => v.code !== d.code))}>✕</button>
          </span>
        ))}
        {value.length === 0 && <span className="muted">No diagnosis added yet.</span>}
      </div>
    </div>
  )
}

function Prescribe() {
  const [medicines, setMedicines] = useState([])
  const [recent, setRecent] = useState([])
  const [f, setF] = useState({ patient_name: '', age: '', sex: '', history: '' })
  const [dx, setDx] = useState([])
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
  const calcOf = (it) => (it.medicine ? autoQuantity(it, it.medicine.strength) : null)
  const estimate = items.reduce((s, i) => s + Number(i.medicine?.price || 0) * (calcOf(i)?.qty || 0), 0)

  const submit = async (e) => {
    e.preventDefault(); setMsg(null)
    if (dx.length === 0) return setMsg({ err: true, text: 'Add at least one ICD-10 diagnosis.' })
    if (items.some((i) => !i.medicine)) return setMsg({ err: true, text: 'Pick each medicine from the search list.' })
    if (items.some((i) => !calcOf(i)?.qty)) return setMsg({ err: true, text: 'Complete dose, frequency and duration for every medicine (see the notes under each row).' })
    setBusy(true)
    const { error } = await supabase.rpc('create_prescription', {
      p_patient_name: f.patient_name, p_age: f.age, p_sex: f.sex, p_history: f.history, p_diagnoses: dx.map((d) => d.code),
      p_items: items.map((i) => {
        const c = calcOf(i), f = FREQUENCIES.find((x) => x.label === i.frequency)
        return {
          medicine_id: i.medicine.id,
          dose: `${i.doseNum} ${DOSE_UNITS.find((u) => u.value === i.doseUnit).label}`,
          frequency: i.frequency,
          duration: f?.single ? 'Single dose' : i.durNum ? `${i.durNum} ${i.durUnit}` : '',
          quantity: c.qty,
        }
      }),
    })
    setBusy(false)
    if (error) return setMsg({ err: true, text: error.message })
    setMsg({ text: 'Prescription sent to the dispensary.' })
    setF({ patient_name: '', age: '', sex: '', history: '' }); setItems([emptyItem()]); setDx([]); loadRecent()
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
        <DiagnosisPicker value={dx} onChange={setDx} />

        <h3>Medicines</h3>
        <div className="item head"><span>Medicine</span><span>Dose</span><span>Frequency</span><span>Duration</span><span>Quantity</span><span /></div>
        {items.map((it) => {
          const c = calcOf(it)
          const stat = FREQUENCIES.find((x) => x.label === it.frequency)?.single
          return (
            <div className="item" key={it.key}>
              <MedicinePicker medicines={medicines} item={it} onChange={(p) => setItem(it.key, p.medicine ? { ...p, doseUnit: defaultDoseUnit(p.medicine.strength), liquid: isLiquid(p.medicine.strength) } : p)} />
              <div className="pair">
                <input type="number" min="0" step="any" placeholder="Dose" required value={it.doseNum} onChange={(e) => setItem(it.key, { doseNum: e.target.value })} />
                <select value={it.doseUnit} onChange={(e) => setItem(it.key, { doseUnit: e.target.value })}>
                  {DOSE_UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
                </select>
              </div>
              <select required={!it.liquid} value={it.frequency} onChange={(e) => setItem(it.key, { frequency: e.target.value })}>
                <option value="">Frequency…</option>
                {FREQUENCIES.map((f) => <option key={f.label}>{f.label}</option>)}
              </select>
              <div className="pair">
                <input type="number" min="1" step="any" placeholder="No." required={!stat && !it.liquid} disabled={stat} value={stat ? '' : it.durNum} onChange={(e) => setItem(it.key, { durNum: e.target.value })} />
                <select disabled={stat} value={it.durUnit} onChange={(e) => setItem(it.key, { durUnit: e.target.value })}>
                  {DURATION_UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
                </select>
              </div>
              <input className="qty" readOnly tabIndex={-1} value={c?.qty ?? ''} placeholder="auto" title="Calculated automatically" />
              <button type="button" className="ghost" disabled={items.length === 1} onClick={() => setItems((xs) => xs.filter((x) => x.key !== it.key))}>✕</button>
              <label className="span-all inline">
                <input type="checkbox" checked={it.liquid} onChange={(e) => setItem(it.key, { liquid: e.target.checked })} />
                Syrup / suspension – quantity stays 1 bottle (only the dose is required)
              </label>
              {c?.error && <div className="span-all error">{c.error}</div>}
              {c?.note && <div className="span-all muted">Auto: {c.note}</div>}
            </div>
          )
        })}
        <p className="muted">The unit in the Dose box is pre-selected from the medicine strength; change it if needed. Quantity is calculated automatically.</p>
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
