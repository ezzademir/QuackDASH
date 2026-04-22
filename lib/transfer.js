/**
 * Intelligent transfer suggestion engine
 * Generates transfer suggestions from central kitchen to outlets
 * Handles UoM conversion via recipe_yields
 */

import { logAudit, getCurrentUserEmail } from './audit.js'

/**
 * Generate transfer suggestions for outlets approaching stockout
 * Uses consumption trends to predict when an outlet will run out
 * Considers central kitchen par levels to ensure it can still fulfill demand
 *
 * Logic:
 * 1. For each outlet + item where outlet inventory exists
 * 2. Calculate days_until_stockout = current_qty / consumption_rate
 * 3. If < 3 days: suggest transfer to bring outlet to par level
 * 4. Check central kitchen has capacity (above its own par level)
 * 5. Calculate qty needed (outlet par - current)
 * 6. Create suggestion with reason
 *
 * @param {object} supabase - Supabase client
 * @returns {Promise<{ success: boolean, suggestions: number, error?: string }>}
 */
export async function generateTransferSuggestions(supabase) {
  try {
    const userEmail = await getCurrentUserEmail(supabase)

    // 1. Get all outlets
    const { data: outlets, error: outletErr } = await supabase
      .from('locations')
      .select('id, name')
      .eq('type', 'outlet')
      .eq('is_active', true)
      .is('deleted_at', null)

    if (outletErr || !outlets) {
      console.error('Failed to fetch outlets:', outletErr)
      return { success: false, suggestions: 0, error: outletErr?.message }
    }

    // 2. Get central kitchen
    const { data: ckLocs, error: ckErr } = await supabase
      .from('locations')
      .select('id')
      .eq('type', 'central_kitchen')
      .eq('is_active', true)
      .is('deleted_at', null)
      .limit(1)

    if (ckErr || !ckLocs || ckLocs.length === 0) {
      console.error('No central kitchen location found')
      return { success: false, suggestions: 0, error: 'No central kitchen' }
    }

    const ckLocationId = ckLocs[0].id

    // 3. Get all inventory levels (outlets + central kitchen)
    const { data: inventory } = await supabase
      .from('inventory_levels')
      .select('item_id, location_id, quantity')

    const invMap = {}
    if (inventory) {
      inventory.forEach(i => {
        invMap[`${i.item_id}-${i.location_id}`] = i.quantity
      })
    }

    // 4. Get consumption trends
    const { data: trends } = await supabase
      .from('consumption_trends')
      .select('item_id, location_id, avg_qty_per_day')

    const trendMap = {}
    if (trends) {
      trends.forEach(t => {
        trendMap[`${t.item_id}-${t.location_id}`] = t.avg_qty_per_day
      })
    }

    // 5. Get auto_reorder_rules (both global and outlet-specific)
    const { data: allRules } = await supabase
      .from('auto_reorder_rules')
      .select('item_id, location_id, min_stock_qty, par_stock_qty')

    const ruleMap = {}
    if (allRules) {
      allRules.forEach(r => {
        const key = r.location_id ? `${r.item_id}-${r.location_id}` : r.item_id
        ruleMap[key] = r
      })
    }

    // 6. Get recipe_yields for UoM conversion
    const { data: yields } = await supabase
      .from('recipe_yields')
      .select('item_id, conversion_factor')

    const yieldMap = {}
    if (yields) {
      yields.forEach(y => {
        yieldMap[y.item_id] = y.conversion_factor
      })
    }

    // 7. Check for existing pending suggestions (don't duplicate)
    const { data: existingSuggestions } = await supabase
      .from('transfer_suggestions')
      .select('item_id, to_location_id')
      .eq('status', 'pending')
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())

    const existingKey = new Set()
    if (existingSuggestions) {
      existingSuggestions.forEach(s => {
        existingKey.add(`${s.item_id}-${s.to_location_id}`)
      })
    }

    // 8. Generate suggestions
    let createdCount = 0
    const suggestions = []

    for (const outlet of outlets) {
      try {
        // Get all items in this outlet's inventory
        const { data: outletInv } = await supabase
          .from('inventory_levels')
          .select('item_id, quantity')
          .eq('location_id', outlet.id)

        if (!outletInv) continue

        for (const inv of outletInv) {
          try {
            const key = `${inv.item_id}-${outlet.id}`

            // Skip if already has pending suggestion
            if (existingKey.has(key)) {
              continue
            }

            // Get outlet-specific rule or fallback to global
            const rule = ruleMap[key] || ruleMap[inv.item_id]
            if (!rule) continue  // No reorder rule for this item

            const consumption = trendMap[key] || 0
            if (consumption <= 0) continue  // No consumption data

            // Days until stockout
            const daysUntilStockout = inv.quantity / consumption

            if (daysUntilStockout < 3) {
              // Outlet is approaching stockout
              const parQtyOutlet = rule.par_stock_qty
              const qtyNeededOutlet = Math.max(0, parQtyOutlet - inv.quantity)

              if (qtyNeededOutlet <= 0) continue

              // Check central kitchen can fulfill
              const ckQty = invMap[`${inv.item_id}-${ckLocationId}`] || 0
              const ckRule = ruleMap[`${inv.item_id}-${ckLocationId}`] || ruleMap[inv.item_id]
              const ckPar = ckRule ? ckRule.par_stock_qty : 0

              // Convert outlet qty needed to central kitchen UoM
              const conversionFactor = yieldMap[inv.item_id] || 1
              const qtyNeededCK = qtyNeededOutlet / conversionFactor

              // Check if central kitchen has enough to send AND stay above par
              if (ckQty > (ckPar + qtyNeededCK)) {
                const reason = `Outlet stock at ${inv.quantity.toFixed(2)} ` +
                  `(${daysUntilStockout.toFixed(1)}d until stockout). ` +
                  `Par level: ${parQtyOutlet}. ` +
                  `Transfer ${qtyNeededOutlet.toFixed(2)} from central kitchen.`

                suggestions.push({
                  item_id: inv.item_id,
                  from_location_id: ckLocationId,
                  to_location_id: outlet.id,
                  suggested_qty: qtyNeededOutlet,
                  reason,
                  status: 'pending',
                  created_by: 'system',
                })

                createdCount++
              }
            }
          } catch (err) {
            console.error(`Error processing item ${inv.item_id} for outlet ${outlet.id}:`, err)
          }
        }
      } catch (err) {
        console.error(`Error processing outlet ${outlet.id}:`, err)
      }
    }

    // 9. Insert suggestions
    if (suggestions.length > 0) {
      const { error: insertErr } = await supabase
        .from('transfer_suggestions')
        .insert(suggestions)

      if (insertErr) {
        console.error('Failed to insert transfer suggestions:', insertErr)
        return { success: false, suggestions: 0, error: insertErr.message }
      }

      // Log to audit
      try {
        await logAudit(supabase, {
          table: 'transfer_suggestions',
          action: 'create',
          performedBy: userEmail,
          summary: `System generated ${createdCount} transfer suggestion(s)`,
        })
      } catch (auditErr) {
        console.warn('Audit log failed (non-critical):', auditErr)
      }
    }

    console.log(`Generated ${createdCount} transfer suggestions`)
    return { success: true, suggestions: createdCount }
  } catch (err) {
    console.error('generateTransferSuggestions error:', err)
    return { success: false, suggestions: 0, error: err.message }
  }
}

