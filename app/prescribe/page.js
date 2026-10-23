'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Shell from '@/components/Shell'
import ListPicker from '@/components/ListPicker'
import { supabase, money, rxTotal } from '@/lib/supabase'
import { autoQuantity, defaultDoseUnit, FREQUENCIES, DOSE_UNITS, DURATION_UNITS, isLiquid } from '@/lib/calc'

const emptyItem = () => ({ medicine: null, q: '', doseNum: '', doseUnit: 'mg', frequency: '', durNum: '', durUnit: 'days', liquid: false })
const EMPTY = { chief_complaints: '', hpi: '', pmh: '', remarks: '' }
const when = (t) => new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
const qtyText = (c) => `${c.qty} ${c.unitLabel}${c.qty === 1 || c.unitLabel === 'ml' || c.unitLabel.endsWith('s') ? '' : 's'}`

// search the ICD-10 table by code (e.g. B50) or by words in the name
async function searchIcd(term) {
  let query = supabase.from('icd10_codes').select('code, description').limit(15)
  if (/^[a-z]\d/i.test(term)) query = query.ilike('code', term.replace(/\s+/g, '') + '%').order('code')
  else for (const w of term.split(/\s+/)) query = query.ilike('description', `%${w}%`)
  const { data } = await query
  return data || []
}
const renderIcd = (d) => <><span className="code">{d.code}</span>{d.description}</>
const renderInv = (d) => <><span className={'tag ' + d.type.toLowerCase()}>{d.type}</span>{d.name}</>

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

function PatientPicker({ patient, onChange }) {
  const [q, setQ] = useState('')
  const [res, setRes] = useState([])
  const [recent, setRecent] = useState([])
  const [open, setOpen] = useState(false)
  const [searched, setSearched] = useState(false)

  useEffect(() => {
    supabase.from('patients').select('*').order('created_at', { ascending: false }).limit(8).then(({ data }) => setRecent(data || []))
  }, [])
  useEffect(() => {
    const term = q.replace(/[,()%*\\]/g, ' ').trim()
    setSearched(false)
    if (term.length < 2) { setRes([]); return }
    let stale = false
    const t = setTimeout(async () => {
      const { data } = await supabase.from('patients').select('*')
        .or(`full_name.ilike.%${term}%,patient_no.ilike.%${term}%,phone.ilike.%${term}%`).order('full_name').limit(10)
      if (!stale) { setRes(data || []); setSearched(true) }
    }, 250)
    return () => { stale = true; clearTimeout(t) }
  }, [q])

  const pick = (p) => { onChange(p); setQ(''); setRes([]) }
  if (patient)
    return (
      <div className="patient-card">
        <div>
          <b style={{ fontSize: 16 }}>{patient.full_name}</b> <span className="muted">{patient.patient_no} · {patient.age} · {patient.sex}</span><br />
          <span className="muted">{patient.phone} · {patient.address}</span>
        </div>
        <div>
          <span className={'badge ' + (patient.payment_method === 'Insurance' ? 'ins' : 'cash')}>
            {patient.payment_method === 'Insurance' ? 'Insured' : 'Cash'}
          </span>{' '}
          <button type="button" className="ghost" onClick={() => onChange(null)}>Change patient</button>
        </div>
      </div>
    )
  return (
    <div>
      <label>Search by name, patient number or phone
        <div className="picker">
          <input placeholder="Type at least 2 letters…" value={q} autoComplete="off"
            onChange={(e) => { setQ(e.target.value); setOpen(true) }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (res[0]) pick(res[0]) } }}
            onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
          {open && res.length > 0 && (
            <ul>{res.map((p) => (
              <li key={p.id} onMouseDown={() => pick(p)}><b>{p.full_name}</b> <span className="muted">{p.patient_no} · {p.age} · {p.sex} · {p.phone}</span></li>
            ))}</ul>
          )}
          {open && searched && res.length === 0 && <ul><li className="muted">No registered patient found. Ask reception to register the patient.</li></ul>}
        </div>
      </label>
      {recent.length > 0 && (
        <div className="quick"><span className="muted">Recently registered:</span>
          {recent.map((p) => <button type="button" className="ghost" key={p.id} onClick={() => pick(p)}>{p.full_name}</button>)}
        </div>
      )}
    </div>
  )
}

const Step = ({ n, title, children }) => (
  <div className="card-h"><span className="step">{n}</span><h3>{title}</h3>{children}</div>
)

