/**
 * Centralized error handling for API layer
 */

export class APIError extends Error {
  constructor(code, message, statusCode = 500, details = null) {
    super(message)
    this.code = code
    this.statusCode = statusCode
    this.details = details
    this.name = 'APIError'
  }
}

export function toErrorResponse(err) {
  if (err instanceof APIError) {
    return {
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
        timestamp: new Date().toISOString(),
      },
    }
  }

  console.error('Unexpected error:', err)
  return {
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: err.message || 'An unexpected error occurred',
      details: null,
      timestamp: new Date().toISOString(),
    },
  }
}

export function toErrorResponseWithStatus(err) {
  const response = toErrorResponse(err)
  const statusCode = err instanceof APIError ? err.statusCode : 500
  return { response, statusCode }
}

// Common error constructors
export const Errors = {
  // Auth
  UNAUTHORIZED: (details) => new APIError('UNAUTHORIZED', 'Authentication required', 401, details),
  FORBIDDEN: (details) => new APIError('FORBIDDEN', 'Permission denied', 403, details),

  // Validation
  INVALID_INPUT: (message, details) =>
    new APIError('INVALID_INPUT', message || 'Invalid input', 400, details),
  MISSING_FIELD: (field) =>
    new APIError('MISSING_FIELD', `Missing required field: ${field}`, 400, { field }),

  // Inventory
  INVENTORY_INSUFFICIENT: (itemName, needed, available) =>
    new APIError(
      'INVENTORY_INSUFFICIENT',
      `Insufficient inventory for ${itemName}: need ${needed}, have ${available}`,
      400,
      { itemName, needed, available }
    ),
  LOCATION_NOT_FOUND: (locationId) =>
    new APIError('LOCATION_NOT_FOUND', `Location not found: ${locationId}`, 404, { locationId }),
  ITEM_NOT_FOUND: (itemId) =>
    new APIError('ITEM_NOT_FOUND', `Item not found: ${itemId}`, 404, { itemId }),

  // Transfers
  TRANSFER_NOT_FOUND: (transferId) =>
    new APIError('TRANSFER_NOT_FOUND', `Transfer not found: ${transferId}`, 404, { transferId }),
  INVALID_TRANSFER_STATUS: (currentStatus, attemptedStatus) =>
    new APIError(
      'INVALID_TRANSFER_STATUS',
      `Cannot change transfer from ${currentStatus} to ${attemptedStatus}`,
      400,
      { currentStatus, attemptedStatus }
    ),

  // Procurement
  DELIVERY_ORDER_NOT_FOUND: (doId) =>
    new APIError('DELIVERY_ORDER_NOT_FOUND', `Delivery order not found: ${doId}`, 404, { doId }),
  OVER_RECEIVED: (lineItemId, expected, received) =>
    new APIError(
      'OVER_RECEIVED',
      `Over-received on line item ${lineItemId}: expected ${expected}, received ${received}`,
      400,
      { lineItemId, expected, received }
    ),

  // Suggestions
  SUGGESTION_NOT_FOUND: (suggestionId) =>
    new APIError('SUGGESTION_NOT_FOUND', `Suggestion not found: ${suggestionId}`, 404, {
      suggestionId,
    }),

  // Generic
  INTERNAL_ERROR: (details) =>
    new APIError('INTERNAL_ERROR', 'An unexpected error occurred', 500, details),
  DATABASE_ERROR: (details) =>
    new APIError('DATABASE_ERROR', 'Database operation failed', 500, details),
}
