'use client'
import { useEffect, useMemo, useState } from 'react'
import Shell from '@/components/Shell'
import ListPicker from '@/components/ListPicker'
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

// search the ICD-10 table by code (e.g. B50) or by words in the name
async function searchIcd(term) {
  let query = supabase.from('icd10_codes').select('code, description').limit(15)
  if (/^[a-z]\d/i.test(term)) query = query.ilike('code', term.replace(/\s+/g, '') + '%').order('code')
  else for (const w of term.split(/\s+/)) query = query.ilike('description', `%${w}%`)
  const { data } = await query
  return data || []
}
const renderIcd = (d) => <><b>{d.code}</b> {d.description}</>
const renderInv = (d) => <><span className={'tag ' + d.type.toLowerCase()}>{d.type}</span> {d.name}</>

const EMPTY = { patient_name: '', age: '', sex: '', chief_complaints: '', hpi: '', pmh: '', remarks: '' }

function Prescribe() {
  const [medicines, setMedicines] = useState([])
  const [recent, setRecent] = useState([])
  const [f, setF] = useState(EMPTY)
  const [prov, setProv] = useState([])
  const [labs, setLabs] = useState([])
  const [investigations, setInvestigations] = useState([])
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
    supabase.from('investigations').select('id, name, type').order('name').range(0, 4999).then(({ data }) => setInvestigations(data || []))
    loadRecent()
  }, [])

  const setItem = (key, patch) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)))
  const searchInv = async (term) => {
    const words = term.toLowerCase().split(/\s+/)
    return investigations.filter((i) => words.every((w) => `${i.name} ${i.type}`.toLowerCase().includes(w))).slice(0, 15)
  }
  const calcOf = (it) => (it.medicine ? autoQuantity(it, it.medicine.strength) : null)
  const estimate = items.reduce((s, i) => s + Number(i.medicine?.price || 0) * (calcOf(i)?.qty || 0), 0)

  const submit = async (e) => {
    e.preventDefault(); setMsg(null)
    if (dx.length === 0) return setMsg({ err: true, text: 'Add at least one final diagnosis (ICD-10).' })
    if (items.some((i) => !i.medicine)) return setMsg({ err: true, text: 'Pick each medicine from the search list.' })
    if (items.some((i) => !calcOf(i)?.qty)) return setMsg({ err: true, text: 'Complete dose, frequency and duration for every medicine (see the notes under each row).' })
    setBusy(true)
    const { error } = await supabase.rpc('create_prescription', {
      p_patient_name: f.patient_name, p_age: f.age, p_sex: f.sex, p_chief_complaints: f.chief_complaints, p_hpi: f.hpi, p_pmh: f.pmh,
      p_provisional: prov.map((d) => d.code), p_remarks: f.remarks, p_investigations: labs.map((l) => l.id), p_diagnoses: dx.map((d) => d.code),
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
    setF({ patient_name: '', age: '', sex: '', history: '' }); setItems([emptyItem()]); setDx([]); setProv([]); setLabs([]); loadRecent()
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
        <h3>History</h3>
        <label>Chief complaints<textarea rows={2} required value={f.chief_complaints} onChange={(e) => setF({ ...f, chief_complaints: e.target.value })} /></label>
        <label>History of presenting illness<textarea rows={3} value={f.hpi} onChange={(e) => setF({ ...f, hpi: e.target.value })} /></label>
        <label>Past medical history<textarea rows={2} value={f.pmh} onChange={(e) => setF({ ...f, pmh: e.target.value })} /></label>
        <ListPicker label="Provisional diagnosis (ICD-10) – type a code or name, then choose from the list" placeholder="e.g. malaria, J06, pneumonia…"
          search={searchIcd} itemKey={(d) => d.code} render={renderIcd} value={prov} onChange={setProv}
          noMatch="No matching ICD-10 diagnosis. Only diagnoses from the ICD-10 list can be used." empty="No provisional diagnosis added." />
        <label>Remarks<textarea rows={2} value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></label>

        <h3>Investigations</h3>
        <ListPicker label="Laboratory & radiology investigations – type a name, then choose from the list" placeholder="e.g. full blood count, malaria, chest x-ray…"
          search={searchInv} itemKey={(d) => d.id} render={renderInv} value={labs} onChange={setLabs}
          noMatch="No matching investigation. Only investigations from the list can be requested." empty="No investigations requested." />

        <h3>Final diagnosis</h3>
        <ListPicker label="Final diagnosis (ICD-10) – type a code or name, then choose from the list" placeholder="e.g. malaria, J06, pneumonia…"
          search={searchIcd} itemKey={(d) => d.code} render={renderIcd} value={dx} onChange={setDx}
          noMatch="No matching ICD-10 diagnosis. Only diagnoses from the ICD-10 list can be used." empty="No final diagnosis added yet." />

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
            <span><b>{r.patient_name}</b> — {(r.diagnosis || '').replace(/\n/g, '; ')}</span>
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