function Prescribe() {
  const [medicines, setMedicines] = useState([])
  const [catalog, setCatalog] = useState([])
  const [recent, setRecent] = useState([])
  const [patient, setPatient] = useState(null)
  const [f, setF] = useState(EMPTY)
  const [prov, setProv] = useState([])
  const [labs, setLabs] = useState([])        // [{id,name,type,sent}]
  const [orders, setOrders] = useState([])    // lab orders already in the lab for this patient
  const [dx, setDx] = useState([])
  const [meds, setMeds] = useState([])        // prescribed medicines (with calculated quantity)
  const [draft, setDraft] = useState(emptyItem())
  const [medMsg, setMedMsg] = useState('')
  const [labMsg, setLabMsg] = useState(null)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  const loadRecent = async () => {
    const { data } = await supabase.from('prescriptions')
      .select('*, prescription_items(*, medicines(price))').order('created_at', { ascending: false }).limit(10)
    setRecent(data || [])
  }
  useEffect(() => {
    supabase.from('medicines').select('*').eq('active', true).order('name').limit(2000).then(({ data }) => setMedicines(data || []))
    supabase.from('investigations').select('id, name, type').order('name').range(0, 4999).then(({ data }) => setCatalog(data || []))
    loadRecent()
  }, [])

  const loadOrders = useCallback(async () => {
    if (!patient) return setOrders([])
    const { data } = await supabase.from('lab_orders').select('*').eq('patient_id', patient.id).order('requested_at', { ascending: false }).limit(30)
    setOrders(data || [])
  }, [patient])
  useEffect(() => { loadOrders(); const t = setInterval(loadOrders, 15000); return () => clearInterval(t) }, [loadOrders])

  const choosePatient = (p) => { setPatient(p); setLabs([]); setLabMsg(null) }
  const searchInv = async (term) => {
    const words = term.toLowerCase().split(/\s+/)
    return catalog.filter((i) => words.every((w) => `${i.name} ${i.type}`.toLowerCase().includes(w))).slice(0, 15)
  }

  // ---- laboratory ----
  const unsent = labs.filter((l) => !l.sent)
  const sendToLab = async () => {
    setLabMsg(null)
    if (!patient) return setLabMsg({ err: true, text: 'Select a patient first.' })
    if (unsent.length === 0) return setLabMsg({ err: true, text: 'Add at least one investigation to send.' })
    const notes = [f.chief_complaints && `Complaints: ${f.chief_complaints}`, prov.length && `Provisional: ${prov.map((p) => p.description).join(', ')}`].filter(Boolean).join(' | ')
    const { data, error } = await supabase.rpc('send_to_lab', { p_patient_id: patient.id, p_investigations: unsent.map((l) => l.id), p_notes: notes })
    if (error) return setLabMsg({ err: true, text: error.message })
    setLabs((xs) => xs.map((l) => ({ ...l, sent: true })))
    setLabMsg({ text: data > 0 ? `${data} request${data === 1 ? '' : 's'} sent to the laboratory.` : 'Already waiting in the laboratory – nothing new sent.' })
    loadOrders()
  }

  // ---- medicines ----
  const setD = (patch) => setDraft((d) => ({ ...d, ...patch }))
  const calcOf = (it) => (it.medicine ? autoQuantity(it, it.medicine.strength) : null)
  const dc = calcOf(draft)
  const addMed = () => {
    if (!draft.medicine) return setMedMsg('Pick a medicine from the search list.')
    const c = calcOf(draft)
    if (!c?.qty) return setMedMsg('Complete the dose, frequency and duration.')
    if (c.error) return setMedMsg(c.error)
    setMeds([...meds, { ...draft, c, key: Math.random() }]); setDraft(emptyItem()); setMedMsg('')
  }
  const estimate = meds.reduce((s, m) => s + Number(m.medicine.price || 0) * m.c.qty, 0)
  const stat = FREQUENCIES.find((x) => x.label === draft.frequency)?.single

  const submit = async (e) => {
    e.preventDefault(); setMsg(null)
    if (!patient) return setMsg({ err: true, text: 'Select a registered patient first.' })
    if (dx.length === 0) return setMsg({ err: true, text: 'Add at least one final diagnosis (ICD-10).' })
    if (meds.length === 0) return setMsg({ err: true, text: 'Add at least one medicine to the prescription.' })
    setBusy(true)
    const { error } = await supabase.rpc('create_prescription', {
      p_patient_id: patient.id, p_chief_complaints: f.chief_complaints, p_hpi: f.hpi, p_pmh: f.pmh,
      p_provisional: prov.map((d) => d.code), p_remarks: f.remarks, p_investigations: labs.map((l) => l.id),
      p_diagnoses: dx.map((d) => d.code),
      p_items: meds.map((i) => {
        const fr = FREQUENCIES.find((x) => x.label === i.frequency)
        return {
          medicine_id: i.medicine.id,
          dose: `${i.doseNum} ${DOSE_UNITS.find((u) => u.value === i.doseUnit).label}`,
          frequency: i.frequency,
          duration: fr?.single ? 'Single dose' : i.durNum ? `${i.durNum} ${i.durUnit}` : '',
          quantity: i.c.qty,
        }
      }),
    })
    setBusy(false)
    if (error) return setMsg({ err: true, text: error.message })
    setMsg({ text: 'Prescription sent to the pharmacy.' })
    setF(EMPTY); setMeds([]); setDx([]); setProv([]); setLabs([]); setPatient(null); setDraft(emptyItem()); loadRecent()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <form className="stack" onSubmit={submit} style={{ display: 'grid', gap: 18 }}>
      {msg && <div className="card"><span className={msg.err ? 'error' : 'ok'}>{msg.text}</span></div>}

      <div className="card">
        <Step n="1" title="Patient" />
        <PatientPicker patient={patient} onChange={choosePatient} />
      </div>

      <div className="card">
        <Step n="2" title="Clinical history" />
        <label>Chief complaints<textarea rows={2} required value={f.chief_complaints} onChange={(e) => setF({ ...f, chief_complaints: e.target.value })} /></label>
        <div className="grid2">
          <label>History of presenting illness<textarea rows={3} value={f.hpi} onChange={(e) => setF({ ...f, hpi: e.target.value })} /></label>
          <label>Past medical history<textarea rows={3} value={f.pmh} onChange={(e) => setF({ ...f, pmh: e.target.value })} /></label>
        </div>
        <ListPicker label="Provisional diagnosis (ICD-10)" placeholder="Type a code or name, e.g. malaria, J06, pneumonia…"
          search={searchIcd} itemKey={(d) => d.code} render={renderIcd} value={prov} onChange={setProv}
          noMatch="No matching ICD-10 diagnosis. Only diagnoses from the ICD-10 list can be used." empty="No provisional diagnosis added." />
        <label style={{ marginTop: 14 }}>Remarks<textarea rows={2} value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></label>
      </div>

      <div className="card">
        <Step n="3" title="Investigations" />
        <ListPicker label="Laboratory & radiology requests" placeholder="Type a test name, e.g. full blood count, malaria, chest x-ray…"
          search={searchInv} itemKey={(d) => d.id} render={renderInv} value={labs} onChange={setLabs}
          noMatch="No matching investigation. Only investigations from the list can be requested."
          empty="No investigations requested."
          extra={(d) => <span className={'badge ' + (d.sent ? 'sent' : 'unsent')}>{d.sent ? 'Sent to lab' : 'Not sent'}</span>}
          canRemove={(d) => !d.sent} />
        <div className="bar" style={{ marginTop: 12 }}>
          <span className={labMsg?.err ? 'error' : 'ok'}>{labMsg?.text}</span>
          <button type="button" disabled={unsent.length === 0 || !patient} onClick={sendToLab}>
            Send to lab{unsent.length > 0 ? ` (${unsent.length})` : ''}
          </button>
        </div>
        {patient && orders.length > 0 && (
          <>
            <h3 style={{ margin: '10px 0 6px', fontSize: 14 }}>Laboratory requests for {patient.full_name}</h3>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Test</th><th>Requested</th><th>Status</th><th>Result</th></tr></thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.id}>
                      <td><span className={'tag ' + o.test_type.toLowerCase()}>{o.test_type}</span>{o.test_name}</td>
                      <td className="muted">{when(o.requested_at)}</td>
                      <td><span className={'badge ' + (o.status === 'Completed' ? 'c' : o.status === 'In progress' ? 'progress' : 'p')}>{o.status}</span></td>
                      <td style={{ whiteSpace: 'pre-wrap' }}>{o.result || <span className="muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <div className="card">
        <Step n="4" title="Final diagnosis" />
        <ListPicker label="Final diagnosis (ICD-10)" placeholder="Type a code or name, e.g. malaria, J06, pneumonia…"
          search={searchIcd} itemKey={(d) => d.code} render={renderIcd} value={dx} onChange={setDx}
          noMatch="No matching ICD-10 diagnosis. Only diagnoses from the ICD-10 list can be used." empty="No final diagnosis added yet." />
      </div>

      <div className="card">
        <Step n="5" title="Medication" />
        <div className="draft" onKeyDown={(e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') { e.preventDefault(); addMed() } }}>
          <div className="draft-h"><span>Medicine</span><span>Dose</span><span>Frequency</span><span>Duration</span><span>Quantity</span></div>
          <div className="item" style={{ marginBottom: 4 }}>
            <MedicinePicker medicines={medicines} item={draft} onChange={(p) => setD(p.medicine ? { ...p, doseUnit: defaultDoseUnit(p.medicine.strength), liquid: isLiquid(p.medicine.strength) } : p)} />
            <div className="pair">
              <input type="number" min="0" step="any" placeholder="Dose" value={draft.doseNum} onChange={(e) => setD({ doseNum: e.target.value })} />
              <select value={draft.doseUnit} onChange={(e) => setD({ doseUnit: e.target.value })}>
                {DOSE_UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select>
            </div>
            <select value={draft.frequency} onChange={(e) => setD({ frequency: e.target.value })}>
              <option value="">Frequency…</option>
              {FREQUENCIES.map((x) => <option key={x.label}>{x.label}</option>)}
            </select>
            <div className="pair">
              <input type="number" min="1" step="any" placeholder="No." disabled={stat} value={stat ? '' : draft.durNum} onChange={(e) => setD({ durNum: e.target.value })} />
              <select disabled={stat} value={draft.durUnit} onChange={(e) => setD({ durUnit: e.target.value })}>
                {DURATION_UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select>
            </div>
            <input className="qty" readOnly tabIndex={-1} value={dc?.qty ? qtyText(dc) : ''} placeholder="auto" title="Calculated automatically" />
          </div>
          <label className="inline" style={{ margin: '8px 0 2px' }}>
            <input type="checkbox" checked={draft.liquid} onChange={(e) => setD({ liquid: e.target.checked })} />
            Syrup / suspension – quantity stays 1 bottle (only the dose is required)
          </label>
          {dc?.error && <div className="error">{dc.error}</div>}
          {dc?.note && <div className="muted">Auto: {dc.note}</div>}
          <div className="bar" style={{ marginBottom: 0 }}>
            <span className="error">{medMsg}</span>
            <button type="button" onClick={addMed}>+ Add to prescription</button>
          </div>
        </div>

        <h3 style={{ margin: '16px 0 4px', fontSize: 14 }}>Prescribed medicines ({meds.length})</h3>
        {meds.length === 0 ? <p className="empty">No medicines added yet.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>#</th><th>Medicine</th><th>Strength</th><th>Dose</th><th>Frequency</th><th>Duration</th><th>Qty</th><th>Amount</th><th /></tr></thead>
              <tbody>
                {meds.map((m, i) => {
                  const fr = FREQUENCIES.find((x) => x.label === m.frequency)
                  return (
                    <tr key={m.key}>
                      <td>{i + 1}</td><td><b>{m.medicine.name}</b></td><td className="muted">{m.medicine.strength}</td>
                      <td>{m.doseNum} {DOSE_UNITS.find((u) => u.value === m.doseUnit).label}</td>
                      <td>{m.frequency || '—'}</td>
                      <td>{fr?.single ? 'Single dose' : m.durNum ? `${m.durNum} ${m.durUnit}` : '—'}</td>
                      <td><b>{qtyText(m.c)}</b></td>
                      <td>{money(Number(m.medicine.price || 0) * m.c.qty)}</td>
                      <td><button type="button" className="x" onClick={() => setMeds(meds.filter((x) => x.key !== m.key))}>✕</button></td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot><tr className="total-row"><td colSpan={7} style={{ textAlign: 'right' }}>Estimated total</td><td colSpan={2}>{money(estimate)}</td></tr></tfoot>
            </table>
          </div>
        )}
      </div>

      <div className="actionbar">
        <span>
          {patient ? <b>{patient.full_name}</b> : <span className="muted">No patient selected</span>}
          {unsent.length > 0 && <span className="badge unsent" style={{ marginLeft: 10 }}>{unsent.length} investigation{unsent.length === 1 ? '' : 's'} not sent to lab</span>}
        </span>
        <span><span className="total">Estimated total: <b>{money(estimate)}</b></span>{' '}
          <button disabled={busy} style={{ marginLeft: 12 }}>{busy ? 'Saving…' : 'Send to pharmacy'}</button></span>
      </div>

      <div className="card">
        <h3>Recent prescriptions</h3>
        {recent.length === 0 && <p className="muted">None yet.</p>}
        {recent.map((r) => (
          <div className="row" key={r.id}>
            <span><b>{r.patient_name}</b> <span className="muted">{r.patient_no}</span> — {(r.diagnosis || '').replace(/\n/g, '; ')}</span>
            <span className="muted">{when(r.created_at)}</span>
            <span>{money(rxTotal(r))}</span>
            <span className={'badge ' + r.status}>{r.status === 'dispensed' ? 'Dispensed' : 'Pending'}</span>
          </div>
        ))}
      </div>
    </form>
  )
}

export default function Page() { return <Shell roles={['prescriber', 'admin']} title="Consultation"><Prescribe /></Shell> }
