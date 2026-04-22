import { createClient } from '@supabase/supabase-js'
import {
  requestTransfer,
  approveTransfer,
  sendTransfer,
  receiveTransfer,
  cancelTransfer,
} from '@/lib/services/transfers.js'
import { getCurrentUserEmail } from '@/lib/audit.js'
import { toErrorResponseWithStatus } from '@/lib/errors.js'

/**
 * POST /api/transfers
 * Handle transfer mutations: create, approve, send, receive, cancel
 */
export async function POST(request) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    const userEmail = await getCurrentUserEmail(supabase)
    const body = await request.json()
    const { action, transferId, fromLocationId, toLocationId, items, reason } = body

    let result

    switch (action) {
      case 'request':
        result = await requestTransfer(supabase, fromLocationId, toLocationId, items, userEmail)
        break

      case 'approve':
        result = await approveTransfer(supabase, transferId, userEmail)
        break

      case 'send':
        result = await sendTransfer(supabase, transferId, userEmail)
        break

      case 'receive':
        result = await receiveTransfer(supabase, transferId, userEmail)
        break

      case 'cancel':
        result = await cancelTransfer(supabase, transferId, reason, userEmail)
        break

      default:
        return Response.json(
          {
            success: false,
            error: {
              code: 'INVALID_ACTION',
              message: `Unknown action: ${action}`,
            },
          },
          { status: 400 }
        )
    }

    return Response.json({ success: true, data: result })
  } catch (err) {
    const { response, statusCode } = toErrorResponseWithStatus(err)
    return Response.json(response, { status: statusCode })
  }
}
