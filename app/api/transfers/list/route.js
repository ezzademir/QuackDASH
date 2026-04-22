import { createClient } from '@supabase/supabase-js'
import { getTransfers } from '@/lib/services/transfers.js'
import { toErrorResponseWithStatus } from '@/lib/errors.js'

/**
 * GET /api/transfers/list
 * Fetch transfers with optional filters
 */
export async function GET(request) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const fromLocationId = searchParams.get('from_location_id')
    const toLocationId = searchParams.get('to_location_id')
    const limit = parseInt(searchParams.get('limit') || '100', 10)

    const transfers = await getTransfers(supabase, {
      status,
      from_location_id: fromLocationId,
      to_location_id: toLocationId,
      limit,
    })

    return Response.json({ success: true, data: transfers })
  } catch (err) {
    const { response, statusCode } = toErrorResponseWithStatus(err)
    return Response.json(response, { status: statusCode })
  }
}
