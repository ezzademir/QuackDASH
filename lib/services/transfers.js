/**
 * Transfer service: handles all stock transfer operations
 * Pure functions: no React, no HTTP, testable and reusable
 */

import { logAudit, getCurrentUserEmail } from '../audit.js'
import { Errors } from '../errors.js'

/**
 * Get all transfers with line items and location details
 * @param {object} supabase - Supabase client
 * @param {object} filters - { status?, from_location_id?, to_location_id?, limit? }
 * @returns {Promise<array>} transfers with line items + location names
 */
export async function getTransfers(supabase, filters = {}) {
  const { status, from_location_id, to_location_id, limit = 100 } = filters

  let query = supabase
    .from('stock_transfers')
    .select(
      `
      id,
      from_location_id,
      to_location_id,
      status,
      requested_at,
      approved_at,
      sent_at,
      received_at,
      requested_by,
      approved_by,
      transfer_line_items(
        id,
        item_id,
        quantity,
        items(name, units(abbreviation))
      ),
      from_location:locations!from_location_id(id, name, type),
      to_location:locations!to_location_id(id, name, type)
    `
    )
    .order('requested_at', { ascending: false })
    .limit(limit)

  if (status) {
    query = query.eq('status', status)
  }
  if (from_location_id) {
    query = query.eq('from_location_id', from_location_id)
  }
  if (to_location_id) {
    query = query.eq('to_location_id', to_location_id)
  }

  const { data, error } = await query

  if (error) {
    throw Errors.DATABASE_ERROR(error.message)
  }

  return data || []
}

/**
 * Create a transfer request
 * @param {object} supabase - Supabase client
 * @param {string} fromLocationId - source location
 * @param {string} toLocationId - destination location
 * @param {array} items - [{ itemId, quantity }, ...]
 * @param {string} userEmail - user creating the transfer
 * @returns {Promise<object>} created transfer
 */
export async function requestTransfer(supabase, fromLocationId, toLocationId, items, userEmail) {
  // Validate locations exist
  const { data: fromLoc, error: fromErr } = await supabase
    .from('locations')
    .select('id')
    .eq('id', fromLocationId)
    .single()

  if (fromErr || !fromLoc) {
    throw Errors.LOCATION_NOT_FOUND(fromLocationId)
  }

  const { data: toLoc, error: toErr } = await supabase
    .from('locations')
    .select('id')
    .eq('id', toLocationId)
    .single()

  if (toErr || !toLoc) {
    throw Errors.LOCATION_NOT_FOUND(toLocationId)
  }

  // Validate source has sufficient inventory
  for (const item of items) {
    const { data: inv } = await supabase
      .from('inventory_levels')
      .select('quantity, items(name)')
      .eq('location_id', fromLocationId)
      .eq('item_id', item.itemId)
      .single()

    if (!inv || inv.quantity < item.quantity) {
      throw Errors.INVENTORY_INSUFFICIENT(
        inv?.items?.name || item.itemId,
        item.quantity,
        inv?.quantity || 0
      )
    }
  }

  // Create transfer
  const { data: transfer, error: insertErr } = await supabase
    .from('stock_transfers')
    .insert({
      from_location_id: fromLocationId,
      to_location_id: toLocationId,
      status: 'requested',
      requested_by: userEmail,
      requested_at: new Date().toISOString(),
    })
    .select()

  if (insertErr || !transfer || transfer.length === 0) {
    throw Errors.DATABASE_ERROR('Failed to create transfer')
  }

  const transferId = transfer[0].id

  // Create line items
  const lineItems = items.map((item) => ({
    transfer_id: transferId,
    item_id: item.itemId,
    quantity: item.quantity,
  }))

  const { error: lineErr } = await supabase.from('transfer_line_items').insert(lineItems)

  if (lineErr) {
    throw Errors.DATABASE_ERROR('Failed to create transfer line items')
  }

  // Log audit
  try {
    await logAudit(supabase, {
      table: 'stock_transfers',
      recordId: transferId,
      action: 'create',
      performedBy: userEmail,
      summary: `Requested transfer from ${fromLoc.name} to ${toLoc.name}`,
      newData: transfer[0],
    })
  } catch (auditErr) {
    console.warn('Audit log failed (non-critical):', auditErr)
  }

  return transfer[0]
}

