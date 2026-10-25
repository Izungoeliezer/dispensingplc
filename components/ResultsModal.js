'use client'
const when = (t) => new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })

// Pop-up that shows laboratory results, grouped by patient.
export default function ResultsModal({ orders, title = 'Laboratory results', onClose, actions }) {
  const groups = {}
  for (const o of orders) (groups[o.visit_id || o.patient_id] ||= { o, list: [] }).list.push(o)
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-h"><h3>{title}</h3><button className="x" onClick={onClose}>✕</button></div>
        <div className="modal-b">
          {Object.values(groups).map(({ o, list }) => (
            <div key={o.visit_id || o.patient_id} className="res-group">
              <div className="res-patient"><b>{o.patient_name}</b> <span className="muted">{[o.patient_no, o.age, o.sex].filter(Boolean).join(' · ')}</span>
                {actions && <span style={{ marginLeft: 'auto' }}>{actions(o)}</span>}</div>
              {list.map((t) => (
                <div className="res-test" key={t.id}>
                  <div><span className={'tag ' + t.test_type.toLowerCase()}>{t.test_type}</span><b>{t.test_name}</b></div>
                  <div className="result">{t.result || 'No result yet'}</div>
                  <div className="muted">{t.completed_at ? `Reported by ${t.completed_by_name} · ${when(t.completed_at)}` : t.status}</div>
                </div>
              ))}
            </div>
          ))}
          {orders.length === 0 && <p className="empty">No results to show.</p>}
        </div>
        <div className="modal-f"><button onClick={onClose}>Close</button></div>
      </div>
    </div>
  )
}
