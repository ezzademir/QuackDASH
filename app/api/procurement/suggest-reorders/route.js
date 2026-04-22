import { createClient } from '@supabase/supabase-js'
import { generateReorderSuggestions, approveSuggestionAndCreateDO, dismissSuggestion } from '@/lib/reorder.js'

/**
 * POST /api/procurement/suggest-reorders
 * Generate reorder suggestions for all items below trigger level
 *
 * Body: { action: 'generate' }
 */
export async function POST(request) {
  try {
    const body = await request.json()
    const { action, suggestionId, qty, supplierId, reason } = body

    // Create server-side Supabase client (service role for safety)
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    if (action === 'generate') {
      const result = await generateReorderSuggestions(supabase)
      return Response.json(result)
    }

    if (action === 'approve') {
      const result = await approveSuggestionAndCreateDO(supabase, suggestionId, { qty, supplierId })
      return Response.json(result)
    }

    if (action === 'dismiss') {
      const result = await dismissSuggestion(supabase, suggestionId, reason)
      return Response.json(result)
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    console.error('API error:', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}

/**
 * GET /api/procurement/suggest-reorders
 * Fetch pending reorder suggestions
 */
export async function GET(request) {
  try {
    // Create server-side client
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') || 'pending_approval'

    // Fetch pending suggestions with item + supplier details
    const { data, error } = await supabase
      .from('reorder_suggestions')
      .select(`
        id,
        item_id,
        suggested_qty,
        suggested_supplier_id,
        reason,
        status,
        created_at,
        items(name, reorder_level, units(abbreviation)),
        suppliers(name, lead_time_days)
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