/**
 * Approve a transfer request
 * @param {object} supabase - Supabase client
 * @param {string} transferId - transfer to approve
 * @param {string} userEmail - user approving
 * @returns {Promise<object>} updated transfer
 */
export async function approveTransfer(supabase, transferId, userEmail) {
  const { data: transfer, error: getErr } = await supabase
    .from('stock_transfers')
    .select('*')
    .eq('id', transferId)
    .single()

  if (getErr || !transfer) {
    throw Errors.TRANSFER_NOT_FOUND(transferId)
  }

  if (transfer.status !== 'requested') {
    throw Errors.INVALID_TRANSFER_STATUS(transfer.status, 'approved')
  }

  const { data: updated, error: updateErr } = await supabase
    .from('stock_transfers')
    .update({
      status: 'approved',
      approved_by: userEmail,
      approved_at: new Date().toISOString(),
    })
    .eq('id', transferId)
    .select()

  if (updateErr || !updated || updated.length === 0) {
    throw Errors.DATABASE_ERROR('Failed to approve transfer')
  }

  try {
    await logAudit(supabase, {
      table: 'stock_transfers',
      recordId: transferId,
      action: 'update',
      performedBy: userEmail,
      summary: 'Approved transfer',
      oldData: { status: transfer.status },
      newData: { status: 'approved' },
    })
  } catch (auditErr) {
    console.warn('Audit log failed (non-critical):', auditErr)
  }

  return updated[0]
}

/**
 * Send a transfer (mark as in_transit)
 * @param {object} supabase - Supabase client
 * @param {string} transferId - transfer to send
 * @param {string} userEmail - user sending
 * @returns {Promise<object>} updated transfer
 */
export async function sendTransfer(supabase, transferId, userEmail) {
  const { data: transfer, error: getErr } = await supabase
    .from('stock_transfers')
    .select('*')
    .eq('id', transferId)
    .single()

  if (getErr || !transfer) {
    throw Errors.TRANSFER_NOT_FOUND(transferId)
  }

  if (transfer.status !== 'approved') {
    throw Errors.INVALID_TRANSFER_STATUS(transfer.status, 'in_transit')
  }

  const { data: updated, error: updateErr } = await supabase
    .from('stock_transfers')
    .update({
      status: 'in_transit',
      sent_at: new Date().toISOString(),
    })
    .eq('id', transferId)
    .select()

  if (updateErr || !updated || updated.length === 0) {
    throw Errors.DATABASE_ERROR('Failed to send transfer')
  }

  try {
    await logAudit(supabase, {
      table: 'stock_transfers',
      recordId: transferId,
      action: 'update',
      performedBy: userEmail,
      summary: 'Sent transfer (in_transit)',
    })
  } catch (auditErr) {
    console.warn('Audit log failed (non-critical):', auditErr)
  }

  return updated[0]
}

/**
 * Receive a transfer (complete the transfer, update inventory)
 * @param {object} supabase - Supabase client
 * @param {string} transferId - transfer to receive
 * @param {string} userEmail - user receiving
 * @returns {Promise<object>} { success, transfer, inventoryUpdates }
 */
