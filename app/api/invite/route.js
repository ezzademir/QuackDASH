import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function POST(request) {
  const { email, full_name, role, location_id, password } = await request.json()

  if (!email || !full_name) {
    return NextResponse.json({ error: 'Email and name are required' }, { status: 400 })
  }
  if (!password || password.length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name },
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  if (data?.user?.id) {
    // Upsert first (handles case where no trigger exists)
    await supabase.from('user_profiles').upsert({
      id: data.user.id,
      full_name,
      role: role || 'outlet_staff',
      location_id: location_id || null,
    }, { onConflict: 'id' })

    // Explicit update to guarantee role/location are correct,
    // overriding any default set by a handle_new_user trigger
    await supabase.from('user_profiles')
      .update({
        full_name,
        role: role || 'outlet_staff',
        location_id: location_id || null,
      })
      .eq('id', data.user.id)
  }

  return NextResponse.json({ success: true })
}
