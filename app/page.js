'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function Home() {
  const router = useRouter()
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession()
      router.replace(session ? '/dashboard' : '/login')
    })()
  }, [router])
  return <div className="center muted">Loading…</div>
}