export async function receiveTransfer(supabase, transferId, userEmail) {
  const { data: transfer, error: getErr } = await supabase
    .from('stock_transfers')
    .select(
      `
      *,
      transfer_line_items(id, item_id, quantity),
      from_location:locations!from_location_id(name),
      to_location:locations!to_location_id(name)
    `
    )
    .eq('id', transferId)
    .single()

  if (getErr || !transfer) {
    throw Errors.TRANSFER_NOT_FOUND(transferId)
  }

  if (transfer.status !== 'in_transit') {
    throw Errors.INVALID_TRANSFER_STATUS(transfer.status, 'received')
  }

  // Update inventory for each line item
  const inventoryUpdates = []

  for (const lineItem of transfer.transfer_line_items) {
    // Deduct from source location
    const { data: sourceInv } = await supabase
      .from('inventory_levels')
      .select('*')
      .eq('location_id', transfer.from_location_id)
      .eq('item_id', lineItem.item_id)
      .single()

    if (sourceInv) {
      await supabase
        .from('inventory_levels')
        .update({
          quantity: Math.max(0, sourceInv.quantity - lineItem.quantity),
          updated_at: new Date().toISOString(),
        })
        .eq('id', sourceInv.id)
    }

    // Add to destination location (create or update)
    const { data: destInv } = await supabase
      .from('inventory_levels')
      .select('*')
      .eq('location_id', transfer.to_location_id)
      .eq('item_id', lineItem.item_id)
      .single()

    if (destInv) {
      await supabase
        .from('inventory_levels')
        .update({
          quantity: destInv.quantity + lineItem.quantity,
          updated_at: new Date().toISOString(),
        })
        .eq('id', destInv.id)
    } else {
      // Create new inventory record for destination
      await supabase.from('inventory_levels').insert({
        location_id: transfer.to_location_id,
        item_id: lineItem.item_id,
        quantity: lineItem.quantity,
      })
    }

    inventoryUpdates.push({
      itemId: lineItem.item_id,
      qty: lineItem.quantity,
    })
  }

  // Mark transfer as received
  const { data: updated, error: updateErr } = await supabase
    .from('stock_transfers')
    .update({
      status: 'received',
      received_at: new Date().toISOString(),
    })
    .eq('id', transferId)
    .select()

  if (updateErr || !updated || updated.length === 0) {
    throw Errors.DATABASE_ERROR('Failed to receive transfer')
  }

  try {
    await logAudit(supabase, {
      table: 'stock_transfers',
      recordId: transferId,
      action: 'update',
      performedBy: userEmail,
      summary: `Received transfer: ${inventoryUpdates.length} items updated`,
    })
  } catch (auditErr) {
    console.warn('Audit log failed (non-critical):', auditErr)
  }

  return {
    success: true,
    transfer: updated[0],
    inventoryUpdates,
  }
}

/**
 * Cancel a transfer
 * @param {object} supabase - Supabase client
 * @param {string} transferId - transfer to cancel
 * @param {string} reason - cancellation reason
 * @param {string} userEmail - user cancelling
 * @returns {Promise<object>} updated transfer
 */
export async function cancelTransfer(supabase, transferId, reason, userEmail) {
  const { data: transfer, error: getErr } = await supabase
    .from('stock_transfers')
    .select('status')
    .eq('id', transferId)
    .single()

  if (getErr || !transfer) {
    throw Errors.TRANSFER_NOT_FOUND(transferId)
  }

  // Can only cancel if requested or approved
  if (!['requested', 'approved'].includes(transfer.status)) {
    throw Errors.INVALID_TRANSFER_STATUS(transfer.status, 'cancelled')
  }

  const { data: updated, error: updateErr } = await supabase
    .from('stock_transfers')
    .update({
      status: 'cancelled',
    })
    .eq('id', transferId)
    .select()

  if (updateErr || !updated || updated.length === 0) {
    throw Errors.DATABASE_ERROR('Failed to cancel transfer')
  }

  try {
    await logAudit(supabase, {
      table: 'stock_transfers',
      recordId: transferId,
      action: 'update',
      performedBy: userEmail,
      summary: `Cancelled transfer. Reason: ${reason || 'N/A'}`,
    })
  } catch (auditErr) {
    console.warn('Audit log failed (non-critical):', auditErr)
  }

  return updated[0]
}
