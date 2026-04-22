/**
 * Intelligent reorder suggestion engine
 * Generates PO suggestions when stock falls below trigger levels
 */

import { logAudit, getCurrentUserEmail } from './audit.js'

/**
 * Generate reorder suggestions for all active items with auto_order_enabled = true
 * Considers: consumption trends, lead times, par levels, min stock
 *
 * Logic:
 * 1. For each active item with auto_order_enabled
 * 2. Find applicable reorder rule (prefer central_kitchen location, fallback to NULL/global)
 * 3. Calculate trigger_qty = min_stock + (consumption_rate * lead_time_buffer_days)
 * 4. Get current central kitchen inventory
 * 5. If current < trigger, create suggestion with best supplier
 *
 * @param {object} supabase - Supabase client
 * @returns {Promise<{ success: boolean, suggestions: number, error?: string }>}
 */
export async function generateReorderSuggestions(supabase) {
  try {
    const userEmail = await getCurrentUserEmail(supabase)

    // 1. Get all auto-reorder rules enabled for central kitchen
    const { data: rules, error: rulesErr } = await supabase
      .from('auto_reorder_rules')
      .select('id, item_id, min_stock_qty, par_stock_qty, lead_time_buffer_days')
      .eq('auto_order_enabled', true)
      .is('location_id', null)  // Global rules (central kitchen)

    if (rulesErr || !rules) {
      console.error('Failed to fetch reorder rules:', rulesErr)
      return { success: false, suggestions: 0, error: rulesErr?.message }
    }

    // 2. Get consumption trends
    const { data: trends } = await supabase
      .from('consumption_trends')
      .select('item_id, location_id, avg_qty_per_day')

    const trendMap = {}
    if (trends) {
      trends.forEach(t => {
        trendMap[`${t.item_id}-${t.location_id}`] = t.avg_qty_per_day
      })
    }

    // 3. Get items with their reorder_level (fallback)
    const { data: items } = await supabase
      .from('items')
      .select('id, reorder_level')
      .eq('is_active', true)
      .is('deleted_at', null)

    const itemMap = {}
    if (items) {
      items.forEach(i => { itemMap[i.id] = i })
    }

    // 4. Get central kitchen location
    const { data: ckLocs } = await supabase
      .from('locations')
      .select('id')
      .eq('type', 'central_kitchen')
      .eq('is_active', true)
      .is('deleted_at', null)
      .limit(1)

    if (!ckLocs || ckLocs.length === 0) {
      console.error('No central kitchen location found')
      return { success: false, suggestions: 0, error: 'No central kitchen location' }
    }

    const ckLocationId = ckLocs[0].id

    // 5. Get current inventory at central kitchen
    const { data: currentInv } = await supabase
      .from('inventory_levels')
      .select('item_id, quantity')
      .eq('location_id', ckLocationId)

    const invMap = {}
    if (currentInv) {
      currentInv.forEach(i => { invMap[i.item_id] = i.quantity })
    }

    // 6. Get suppliers with their costs
    const { data: suppliers } = await supabase
      .from('suppliers')
      .select('id, lead_time_days, cost_ranking')

    const supplierMap = {}
    if (suppliers) {
      suppliers.forEach(s => { supplierMap[s.id] = s })
    }

    // 7. Get supply routes (item -> supplier mapping)
    const { data: routes } = await supabase
      .from('supply_routes')
      .select('item_id, supplier_id, unit_cost, min_order_qty')
      .order('unit_cost', { ascending: true })

    const routeMap = {}
    if (routes) {
      routes.forEach(r => {
        if (!routeMap[r.item_id]) routeMap[r.item_id] = []
        routeMap[r.item_id].push(r)
      })
    }

    // 8. Check for existing pending suggestions (don't duplicate)
    const { data: existingSuggestions } = await supabase
      .from('reorder_suggestions')
      .select('item_id')
      .eq('status', 'pending_approval')
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())  // Last 24h

    const existingItems = new Set()
    if (existingSuggestions) {
      existingSuggestions.forEach(s => { existingItems.add(s.item_id) })
    }

    // 9. Generate suggestions
    let createdCount = 0
    const suggestions = []

    for (const rule of rules) {
      try {
        // Skip if already has pending suggestion
        if (existingItems.has(rule.item_id)) {
          continue
        }

        const item = itemMap[rule.item_id]
        if (!item) continue

        // Get consumption rate (default to reorder_level / 30 if no trend)
        const consumption = trendMap[`${rule.item_id}-${ckLocationId}`] ||
          (item.reorder_level ? item.reorder_level / 30 : 0) ||
          0

        // Calculate trigger quantity
        const forecastedDemand = consumption * (rule.lead_time_buffer_days || 7)
        const triggerQty = rule.min_stock_qty + forecastedDemand
        const currentQty = invMap[rule.item_id] || 0

        // Check if stock below trigger
        if (currentQty < triggerQty) {
          const suggestedQty = Math.max(0, rule.par_stock_qty - currentQty)

          // Find best supplier (cheapest)
          const itemRoutes = routeMap[rule.item_id] || []
          let bestSupplier = null
          let bestRoute = null

          if (itemRoutes.length > 0) {
            bestRoute = itemRoutes[0]  // Already sorted by cost_ranking
            bestSupplier = bestRoute.supplier_id
          } else {
            // Fallback: pick any supplier with cheapest cost_ranking
            let cheapest = null
            for (const supplierId in supplierMap) {
              if (!cheapest || (supplierMap[supplierId].cost_ranking || 100) < (supplierMap[cheapest].cost_ranking || 100)) {
                cheapest = supplierId
              }
            }
            if (cheapest) bestSupplier = cheapest
          }

          if (bestSupplier) {
            const reason = `Stock at ${currentQty.toFixed(2)}. Consumption: ${consumption.toFixed(2)}/day. ` +
              `Lead time: ${rule.lead_time_buffer_days}d. Trigger when < ${triggerQty.toFixed(2)}. ` +
              `Par level: ${rule.par_stock_qty}. Order ${suggestedQty.toFixed(2)}.`

            suggestions.push({
              item_id: rule.item_id,
              suggested_qty: suggestedQty,
              suggested_supplier_id: bestSupplier,
              reason,
              status: 'pending_approval',
              created_by: 'system',
            })

            createdCount++
          }
        }
      } catch (err) {
        console.error(`Error processing rule for item ${rule.item_id}:`, err)
      }
    }

    // 10. Insert suggestions
    if (suggestions.length > 0) {
      const { error: insertErr } = await supabase
        .from('reorder_suggestions')
        .insert(suggestions)

      if (insertErr) {
        console.error('Failed to insert suggestions:', insertErr)
        return { success: false, suggestions: 0, error: insertErr.message }
      }

      // Log to audit
      try {
        await logAudit(supabase, {
          table: 'reorder_suggestions',
          action: 'create',
          performedBy: userEmail,
          summary: `System generated ${createdCount} reorder suggestion(s)`,
        })
      } catch (auditErr) {
        console.warn('Audit log failed (non-critical):', auditErr)
      }
    }

    console.log(`Generated ${createdCount} reorder suggestions`)
    return { success: true, suggestions: createdCount }
  } catch (err) {
    console.error('generateReorderSuggestions error:', err)
    return { success: false, suggestions: 0, error: err.message }
  }
}

