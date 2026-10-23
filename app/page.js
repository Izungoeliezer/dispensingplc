'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function Home() {
  const router = useRouter()
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return router.replace('/login')
      const { data } = await supabase.from('profiles').select('role').eq('id', session.user.id).single()
      router.replace(data?.role === 'registrar' ? '/register' : data?.role === 'dispenser' ? '/dispense' : data?.role === 'admin' ? '/admin' : '/prescribe')
    })()
  }, [router])
  return <div className="center">Loading…</div>
}
