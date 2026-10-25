'use client'
import { useEffect, useState } from 'react'

// Search-and-choose box: only items returned by `search` can be added (no free text).
// Chosen items appear below as a numbered list.
export default function ListPicker({ label, placeholder, search, itemKey, render, value, onChange, noMatch, empty, extra, canRemove }) {
  const [q, setQ] = useState('')
  const [res, setRes] = useState([])
  const [searched, setSearched] = useState(false)
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)

  useEffect(() => {
    const term = q.replace(/[,()%*\\]/g, ' ').trim()
    setSearched(false)
    if (term.length < 2) { setRes([]); return }
    let stale = false
    const t = setTimeout(async () => {
      const data = await search(term)
      if (stale) return
      setRes(data || []); setHi(0); setSearched(true)
    }, 250)
    return () => { stale = true; clearTimeout(t) }
  }, [q]) // eslint-disable-line react-hooks/exhaustive-deps

  const add = (d) => {
    if (d && !value.some((v) => itemKey(v) === itemKey(d))) onChange([...value, d])
    setQ(''); setRes([])
  }
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, res.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); add(res[hi]) }
  }
  return (
    <div className="dx">
      <label>{label}
        <div className="picker">
          <input placeholder={placeholder} value={q} autoComplete="off"
            onChange={(e) => { setQ(e.target.value); setOpen(true) }} onKeyDown={onKey}
            onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
          {open && res.length > 0 && (
            <ul>
              {res.map((d, i) => (
                <li key={itemKey(d)} className={i === hi ? 'hi' : ''} onMouseDown={() => add(d)}>{render(d)}</li>
              ))}
            </ul>
          )}
          {open && searched && res.length === 0 && <ul><li className="muted">{noMatch}</li></ul>}
        </div>
      </label>
      {value.length === 0
        ? <p className="empty">{empty}</p>
        : (
          <ol className="sel-list">
            {value.map((d, i) => (
              <li key={itemKey(d)}>
                <span className="n">{i + 1}</span>
                <span className="grow">{render(d)}</span>
                {extra && extra(d)}
                {(!canRemove || canRemove(d)) && <button type="button" className="x" title="Remove" onClick={() => onChange(value.filter((v) => itemKey(v) !== itemKey(d)))}>✕</button>}
              </li>
            ))}
          </ol>
        )}
    </div>
  )
}
