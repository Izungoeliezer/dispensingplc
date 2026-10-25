'use client'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import ResultsModal from '@/components/ResultsModal'

// For doctors: pops up when the laboratory has sent back new results.
export default function ResultsAlert({ userId }) {
  const router = useRouter()
  const [orders, setOrders] = useState([])
  const [open, setOpen] = useState(false)

  const check = useCallback(async () => {
    const { data } = await supabase.from('lab_orders').select('*')
      .eq('status', 'Completed').is('result_seen_at', null).eq('requested_by', userId).order('completed_at')
    setOrders((prev) => {
      const next = data || []
      if (next.length > 0 && next.some((n) => !prev.some((p) => p.id === n.id))) setOpen(true)
      return next
    })
  }, [userId])

  useEffect(() => { check(); const t = setInterval(check, 15000); return () => clearInterval(t) }, [check])

  const dismiss = async () => {
    const ids = orders.map((o) => o.id)
    setOpen(false)
    if (ids.length) { await supabase.rpc('mark_results_seen', { p_ids: ids }); setOrders([]) }
  }
  if (!open || orders.length === 0) return null
  return (
    <ResultsModal orders={orders} title="New laboratory results" onClose={dismiss}
      actions={(o) => o.visit_id && <button className="ghost" onClick={async () => { await dismiss(); router.push('/consult/' + o.visit_id) }}>Open patient</button>} />
  )
}
