'use client'

import { useEffect, useState } from 'react'
import { createClient } from '../../lib/supabase'
import Link from 'next/link'

export default function StockTakesPage() {
  const supabase = createClient()
  const [stockTakes, setStockTakes] = useState([])
  const [locations, setLocations] = useState([])
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [selectedTake, setSelectedTake] = useState(null)
  const [takeItems, setTakeItems] = useState([])
  const [filterStatus, setFilterStatus] = useState('all')
  const [saving, setSaving] = useState(false)
  const [approving, setApproving] = useState(false)
  const [form, setForm] = useState({ location_id: '', notes: '' })
  const [counts, setCounts] = useState({})

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const [st, loc, itm] = await Promise.all([
      supabase
        .from('stock_takes')
        .select('*, locations(name)')
        .order('started_at', { ascending: false }),
      supabase.from('locations').select('*').order('name'),
      supabase.from('items').select('*, units(abbreviation)').eq('is_active', true).order('name'),
    ])
    if (st.data) setStockTakes(st.data)
    if (loc.data) setLocations(loc.data)
    if (itm.data) setItems(itm.data)
    setLoading(false)
  }

  async function openStockTake(take) {
    setSelectedTake(take)
    const { data } = await supabase
      .from('stock_take_items')
      .select('*, items(name, units(abbreviation))')
      .eq('stock_take_id', take.id)
    setTakeItems(data || [])
  }

  async function startStockTake() {
    if (!form.location_id) return alert('Select a location')
    setSaving(true)

    // Get current inventory levels for this location
    const { data: currentLevels } = await supabase
      .from('inventory_levels')
      .select('*, items(name, units(abbreviation))')
      .eq('location_id', form.location_id)

    // Create the stock take
    const { data: take, error } = await supabase
      .from('stock_takes')
      .insert({
        location_id: form.location_id,
        notes: form.notes,
        status: 'in_progress',
      })
      .select()
      .single()

    if (error) { alert('Error creating stock take'); setSaving(false); return }

    // Pre-fill line items with current system quantities
    const lineItems = items.map(item => {
      const current = currentLevels?.find(l => l.item_id === item.id)
      return {
        stock_take_id: take.id,
        item_id: item.id,
        system_qty: current?.quantity || 0,
        counted_qty: null,
      }
    })

    await supabase.from('stock_take_items').insert(lineItems)

    setSaving(false)
    setShowForm(false)
    setForm({ location_id: '', notes: '' })
    await fetchAll()
    // Open the new stock take immediately
    openStockTake(take)
  }

  async function saveCount(takeId, itemId, value) {
    const qty = parseFloat(value)
    if (isNaN(qty)) return
    await supabase
      .from('stock_take_items')
      .update({ counted_qty: qty })
      .eq('stock_take_id', takeId)
      .eq('item_id', itemId)
    setCounts(prev => ({ ...prev, [`${takeId}-${itemId}`]: qty }))
    // Refresh take items
    const { data } = await supabase
      .from('stock_take_items')
      .select('*, items(name, units(abbreviation))')
      .eq('stock_take_id', takeId)
    setTakeItems(data || [])
  }

  async function submitForApproval(take) {
    await supabase
      .from('stock_takes')
      .update({ status: 'pending_approval' })
      .eq('id', take.id)
    setSelectedTake({ ...take, status: 'pending_approval' })
    fetchAll()
  }

  async function approveTake(take) {
    setApproving(true)
    // Apply counted quantities to inventory levels
    const { data: lines } = await supabase
      .from('stock_take_items')
      .select('*')
      .eq('stock_take_id', take.id)
      .not('counted_qty', 'is', null)

    for (const line of lines || []) {
      const { data: existing } = await supabase
        .from('inventory_levels')
        .select('*')
        .eq('location_id', take.location_id)
        .eq('item_id', line.item_id)
        .single()

      if (existing) {
        await supabase
          .from('inventory_levels')
          .update({ quantity: line.counted_qty })
          .eq('id', existing.id)
      } else {
        await supabase
          .from('inventory_levels')
          .insert({
            location_id: take.location_id,
            item_id: line.item_id,
            quantity: line.counted_qty,
          })
      }
    }

    await supabase
      .from('stock_takes')
      .update({ status: 'approved', approved_at: new Date().toISOString() })
      .eq('id', take.id)

    setSelectedTake({ ...take, status: 'approved' })
    setApproving(false)
    fetchAll()
  }

  async function rejectTake(take) {
    await supabase
      .from('stock_takes')
      .update({ status: 'rejected' })
      .eq('id', take.id)
    setSelectedTake({ ...take, status: 'rejected' })
    fetchAll()
  }

  const filtered = filterStatus === 'all'
    ? stockTakes
    : stockTakes.filter(t => t.status === filterStatus)

  const statusColor = {
    in_progress:      'bg-blue-100 text-blue-800',
    pending_approval: 'bg-amber-100 text-amber-800',
    approved:         'bg-green-100 text-green-800',
    rejected:         'bg-red-100 text-red-800',
  }

  const countedItems = takeItems.filter(i => i.counted_qty !== null)
  const variantItems = takeItems.filter(i => i.variance_qty !== 0 && i.counted_qty !== null)

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Header */}
      <header className="bg-gray-900 text-white px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="w-8 h-8 bg-yellow-400 rounded-full flex items-center justify-center text-gray-900 font-bold text-sm">Q</Link>
          <div>
            <h1 className="font-bold text-lg leading-none">Stock takes</h1>
            <p className="text-gray-400 text-xs">Physical inventory counts</p>
          </div>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="bg-yellow-400 text-gray-900 text-sm font-bold px-4 py-2 rounded-lg hover:bg-yellow-300 transition-colors"
        >
          + New stock take
        </button>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6">

        {/* Status filter */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {['all', 'in_progress', 'pending_approval', 'approved', 'rejected'].map(s => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors capitalize ${filterStatus === s ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}
            >
              {s.replace('_', ' ')}
              {s !== 'all' && (
                <span className="ml-1.5 opacity-60">
                  {stockTakes.filter(t => t.status === s).length}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

          {/* Stock takes list */}
          <div className="lg:col-span-2 space-y-3">
            {loading ? (
              <div className="bg-white rounded-xl p-12 text-center shadow-sm border border-gray-100">
                <div className="w-8 h-8 border-4 border-yellow-400 border-t-transparent rounded-full animate-spin mx-auto mb-3"/>
              </div>
            ) : filtered.length === 0 ? (
              <div className="bg-white rounded-xl p-12 text-center shadow-sm border border-gray-100">
                <div className="text-4xl mb-3">📋</div>
                <p className="text-gray-500 text-sm font-medium">No stock takes yet</p>
                <p className="text-gray-400 text-xs mt-1">Start a stock take to count inventory</p>
                <button onClick={() => setShowForm(true)} className="mt-4 bg-yellow-400 text-gray-900 text-sm font-bold px-4 py-2 rounded-lg hover:bg-yellow-300">
                  + New stock take
                </button>
              </div>
            ) : (
              filtered.map(take => (
                <div
                  key={take.id}
                  onClick={() => openStockTake(take)}
                  className={`bg-white rounded-xl p-4 shadow-sm border cursor-pointer transition-all hover:shadow-md ${selectedTake?.id === take.id ? 'border-yellow-400' : 'border-gray-100'}`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{take.locations?.name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {new Date(take.started_at).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${statusColor[take.status]}`}>
                      {take.status.replace('_', ' ')}
                    </span>
                  </div>
                  {take.notes && (
                    <p className="text-xs text-gray-500 mt-2 bg-gray-50 px-3 py-2 rounded-lg">{take.notes}</p>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Stock take detail */}
          <div className="lg:col-span-3">
            {selectedTake ? (
              <div className="bg-white rounded-xl shadow-sm border border-gray-100">
                {/* Take header */}
                <div className="px-5 py-4 border-b border-gray-100">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="font-semibold text-gray-900">{selectedTake.locations?.name}</h2>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {new Date(selectedTake.started_at).toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'long' })}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${statusColor[selectedTake.status]}`}>
                        {selectedTake.status.replace('_', ' ')}
                      </span>
                      <button onClick={() => setSelectedTake(null)} className="text-gray-400 hover:text-gray-600">×</button>
                    </div>
                  </div>

                  {/* Progress bar */}
                  {selectedTake.status === 'in_progress' && takeItems.length > 0 && (
                    <div className="mt-3">
                      <div className="flex justify-between text-xs text-gray-500 mb-1">
                        <span>{countedItems.length} of {takeItems.length} counted</span>
                        <span>{Math.round((countedItems.length / takeItems.length) * 100)}%</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-yellow-400 rounded-full transition-all"
                          style={{ width: `${(countedItems.length / takeItems.length) * 100}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Summary stats for approved/pending */}
                {selectedTake.status !== 'in_progress' && (
                  <div className="grid grid-cols-3 gap-px bg-gray-100 border-b border-gray-100">
                    <div className="bg-white px-4 py-3 text-center">
                      <p className="text-lg font-bold text-gray-900">{takeItems.length}</p>
                      <p className="text-xs text-gray-500">Total items</p>
                    </div>
                    <div className="bg-white px-4 py-3 text-center">
                      <p className="text-lg font-bold text-green-600">{countedItems.length}</p>
                      <p className="text-xs text-gray-500">Counted</p>
                    </div>
                    <div className="bg-white px-4 py-3 text-center">
                      <p className={`text-lg font-bold ${variantItems.length > 0 ? 'text-red-500' : 'text-green-600'}`}>{variantItems.length}</p>
                      <p className="text-xs text-gray-500">Variances</p>
                    </div>
                  </div>
                )}

                {/* Items list */}
                <div className="divide-y divide-gray-50 max-h-96 overflow-y-auto">
                  {takeItems.length === 0 ? (
                    <div className="text-center py-8">
                      <p className="text-gray-400 text-sm">Loading items...</p>
                    </div>
                  ) : (
                    takeItems.map(line => {
                      const hasVariance = line.counted_qty !== null && line.variance_qty !== 0
                      const countKey = `${selectedTake.id}-${line.item_id}`
                      return (
                        <div key={line.id} className={`px-5 py-3 flex items-center gap-4 ${hasVariance ? 'bg-red-50' : ''}`}>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">{line.items?.name}</p>
                            <p className="text-xs text-gray-400">
                              System: {line.system_qty} {line.items?.units?.abbreviation}
                            </p>
                          </div>

                          {selectedTake.status === 'in_progress' ? (
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                min="0"
                                step="0.1"
                                defaultValue={line.counted_qty ?? ''}
                                placeholder="Count"
                                onBlur={e => saveCount(selectedTake.id, line.item_id, e.target.value)}
                                className="w-24 border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-yellow-400"
                              />
                              <span className="text-xs text-gray-400 w-6">{line.items?.units?.abbreviation}</span>
                            </div>
                          ) : (
                            <div className="text-right">
                              <p className="text-sm font-medium text-gray-900">
                                {line.counted_qty ?? '—'} {line.items?.units?.abbreviation}
                              </p>
                              {line.counted_qty !== null && (
                                <p className={`text-xs font-medium ${line.variance_qty > 0 ? 'text-green-600' : line.variance_qty < 0 ? 'text-red-500' : 'text-gray-400'}`}>
                                  {line.variance_qty > 0 ? '+' : ''}{line.variance_qty} variance
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>

                {/* Action buttons */}
                <div className="px-5 py-4 border-t border-gray-100 space-y-2">
                  {selectedTake.status === 'in_progress' && (
                    <button
                      onClick={() => submitForApproval(selectedTake)}
                      disabled={countedItems.length === 0}
                      className="w-full bg-yellow-400 text-gray-900 text-sm font-bold py-2.5 rounded-lg hover:bg-yellow-300 disabled:opacity-40 transition-colors"
                    >
                      Submit for approval ({countedItems.length}/{takeItems.length} counted)
                    </button>
                  )}
                  {selectedTake.status === 'pending_approval' && (
                    <div className="flex gap-3">
                      <button
                        onClick={() => rejectTake(selectedTake)}
                        className="flex-1 border border-red-200 text-red-600 text-sm font-medium py-2.5 rounded-lg hover:bg-red-50"
                      >
                        Reject
                      </button>
                      <button
                        onClick={() => approveTake(selectedTake)}
                        disabled={approving}
                        className="flex-1 bg-green-500 text-white text-sm font-bold py-2.5 rounded-lg hover:bg-green-600 disabled:opacity-50"
                      >
                        {approving ? 'Applying...' : 'Approve & update inventory'}
                      </button>
                    </div>
                  )}
                  {selectedTake.status === 'approved' && (
                    <div className="bg-green-50 text-green-700 text-sm text-center py-2.5 rounded-lg font-medium">
                      Inventory updated successfully
                    </div>
                  )}
                  {selectedTake.status === 'rejected' && (
                    <div className="bg-red-50 text-red-600 text-sm text-center py-2.5 rounded-lg font-medium">
                      Stock take rejected
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-xl p-12 text-center shadow-sm border border-gray-100">
                <div className="text-4xl mb-3">📋</div>
                <p className="text-gray-400 text-sm">Select a stock take to view and count items</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* New Stock Take Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
            <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-bold text-gray-900">New stock take</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Location</label>
                <select
                  value={form.location_id}
                  onChange={e => setForm({ ...form, location_id: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                >
                  <option value="">Select location...</option>
                  {locations.map(l => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Notes (optional)</label>
                <textarea
                  value={form.notes}
                  onChange={e => setForm({ ...form, notes: e.target.value })}
                  placeholder="e.g. Weekly stock take, end of day count..."
                  rows={3}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 resize-none"
                />
              </div>
              <div className="bg-blue-50 text-blue-700 text-xs px-4 py-3 rounded-lg">
                All active items will be pre-loaded with current system quantities. Enter your physical counts and submit for approval.
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex gap-3">
              <button
                onClick={() => setShowForm(false)}
                className="flex-1 border border-gray-200 text-gray-600 text-sm font-medium py-2.5 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={startStockTake}
                disabled={saving}
                className="flex-1 bg-yellow-400 text-gray-900 text-sm font-bold py-2.5 rounded-lg hover:bg-yellow-300 disabled:opacity-50"
              >
                {saving ? 'Creating...' : 'Start stock take'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}