/**
 * Approve a transfer suggestion and create a stock_transfer
 * Creates transfer in "requested" status (normal approval workflow)
 *
 * @param {object} supabase - Supabase client
 * @param {string} suggestionId - transfer_suggestions.id
 * @param {object} opts - optional { qty } to override suggestion
 * @returns {Promise<{ success: boolean, transferId?: string, error?: string }>}
 */
export async function approveSuggestionAndCreateTransfer(supabase, suggestionId, opts = {}) {
  try {
    const userEmail = await getCurrentUserEmail(supabase)

    // Get the suggestion
    const { data: suggestion, error: suggErr } = await supabase
      .from('transfer_suggestions')
      .select('*')
      .eq('id', suggestionId)
      .single()

    if (suggErr || !suggestion) {
      return { success: false, error: 'Suggestion not found' }
    }

    const qty = opts.qty || suggestion.suggested_qty

    // Create stock transfer in "requested" status
    const { data: transfers, error: transErr } = await supabase
      .from('stock_transfers')
      .insert({
        from_location_id: suggestion.from_location_id,
        to_location_id: suggestion.to_location_id,
        status: 'requested',
        requested_by: userEmail,
        requested_at: new Date().toISOString(),
      })
      .select()

    if (transErr || !transfers || transfers.length === 0) {
      return { success: false, error: `Failed to create transfer: ${transErr?.message}` }
    }

    const transferId = transfers[0].id

    // Create transfer line item
    const { error: lineErr } = await supabase
      .from('transfer_line_items')
      .insert({
        transfer_id: transferId,
        item_id: suggestion.item_id,
        quantity: qty,
      })

    if (lineErr) {
      console.error('Failed to create line item:', lineErr)
      return { success: false, error: 'Failed to create line item' }
    }

    // Update suggestion status
    const { error: updateErr } = await supabase
      .from('transfer_suggestions')
      .update({
        status: 'routed',
        approved_by: userEmail,
        approved_at: new Date().toISOString(),
        stock_transfer_id: transferId,
      })
      .eq('id', suggestionId)

    if (updateErr) {
      console.error('Failed to update suggestion:', updateErr)
      return { success: false, error: 'Failed to update suggestion' }
    }

    // Log to audit
    try {
      await logAudit(supabase, {
        table: 'stock_transfers',
        recordId: transferId,
        action: 'create',
        performedBy: userEmail,
        summary: `Created transfer from transfer suggestion ${suggestionId}. Qty: ${qty}`,
      })
    } catch (auditErr) {
      console.warn('Audit log failed (non-critical):', auditErr)
    }

    return { success: true, transferId }
  } catch (err) {
    console.error('approveSuggestionAndCreateTransfer error:', err)
    return { success: false, error: err.message }
  }
}

/**
 * Dismiss/cancel a transfer suggestion
 *
 * @param {object} supabase - Supabase client
 * @param {string} suggestionId - transfer_suggestions.id
 * @param {string} reason - why it was dismissed
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export async function dismissTransferSuggestion(supabase, suggestionId, reason = '') {
  try {
    const userEmail = await getCurrentUserEmail(supabase)

    const { error } = await supabase
      .from('transfer_suggestions')
      .update({
        status: 'cancelled',
        approved_by: userEmail,
        approved_at: new Date().toISOString(),
      })
      .eq('id', suggestionId)

    if (error) {
      return { success: false, error: error.message }
    }

    // Log to audit
    try {
      await logAudit(supabase, {
        table: 'transfer_suggestions',
        recordId: suggestionId,
        action: 'update',
        performedBy: userEmail,
        summary: `Dismissed transfer suggestion. Reason: ${reason || 'N/A'}`,
      })
    } catch (auditErr) {
      console.warn('Audit log failed (non-critical):', auditErr)
    }

    return { success: true }
  } catch (err) {
    console.error('dismissTransferSuggestion error:', err)
    return { success: false, error: err.message }
  }
}