/**
 * Approve a reorder suggestion and create a delivery order
 * Manager can optionally edit suggested qty/supplier before approval
 *
 * @param {object} supabase - Supabase client
 * @param {string} suggestionId - reorder_suggestions.id
 * @param {object} opts - optional { qty, supplierIds } to override suggestion
 * @returns {Promise<{ success: boolean, deliveryOrderId?: string, error?: string }>}
 */
export async function approveSuggestionAndCreateDO(supabase, suggestionId, opts = {}) {
  try {
    const userEmail = await getCurrentUserEmail(supabase)

    // Get the suggestion
    const { data: suggestion, error: suggErr } = await supabase
      .from('reorder_suggestions')
      .select('*')
      .eq('id', suggestionId)
      .single()

    if (suggErr || !suggestion) {
      return { success: false, error: 'Suggestion not found' }
    }

    const qty = opts.qty || suggestion.suggested_qty
    const supplierId = opts.supplierId || suggestion.suggested_supplier_id

    // Create delivery order (draft status)
    const { data: dos, error: doErr } = await supabase
      .from('delivery_orders')
      .insert({
        do_number: `AUTO-${Date.now()}`,
        supplier_id: supplierId,
        status: 'draft',
        expected_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),  // +7 days
      })
      .select()

    if (doErr || !dos || dos.length === 0) {
      return { success: false, error: `Failed to create delivery order: ${doErr?.message}` }
    }

    const doId = dos[0].id

    // Create delivery order line item
    const { error: lineErr } = await supabase
      .from('do_line_items')
      .insert({
        delivery_order_id: doId,
        item_id: suggestion.item_id,
        expected_qty: qty,
        received_qty: 0,
      })

    if (lineErr) {
      console.error('Failed to create line item:', lineErr)
      return { success: false, error: 'Failed to create line item' }
    }

    // Update suggestion status
    const { error: updateErr } = await supabase
      .from('reorder_suggestions')
      .update({
        status: 'ordered',
        approved_by: userEmail,
        approved_at: new Date().toISOString(),
        delivery_order_id: doId,
      })
      .eq('id', suggestionId)

    if (updateErr) {
      console.error('Failed to update suggestion:', updateErr)
      return { success: false, error: 'Failed to update suggestion' }
    }

    // Log to audit
    try {
      await logAudit(supabase, {
        table: 'delivery_orders',
        recordId: doId,
        action: 'create',
        performedBy: userEmail,
        summary: `Created DO from reorder suggestion ${suggestionId}. Qty: ${qty}`,
      })
    } catch (auditErr) {
      console.warn('Audit log failed (non-critical):', auditErr)
    }

    return { success: true, deliveryOrderId: doId }
  } catch (err) {
    console.error('approveSuggestionAndCreateDO error:', err)
    return { success: false, error: err.message }
  }
}

/**
 * Dismiss/cancel a reorder suggestion
 *
 * @param {object} supabase - Supabase client
 * @param {string} suggestionId - reorder_suggestions.id
 * @param {string} reason - why it was dismissed
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export async function dismissSuggestion(supabase, suggestionId, reason = '') {
  try {
    const userEmail = await getCurrentUserEmail(supabase)

    const { error } = await supabase
      .from('reorder_suggestions')
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
        table: 'reorder_suggestions',
        recordId: suggestionId,
        action: 'update',
        performedBy: userEmail,
        summary: `Dismissed reorder suggestion. Reason: ${reason || 'N/A'}`,
      })
    } catch (auditErr) {
      console.warn('Audit log failed (non-critical):', auditErr)
    }

    return { success: true }
  } catch (err) {
    console.error('dismissSuggestion error:', err)
    return { success: false, error: err.message }
  }
}
