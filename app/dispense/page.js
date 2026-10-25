'use client'
import { useCallback, useEffect, useState } from 'react'
import Shell from '@/components/Shell'
import { supabase, money, rxTotal, itemPrice } from '@/lib/supabase'

const when = (t) => new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })

function Dispense() {
  const [list, setList] = useState([])
  const [tab, setTab] = useState('pending')
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(null)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('prescriptions')
      .select('*, prescription_items(*, medicines(price))').order('created_at', { ascending: false }).limit(300)
    if (error) setErr(error.message); else setList(data || [])
  }, [])
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t) }, [load])

  const dispense = async (rx) => {
    if (!confirm(`Mark prescription for ${rx.patient_name} as dispensed? Total ${money(rxTotal(rx))}`)) return
    const { error } = await supabase.rpc('dispense_prescription', { p_id: rx.id })
    if (error) alert(error.message); else load()
  }

  const shown = list
    .filter((r) => r.status === tab && `${r.patient_name} ${r.patient_no || ''}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (tab === 'pending' ? new Date(a.created_at) - new Date(b.created_at) : new Date(b.dispensed_at) - new Date(a.dispensed_at)))
  const nPending = list.filter((r) => r.status === 'pending').length
  const rx = list.find((r) => r.id === sel)

  return (
    <div className="split">
      <div className="card queue">
        <div className="tabs">
          <button className={tab === 'pending' ? 'on' : ''} onClick={() => setTab('pending')}>Pending ({nPending})</button>
          <button className={tab === 'dispensed' ? 'on' : ''} onClick={() => setTab('dispensed')}>Dispensed</button>
        </div>
        <input placeholder="Search patient…" value={q} onChange={(e) => setQ(e.target.value)} />
        {err && <p className="error">{err}</p>}
        {shown.length === 0 && <p className="empty">{tab === 'pending' ? 'No patients waiting for medication.' : 'Nothing dispensed yet.'}</p>}
        {shown.map((r) => (
          <button key={r.id} className={'q-item ' + (sel === r.id ? 'sel' : '')} onClick={() => setSel(r.id)}>
            <div className="top1"><b>{r.patient_name}</b>
              <span className={'badge ' + (r.payment_method === 'Insurance' ? 'ins' : 'cash')}>{r.payment_method === 'Insurance' ? 'Insured' : 'Cash'}</span></div>
            <div className="muted">{r.patient_no} · {r.prescription_items.length} item{r.prescription_items.length === 1 ? '' : 's'} · {money(rxTotal(r))}</div>
            <div className="muted">{tab === 'dispensed' && r.dispensed_at ? `Dispensed ${when(r.dispensed_at)}` : `Sent ${when(r.created_at)}`}</div>
          </button>
        ))}
      </div>

      <div>
        {!rx ? (
          <div className="card pane-empty">Select a patient from the list to see the medication.</div>
        ) : (
          <div className={'card rx-card ' + (rx.status === 'dispensed' ? 'done' : '')}>
            <div className="bar" style={{ margin: 0 }}>
              <h3 style={{ border: 0, padding: 0, margin: 0 }}>{rx.patient_name} <span className="muted">{[rx.patient_no, rx.age, rx.sex].filter(Boolean).join(' · ')}</span></h3>
              <span className={'badge ' + rx.status}>{rx.status === 'dispensed' ? 'Dispensed' : 'Pending'}</span>
            </div>
            {rx.payment_method && (
              <p><b>Payment:</b> <span className={'badge ' + (rx.payment_method === 'Insurance' ? 'ins' : 'cash')}>{rx.payment_method === 'Insurance' ? 'Insured' : 'Cash'}</span>
                {rx.insurance_info && <span className="muted"> {rx.insurance_info}</span>}</p>
            )}
            <p className="muted">Prescribed by {rx.prescriber_name} · {when(rx.created_at)}</p>
            <div className="notes">
              {[['Chief complaints', rx.chief_complaints], ['History of presenting illness', rx.hpi], ['Past medical history', rx.pmh],
                ['History', rx.history], ['Provisional diagnosis', rx.provisional_diagnosis], ['Remarks', rx.remarks],
                ['Investigations requested', rx.investigations], ['Final diagnosis', rx.diagnosis]]
                .filter(([, v]) => v).map(([k, v]) => <p key={k}><b>{k}:</b> {v}</p>)}
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Medicine</th><th>Strength</th><th>Dose</th><th>Frequency</th><th>Duration</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr></thead>
                <tbody>
                  {rx.prescription_items.map((it) => (
                    <tr key={it.id}>
                      <td><b>{it.medicine_name}</b></td><td className="muted">{it.strength}</td><td>{it.dose}</td><td>{it.frequency}</td><td>{it.duration}</td>
                      <td><b>{it.quantity}</b></td><td style={{ whiteSpace: "nowrap" }}>{money(itemPrice(it))}</td><td style={{ whiteSpace: "nowrap" }}>{money(itemPrice(it) * it.quantity)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr className="total-row"><td colSpan={7} style={{ textAlign: 'right' }}>Total to pay</td><td style={{ whiteSpace: "nowrap" }}>{money(rxTotal(rx))}</td></tr></tfoot>
              </table>
            </div>
            {rx.status === 'pending'
              ? <button onClick={() => dispense(rx)}>Mark as dispensed</button>
              : <p className="ok">Dispensed by {rx.dispensed_by_name} on {when(rx.dispensed_at)}</p>}
          </div>
        )}
      </div>
    </div>
  )
}

export default function Page() { return <Shell roles={['dispenser', 'admin']} title="Pharmacy"><Dispense /></Shell> }
