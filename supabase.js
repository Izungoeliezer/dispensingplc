import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder'
)

export const money = (n) =>
  'TZS ' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })

// total of a prescription: stored price once dispensed, current medicine price before that
export const itemPrice = (it) => Number(it.unit_price ?? it.medicines?.price ?? 0)
export const rxTotal = (rx) =>
  (rx.prescription_items || []).reduce((s, it) => s + itemPrice(it) * Number(it.quantity || 0), 0)
