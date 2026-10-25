'use client'
import { useEffect, useState } from 'react'
import Shell from '@/components/Shell'
import { supabase } from '@/lib/supabase'

function Prices() {
  const [meds, setMeds] = useState([])
  const [q, setQ] = useState('')
  const [onlyZero, setOnlyZero] = useState(false)
  const [edits, setEdits] = useState({})
  const [nw, setNw] = useState({ name: '', strength: '', price: '' })
  const [msg, setMsg] = useState('')

  const load = async () => {
    // fetch in pages of 1000 (Supabase default cap)
    const { data } = await supabase.from('medicines').select('*').order('name').range(0, 4999)
    setMeds(data || [])
  }
  useEffect(() => { load() }, [])

  const val = (m, k) => edits[m.id]?.[k] ?? m[k]
  const edit = (m, k, v) => setEdits((e) => ({ ...e, [m.id]: { ...e[m.id], [k]: v } }))
  const dirty = Object.keys(edits).length

  const saveAll = async () => {
    setMsg('Saving…')
    for (const [id, p] of Object.entries(edits)) {
      const patch = { ...p }
      if ('price' in patch) patch.price = Number(patch.price || 0)
      const { error } = await supabase.from('medicines').update(patch).eq('id', id)
      if (error) return setMsg(error.message)
    }
    setEdits({}); setMsg('Saved.'); load()
  }
  const add = async (e) => {
    e.preventDefault()
    const { error } = await supabase.from('medicines').insert({ name: nw.name, strength: nw.strength, price: Number(nw.price || 0) })
    if (error) return setMsg(error.message)
    setNw({ name: '', strength: '', price: '' }); load()
  }

  const shown = meds.filter((m) => `${m.name} ${m.strength}`.toLowerCase().includes(q.toLowerCase()) && (!onlyZero || Number(m.price) === 0))
  return (
    <div className="card">
      <h2>Medicines & prices</h2>
      <form className="item add" onSubmit={add}>
        <input placeholder="New medicine name" required value={nw.name} onChange={(e) => setNw({ ...nw, name: e.target.value })} />
        <input placeholder="Strength / form" value={nw.strength} onChange={(e) => setNw({ ...nw, strength: e.target.value })} />
        <input type="number" min="0" step="any" placeholder="Price" value={nw.price} onChange={(e) => setNw({ ...nw, price: e.target.value })} />
        <button>Add</button>
      </form>
      <div className="bar">
        <input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="inline"><input type="checkbox" checked={onlyZero} onChange={(e) => setOnlyZero(e.target.checked)} /> Only unpriced</label>
        <button disabled={!dirty} onClick={saveAll}>Save {dirty || ''} change{dirty === 1 ? '' : 's'}</button>
      </div>
      {msg && <p className="muted">{msg}</p>}
      <p className="muted">The list came from OCR of the scanned NEML PDF – fix any wrong names/strengths here. Untick “active” to hide a medicine from prescribers.</p>
      <table>
        <thead><tr><th>Medicine</th><th>Strength / form</th><th>Price (TZS)</th><th>Active</th></tr></thead>
        <tbody>
          {shown.slice(0, 200).map((m) => (
            <tr key={m.id}>
              <td><input value={val(m, 'name')} onChange={(e) => edit(m, 'name', e.target.value)} /></td>
              <td><input value={val(m, 'strength')} onChange={(e) => edit(m, 'strength', e.target.value)} /></td>
              <td><input type="number" min="0" step="any" value={val(m, 'price')} onChange={(e) => edit(m, 'price', e.target.value)} /></td>
              <td><input type="checkbox" checked={val(m, 'active')} onChange={(e) => edit(m, 'active', e.target.checked)} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {shown.length > 200 && <p className="muted">Showing first 200 of {shown.length}; use search to narrow down.</p>}
    </div>
  )
}

function Users() {
  const [users, setUsers] = useState([])
  const load = async () => { const { data } = await supabase.from('profiles').select('*').order('email'); setUsers(data || []) }
  useEffect(() => { load() }, [])
  const update = async (u, patch) => { await supabase.from('profiles').update(patch).eq('id', u.id); load() }
  return (
    <div className="card">
      <h2>Staff accounts</h2>
      <p className="muted">Create users in Supabase → Authentication → Users, then assign their role here.</p>
      <table>
        <thead><tr><th>Email</th><th>Name</th><th>Role</th></tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.email}</td>
              <td><input defaultValue={u.full_name || ''} onBlur={(e) => e.target.value !== u.full_name && update(u, { full_name: e.target.value })} /></td>
              <td>
                <select value={u.role} onChange={(e) => update(u, { role: e.target.value })}>
                  {['pending', 'registrar', 'prescriber', 'lab', 'dispenser', 'admin'].map((r) => <option key={r}>{r}</option>)}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function Page() { return <Shell roles={['admin']} title="Administration"><Users /><Prices /></Shell> }
