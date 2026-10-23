'use client'
import { useCallback, useEffect, useState } from 'react'
import Shell from '@/components/Shell'
import { supabase, money, rxTotal, itemPrice } from '@/lib/supabase'

function Dispense() {
  const [list, setList] = useState([])
  const [tab, setTab] = useState('pending')
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('prescriptions')
      .select('*, prescription_items(*, medicines(price))').order('created_at', { ascending: false }).limit(200)
    if (error) setErr(error.message); else setList(data || [])
  }, [])
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t) }, [load])

  const dispense = async (rx) => {
    if (!confirm(`Mark prescription for ${rx.patient_name} as dispensed? Total ${money(rxTotal(rx))}`)) return
    const { error } = await supabase.rpc('dispense_prescription', { p_id: rx.id })
    if (error) alert(error.message); else load()
  }

  const shown = list.filter((r) => r.status === tab && `${r.patient_name} ${r.patient_no || ''}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <>
      <div className="bar">
        <div className="tabs">
          <button className={tab === 'pending' ? 'on' : ''} onClick={() => setTab('pending')}>Pending ({list.filter((r) => r.status === 'pending').length})</button>
          <button className={tab === 'dispensed' ? 'on' : ''} onClick={() => setTab('dispensed')}>Dispensed</button>
        </div>
        <input placeholder="Search patient…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {err && <p className="error">{err}</p>}
      {shown.length === 0 && <div className="card muted">Nothing here.</div>}
      {shown.map((rx) => (
        <div className={'card rx-card ' + (rx.status === 'dispensed' ? 'done' : '')} key={rx.id}>
          <div className="bar">
            <h3 style={{ border: 0, padding: 0, margin: 0 }}>{rx.patient_name} <span className="muted">{[rx.patient_no, rx.age, rx.sex].filter(Boolean).join(' · ')}</span></h3>
            <span className={'badge ' + rx.status}>{rx.status === 'dispensed' ? 'Dispensed' : 'Pending'}</span>
          </div>
          {rx.payment_method && (
            <p><b>Payment:</b> <span className={'badge ' + (rx.payment_method === 'Insurance' ? 'ins' : 'cash')}>{rx.payment_method === 'Insurance' ? 'Insured' : 'Cash'}</span>
              {rx.insurance_info && <span className="muted"> {rx.insurance_info}</span>}</p>
          )}
          <p className="muted">Prescribed by {rx.prescriber_name} · {new Date(rx.created_at).toLocaleString()}</p>
          <div className="notes">
            {[['Chief complaints', rx.chief_complaints], ['History of presenting illness', rx.hpi], ['Past medical history', rx.pmh],
              ['History', rx.history], ['Provisional diagnosis', rx.provisional_diagnosis], ['Remarks', rx.remarks],
              ['Investigations requested', rx.investigations], ['Final diagnosis', rx.diagnosis]]
              .filter(([, v]) => v)
              .map(([k, v]) => <p key={k}><b>{k}:</b> {v}</p>)}
          </div>
          <div className="table-wrap"><table>
            <thead><tr><th>Medicine</th><th>Strength</th><th>Dose</th><th>Frequency</th><th>Duration</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr></thead>
            <tbody>
              {rx.prescription_items.map((it) => (
                <tr key={it.id}>
                  <td>{it.medicine_name}</td><td>{it.strength}</td><td>{it.dose}</td><td>{it.frequency}</td><td>{it.duration}</td>
                  <td>{it.quantity}</td><td>{money(itemPrice(it))}</td><td>{money(itemPrice(it) * it.quantity)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={7}>Total to pay</td><td><b>{money(rxTotal(rx))}</b></td></tr></tfoot>
          </table></div>
          {rx.status === 'pending'
            ? <button onClick={() => dispense(rx)}>Mark as dispensed</button>
            : <p className="ok">Dispensed by {rx.dispensed_by_name} on {new Date(rx.dispensed_at).toLocaleString()}</p>}
        </div>
      ))}
    </>
  )
}

export default function Page() { return <Shell roles={['dispenser', 'admin']} title="Pharmacy"><Dispense /></Shell> }
