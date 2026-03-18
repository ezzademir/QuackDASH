import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function POST(request) {
  const { email, full_name, role, location_id } = await request.json()

  if (!email || !full_name) {
    return NextResponse.json({ error: 'Email and name are required' }, { status: 400 })
  }

  // Use service role key — server side only, never exposed to browser
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  // Send invite
  const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
    redirectTo: `https://quack-dash.vercel.app/set-password`,
    data: { full_name }
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  // Assign role and location
  if (data?.user?.id) {
    await supabase.from('user_profiles').upsert({
      id: data.user.id,
      full_name,
      role: role || 'outlet_staff',
      location_id: location_id || null,
    })
  }

  return NextResponse.json({ success: true })
}