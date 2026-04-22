import { createClient } from '@supabase/supabase-js'
import { generateTransferSuggestions, approveSuggestionAndCreateTransfer, dismissTransferSuggestion } from '@/lib/transfer.js'

/**
 * POST /api/transfers/suggest-auto-routing
 * Generate transfer suggestions for outlets approaching stockout
 *
 * Body: { action: 'generate' | 'approve' | 'dismiss', ... }
 */
export async function POST(request) {
  try {
    const body = await request.json()
    const { action, suggestionId, qty, reason } = body

    // Create server-side Supabase client
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    if (action === 'generate') {
      const result = await generateTransferSuggestions(supabase)
      return Response.json(result)
    }

    if (action === 'approve') {
      const result = await approveSuggestionAndCreateTransfer(supabase, suggestionId, { qty })
      return Response.json(result)
    }

    if (action === 'dismiss') {
      const result = await dismissTransferSuggestion(supabase, suggestionId, reason)
      return Response.json(result)
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    console.error('API error:', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}

/**
 * GET /api/transfers/suggest-auto-routing
 * Fetch pending transfer suggestions
 */
export async function GET(request) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') || 'pending'

    // Fetch pending suggestions with full details
    const { data, error } = await supabase
      .from('transfer_suggestions')
      .select(`
        id,
        item_id,
        from_location_id,
        to_location_id,
        suggested_qty,
        reason,
        status,
        created_at,
        items(name, units(abbreviation)),
        from_location:locations!from_location_id(name),
        to_location:locations!to_location_id(name)
      `)
      .eq('status', status)
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }

    return Response.json({ suggestions: data || [] })
  } catch (err) {
    console.error('API error:', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
