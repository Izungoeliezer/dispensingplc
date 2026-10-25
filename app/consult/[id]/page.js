'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Shell from '@/components/Shell'
import ListPicker from '@/components/ListPicker'
import ResultsModal from '@/components/ResultsModal'
import { supabase, money } from '@/lib/supabase'
import { autoQuantity, defaultDoseUnit, FREQUENCIES, DOSE_UNITS, DURATION_UNITS, isLiquid } from '@/lib/calc'

const emptyItem = () => ({ medicine: null, q: '', doseNum: '', doseUnit: 'mg', frequency: '', durNum: '', durUnit: 'days', liquid: false })
const EMPTY = { chief_complaints: '', hpi: '', pmh: '', remarks: '' }
const when = (t) => new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
const qtyText = (c) => `${c.qty} ${c.unitLabel}${c.qty === 1 || c.unitLabel === 'ml' || c.unitLabel.endsWith('s') ? '' : 's'}`

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
      <input placeholder="Search medicine…" value={item.q}
        onChange={(e) => { onChange({ q: e.target.value, medicine: null }); setOpen(true) }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
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

const Step = ({ n, title, children }) => (
  <div className="card-h"><span className="step">{n}</span><h3>{title}</h3>{children}</div>
)

function Consult() {
  const { id } = useParams()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [me, setMe] = useState(null)
  const [visit, setVisit] = useState(null)
  const [rx, setRx] = useState(null)
  const [medicines, setMedicines] = useState([])
  const [catalog, setCatalog] = useState([])
  const [f, setF] = useState(EMPTY)
  const [prov, setProv] = useState([])
  const [labs, setLabs] = useState([])
  const [orders, setOrders] = useState([])
  const [dx, setDx] = useState([])
  const [meds, setMeds] = useState([])
  const [draft, setDraft] = useState(emptyItem())
  const [medMsg, setMedMsg] = useState('')
  const [labMsg, setLabMsg] = useState(null)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [savedAt, setSavedAt] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const ready = useRef(false)

  const loadOrders = useCallback(async () => {
    const { data } = await supabase.from('lab_orders').select('*').eq('visit_id', id).order('requested_at', { ascending: false })
    setOrders(data || [])
  }, [id])

  // ---------- load everything once ----------
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return router.replace('/login')
      const [{ data: prof }, { data: meds0 }, { data: cat }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', session.user.id).single(),
        supabase.from('medicines').select('*').eq('active', true).order('name').limit(2000),
        supabase.from('investigations').select('id, name, type').order('name').range(0, 4999),
      ])
      setMe(prof); setMedicines(meds0 || []); setCatalog(cat || [])
      await supabase.rpc('start_visit', { p_visit_id: id })
      const { data: v, error } = await supabase.from('visits').select('*, patients(*)').eq('id', id).single()
      if (error || !v) { setErr(error?.message || 'Visit not found'); setLoading(false); return }
      setVisit(v)
      setF({ chief_complaints: v.chief_complaints || '', hpi: v.hpi || '', pmh: v.pmh || '', remarks: v.remarks || '' })
      const codes = [...new Set([...(v.provisional_codes || []), ...(v.final_codes || [])])]
      let icd = []
      if (codes.length) icd = (await supabase.from('icd10_codes').select('code, description').in('code', codes)).data || []
      setProv((v.provisional_codes || []).map((c) => icd.find((d) => d.code === c)).filter(Boolean))
      setDx((v.final_codes || []).map((c) => icd.find((d) => d.code === c)).filter(Boolean))
      setLabs((v.investigation_ids || []).map((i) => (cat || []).find((c) => c.id === i)).filter(Boolean))
      setMeds((v.meds || []).map((s) => {
        const medicine = (meds0 || []).find((m) => m.id === Number(s.medicine_id))
        if (!medicine) return null
        const item = { medicine, q: '', doseNum: s.doseNum, doseUnit: s.doseUnit, frequency: s.frequency, durNum: s.durNum, durUnit: s.durUnit, liquid: !!s.liquid, key: Math.random() }
        const c = autoQuantity(item, medicine.strength)
        return { ...item, c: c?.qty ? c : { qty: Number(s.quantity) || 1, unitLabel: 'unit', note: '' } }
      }).filter(Boolean))
      const { data: r } = await supabase.from('prescriptions').select('id, status').eq('visit_id', id).order('created_at', { ascending: false }).limit(1)
      setRx(r?.[0] || null)
      await loadOrders()
      setLoading(false)
      setTimeout(() => { ready.current = true }, 300)
    })()
  }, [id, router, loadOrders])
  useEffect(() => { const t = setInterval(loadOrders, 15000); return () => clearInterval(t) }, [loadOrders])

  // ---------- payload / save ----------
  const calcOf = (it) => (it.medicine ? autoQuantity(it, it.medicine.strength) : null)
  const itemsPayload = useMemo(() => meds.map((i) => {
    const fr = FREQUENCIES.find((x) => x.label === i.frequency)
    return {
      medicine_id: i.medicine.id, doseNum: i.doseNum, doseUnit: i.doseUnit, frequency: i.frequency, durNum: i.durNum, durUnit: i.durUnit, liquid: i.liquid,
      dose: `${i.doseNum} ${DOSE_UNITS.find((u) => u.value === i.doseUnit).label}`,
      duration: fr?.single ? 'Single dose' : i.durNum ? `${i.durNum} ${i.durUnit}` : '',
      quantity: i.c.qty,
    }
  }), [meds])
  const snapshot = JSON.stringify([f, prov.map((d) => d.code), labs.map((l) => l.id), dx.map((d) => d.code), itemsPayload])

  const save = useCallback(async (complete) => {
    const { data, error } = await supabase.rpc('save_visit', {
      p_visit_id: id, p_chief_complaints: f.chief_complaints, p_hpi: f.hpi, p_pmh: f.pmh, p_remarks: f.remarks,
      p_provisional: prov.map((d) => d.code), p_diagnoses: dx.map((d) => d.code),
      p_investigations: labs.map((l) => l.id), p_items: itemsPayload, p_complete: complete,
    })
    if (!error) { setSavedAt(new Date()); setDirty(false) }
    return { data, error }
  }, [id, f, prov, dx, labs, itemsPayload])

  // autosave notes 2.5 s after the doctor stops typing (not for already-seen patients: they use the Save button)
  const saveRef = useRef(save); saveRef.current = save
  useEffect(() => {
    if (!ready.current || !visit) return
    setDirty(true)
    if (visit.status === 'seen') return
    const t = setTimeout(() => saveRef.current(false), 2500)
    return () => clearTimeout(t)
  }, [snapshot]) // eslint-disable-line react-hooks/exhaustive-deps

  const saveNotes = async () => {
    setMsg(null); setBusy(true)
    const { error } = await save(false)
    setBusy(false)
    setMsg(error ? { err: true, text: error.message } : { text: 'Notes saved.' })
  }
  const complete = async () => {
    setMsg(null)
    if (!f.chief_complaints.trim()) return setMsg({ err: true, text: 'Chief complaints are required.' })
    if (dx.length === 0) return setMsg({ err: true, text: 'Add at least one final diagnosis (ICD-10).' })
    if (meds.length === 0 && !confirm('No medicines were added. Complete the consultation without a prescription?')) return
    setBusy(true)
    const { data, error } = await save(true)
    setBusy(false)
    if (error) return setMsg({ err: true, text: error.message })
    alert(data)
    router.push('/patients')
  }

  // ---------- laboratory ----------
  const sentIds = new Set(orders.map((o) => o.investigation_id))
  const unsent = labs.filter((l) => !sentIds.has(l.id))
  const searchInv = async (term) => {
    const words = term.toLowerCase().split(/\s+/)
    return catalog.filter((i) => words.every((w) => `${i.name} ${i.type}`.toLowerCase().includes(w))).slice(0, 15)
  }
  const sendToLab = async () => {
    setLabMsg(null)
    if (unsent.length === 0) return setLabMsg({ err: true, text: 'Add at least one investigation to send.' })
    const notes = [f.chief_complaints && `Complaints: ${f.chief_complaints}`, prov.length && `Provisional: ${prov.map((p) => p.description).join(', ')}`].filter(Boolean).join(' | ')
    const { data, error } = await supabase.rpc('send_to_lab', { p_visit_id: id, p_investigations: unsent.map((l) => l.id), p_notes: notes })
    if (error) return setLabMsg({ err: true, text: error.message })
    setLabMsg({ text: `${data} request${data === 1 ? '' : 's'} sent to the laboratory.` })
    await save(false)
    loadOrders()
  }
  const orderOf = (invId) => orders.find((o) => o.investigation_id === invId)
  const done = orders.filter((o) => o.status === 'Completed')

  // ---------- medicines ----------
  const setD = (patch) => setDraft((d) => ({ ...d, ...patch }))
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
  const locked = rx?.status === 'dispensed'

  if (loading) return <div className="center muted">Loading patient…</div>
  if (err) return <div className="card error">{err}</div>
  const p = visit.patients
  const otherDoctor = visit.doctor_id && visit.doctor_id !== me?.id && me?.role !== 'admin'

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div className="card">
        <div className="patient-card">
          <div>
            <b style={{ fontSize: 17 }}>{p.full_name}</b> <span className="muted">{p.patient_no} · {p.age} · {p.sex}</span><br />
            <span className="muted">{p.phone} · {p.address}</span>
          </div>
          <div className="savebar">
            <span className={'badge ' + (p.payment_method === 'Insurance' ? 'ins' : 'cash')}>{p.payment_method === 'Insurance' ? 'Insured' : 'Cash'}</span>
            <span className={'badge ' + (visit.status === 'seen' ? 'seen' : 'consult')}>{visit.status === 'seen' ? 'Seen' : 'In consultation'}</span>
            <button className="ghost" type="button" onClick={() => router.push('/patients')}>← Patients</button>
          </div>
        </div>
        {otherDoctor && <p className="error" style={{ marginBottom: 0 }}>This patient is being attended by {visit.doctor_name}. You can view but not change the notes.</p>}
        {visit.status === 'seen' && !otherDoctor && <p className="muted" style={{ marginBottom: 0 }}>Consultation completed {when(visit.completed_at)}. You can edit the notes and press <b>Save notes</b>, or change the medicines and press <b>Update &amp; send to pharmacy</b>.</p>}
      </div>

      {msg && <div className="card"><span className={msg.err ? 'error' : 'ok'}>{msg.text}</span></div>}

      <fieldset disabled={otherDoctor} style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 18, minWidth: 0 }}>
        <div className="card">
          <Step n="1" title="Clinical history" />
          <label>Chief complaints<textarea rows={2} value={f.chief_complaints} onChange={(e) => setF({ ...f, chief_complaints: e.target.value })} /></label>
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
          <Step n="2" title="Investigations">
            <span className="grow" />
            {done.length > 0 && <button type="button" className="ghost" onClick={() => setShowResults(true)}>View lab results ({done.length})</button>}
          </Step>
          <ListPicker label="Laboratory & radiology requests" placeholder="Type a test name, e.g. full blood count, malaria, chest x-ray…"
            search={searchInv} itemKey={(d) => d.id} render={renderInv} value={labs} onChange={setLabs}
            noMatch="No matching investigation. Only investigations from the list can be requested." empty="No investigations requested."
            extra={(d) => {
              const o = orderOf(d.id)
              return <span className={'badge ' + (!o ? 'unsent' : o.status === 'Completed' ? 'c' : o.status === 'In progress' ? 'progress' : 'sent')}>{!o ? 'Not sent' : o.status === 'Pending' ? 'Sent to lab' : o.status === 'Completed' ? 'Result ready' : 'In progress'}</span>
            }}
            canRemove={(d) => !sentIds.has(d.id)} />
          <div className="bar" style={{ marginTop: 12 }}>
            <span className={labMsg?.err ? 'error' : 'ok'}>{labMsg?.text}</span>
            <button type="button" disabled={unsent.length === 0} onClick={sendToLab}>Send to lab{unsent.length > 0 ? ` (${unsent.length})` : ''}</button>
          </div>
          {orders.length > 0 && (
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
          )}
        </div>

        <div className="card">
          <Step n="3" title="Final diagnosis" />
          <ListPicker label="Final diagnosis (ICD-10)" placeholder="Type a code or name, e.g. malaria, J06, pneumonia…"
            search={searchIcd} itemKey={(d) => d.code} render={renderIcd} value={dx} onChange={setDx}
            noMatch="No matching ICD-10 diagnosis. Only diagnoses from the ICD-10 list can be used." empty="No final diagnosis added yet." />
        </div>

        <div className="card">
          <Step n="4" title="Medication" />
          {locked && <p className="error">These medicines have already been dispensed and can no longer be changed.</p>}
          <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            <div className="draft" onKeyDown={(e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') { e.preventDefault(); addMed() } }}>
              <div className="draft-h"><span>Medicine</span><span>Dose</span><span>Frequency</span><span>Duration</span><span>Quantity</span></div>
              <div className="item" style={{ marginBottom: 4 }}>
                <MedicinePicker medicines={medicines} item={draft} onChange={(pp) => setD(pp.medicine ? { ...pp, doseUnit: defaultDoseUnit(pp.medicine.strength), liquid: isLiquid(pp.medicine.strength) } : pp)} />
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
          </fieldset>

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
                        <td><button type="button" className="x" disabled={locked} onClick={() => setMeds(meds.filter((x) => x.key !== m.key))}>✕</button></td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot><tr className="total-row"><td colSpan={7} style={{ textAlign: 'right' }}>Estimated total</td><td colSpan={2}>{money(estimate)}</td></tr></tfoot>
              </table>
            </div>
          )}
        </div>
      </fieldset>

      <div className="actionbar">
        <span className="saved">{savedAt ? `Saved ${savedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Not saved yet'}{dirty && savedAt ? ' · changes pending' : ''}
          {unsent.length > 0 && <span className="badge unsent" style={{ marginLeft: 10 }}>{unsent.length} investigation{unsent.length === 1 ? '' : 's'} not sent to lab</span>}</span>
        <span className="savebar">
          <span className="total">Total: <b>{money(estimate)}</b></span>
          <button type="button" className="ghost" disabled={busy || otherDoctor} onClick={saveNotes}>Save notes</button>
          <button type="button" disabled={busy || otherDoctor} onClick={complete}>{visit.status === 'seen' ? 'Update & send to pharmacy' : 'Complete & send to pharmacy'}</button>
        </span>
      </div>

      {showResults && <ResultsModal orders={done} title={`Lab results – ${p.full_name}`} onClose={() => setShowResults(false)} />}
    </div>
  )
}

export default function Page() { return <Shell roles={['prescriber', 'admin']} title="Consultation"><Consult /></Shell> }
