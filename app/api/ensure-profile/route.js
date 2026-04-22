import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export async function POST() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !anon || !service) {
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }

  const cookieStore = await cookies()
  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() { return cookieStore.getAll() },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        } catch { /* optional in Server Components */ }
      },
    },
  })

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const fullName = user.user_metadata?.full_name || user.email?.split('@')[0] || 'User'
  const admin = createClient(url, service)
  const { data: existing } = await admin.from('user_profiles').select('id').eq('id', user.id).maybeSingle()
  if (existing) {
    return NextResponse.json({ success: true, existed: true })
  }

  const { error } = await admin.from('user_profiles').insert({
    id: user.id,
    full_name: fullName,
    role: 'outlet_staff',
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ success: true })
}
