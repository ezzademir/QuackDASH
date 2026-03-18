'use client'

import { useEffect, useState } from 'react'
import { createClient } from '../../lib/supabase'
import Link from 'next/link'

export default function TransfersPage() {
  const supabase = createClient()
  const [transfers, setTransfers] = useState([])
  const [locations, setLocations] = useState([])
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [selectedTransfer, setSelectedTransfer] = useState(null)
  const [transferItems, setTransferItems] = useState([])
  const [filterStatus, setFilterStatus] = useState('all')
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    from_location_id: '',
    to_location_id: '',
    notes: '',
  })
  const [lineItems, setLineItems] = useState([
    { item_id: '', requested_qty: '' }
  ])

  useEffect(() => {
    fetchAll()
    subscribeToTransfers()
  }, [])

  async function fetchAll() {
    setLoading(true)
    const [trx, loc, itm] = await Promise.all([
      supabase
        .from('stock_transfers')
        .select('*, from_location:locations!stock_transfers_from_location_id_fkey(name), to_location:locations!stock_transfers_to_location_id_fkey(name)')
        .order('requested_at', { ascending: false }),
      supabase.from('locations').select('*').order('type'),
      supabase.from('items').select('*, units(abbreviation)').eq('is_active', true).order('name'),
    ])
    if (trx.data) setTransfers(trx.data)
    if (loc.data) setLocations(loc.data)
    if (itm.data) setItems(itm.data)
    setLoading(false)
  }

  function subscribeToTransfers() {
    const channel = supabase
      .channel('transfers-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_transfers' }, () => fetchAll())
      .subscribe()
    return () => supabase.removeChannel(channel)
  }

  async function openTransfer(transfer) {
    setSelectedTransfer(transfer)
    const { data } = await supabase
      .from('transfer_line_items')
      .select('*, items(name, units(abbreviation))')
      .eq('transfer_id', transfer.id)
    setTransferItems(data || [])
  }

  async function createTransfer() {
    if (!form.from_location_id || !form.to_location_id) return alert('Select both locations')
    if (form.from_location_id === form.to_location_id) return alert('From and To cannot be the same location')
    const validLines = lineItems.filter(l => l.item_id && l.requested_qty > 0)
    if (validLines.length === 0) return alert('Add at least one item')
    setSaving(true)

    const { data: transfer, error } = await supabase
      .from('stock_transfers')
      .insert({
        from_location_id: form.from_location_id,
        to_location_id: form.to_location_id,
        notes: form.notes,
        status: 'requested',
      })
      .select()
      .single()

    if (error) { alert('Error creating transfer'); setSaving(false); return }

    await supabase.from('transfer_line_items').insert(
      validLines.map(l => ({
        transfer_id: transfer.id,
        item_id: l.item_id,
        requested_qty: parseFloat(l.requested_qty),
      }))
    )

    setSaving(false)
    setShowForm(false)
    setForm({ from_location_id: '', to_location_id: '', notes: '' })
    setLineItems([{ item_id: '', requested_qty: '' }])
    fetchAll()
  }

  async function updateStatus(transfer, newStatus) {
    const updates = { status: newStatus }
    if (newStatus === 'approved') updates.approved_at = new Date().toISOString()
    if (newStatus === 'received') {
      updates.received_at = new Date().toISOString()
      // Update inventory levels on receipt
      const { data: lines } = await supabase
        .from('transfer_line_items')
        .select('*')
        .eq('transfer_id', transfer.id)

      for (const line of lines || []) {
        const qty = line.sent_qty || line.requested_qty

        // Deduct from source
        const { data: fromInv } = await supabase
          .from('inventory_levels')
          .select('*')
          .eq('location_id', transfer.from_location_id)
          .eq('item_id', line.item_id)
          .single()

        if (fromInv) {
          await supabase.from('inventory_levels')
            .update({ quantity: Math.max(0, fromInv.quantity - qty) })
            .eq('id', fromInv.id)
        }

        // Add to destination
        const { data: toInv } = await supabase
          .from('inventory_levels')
          .select('*')
          .eq('location_id', transfer.to_location_id)
          .eq('item_id', line.item_id)
          .single()

        if (toInv) {
          await supabase.from('inventory_levels')
            .update({ quantity: toInv.quantity + qty })
            .eq('id', toInv.id)
        } else {
          await supabase.from('inventory_levels')
            .insert({ location_id: transfer.to_location_id, item_id: line.item_id, quantity: qty })
        }
      }
    }
    await supabase.from('stock_transfers').update(updates).eq('id', transfer.id)
    setSelectedTransfer({ ...transfer, status: newStatus })
    fetchAll()
  }

  function addLineItem() {
    setLineItems([...lineItems, { item_id: '', requested_qty: '' }])
  }

  function removeLineItem(index) {
    setLineItems(lineItems.filter((_, i) => i !== index))
  }

  function updateLineItem(index, field, value) {
    const updated = [...lineItems]
    updated[index][field] = value
    setLineItems(updated)
  }

  const filtered = filterStatus === 'all'
    ? transfers
    : transfers.filter(t => t.status === filterStatus)

  const statusColor = {
    requested:  'bg-amber-100 text-amber-800',
    approved:   'bg-blue-100 text-blue-800',
    in_transit: 'bg-purple-100 text-purple-800',
    received:   'bg-green-100 text-green-800',
    cancelled:  'bg-gray-100 text-gray-600',
  }

  const nextStatus = {
    requested:  { label: 'Approve', status: 'approved' },
    approved:   { label: 'Mark in transit', status: 'in_transit' },
    in_transit: { label: 'Confirm received', status: 'received' },
  }

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Header */}
      <header className="bg-gray-900 text-white px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="w-8 h-8 bg-yellow-400 rounded-full flex items-center justify-center text-gray-900 font-bold text-sm">Q</Link>
          <div>
            <h1 className="font-bold text-lg leading-none">Transfers</h1>
            <p className="text-gray-400 text-xs">Stock movement between locations</p>
          </div>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="bg-yellow-400 text-gray-900 text-sm font-bold px-4 py-2 rounded-lg hover:bg-yellow-300 transition-colors"
        >
          + New transfer
        </button>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6">

        {/* Status filter */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {['all', 'requested', 'approved', 'in_transit', 'received', 'cancelled'].map(s => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors capitalize ${filterStatus === s ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}
            >
              {s.replace('_', ' ')}
              {s !== 'all' && (
                <span className="ml-1.5 bg-white/20 px-1.5 py-0.5 rounded-full text-xs">
                  {transfers.filter(t => t.status === s).length}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Transfers list */}
          <div className="lg:col-span-2 space-y-3">
            {loading ? (
              <div className="bg-white rounded-xl p-12 text-center shadow-sm border border-gray-100">
                <div className="w-8 h-8 border-4 border-yellow-400 border-t-transparent rounded-full animate-spin mx-auto mb-3"/>
                <p className="text-gray-400 text-sm">Loading transfers...</p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="bg-white rounded-xl p-12 text-center shadow-sm border border-gray-100">
                <div className="text-4xl mb-3">🚚</div>
                <p className="text-gray-500 text-sm font-medium">No transfers yet</p>
                <p className="text-gray-400 text-xs mt-1">Create your first stock transfer to get started</p>
                <button onClick={() => setShowForm(true)} className="mt-4 bg-yellow-400 text-gray-900 text-sm font-bold px-4 py-2 rounded-lg hover:bg-yellow-300">
                  + New transfer
                </button>
              </div>
            ) : (
              filtered.map(t => (
                <div
                  key={t.id}
                  onClick={() => openTransfer(t)}
                  className={`bg-white rounded-xl p-4 shadow-sm border cursor-pointer transition-all hover:shadow-md ${selectedTransfer?.id === t.id ? 'border-yellow-400' : 'border-gray-100'}`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-xs font-mono text-gray-400">{t.transfer_number}</p>
                      <p className="text-sm font-semibold text-gray-900 mt-0.5">
                        {t.from_location?.name} → {t.to_location?.name}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        {new Date(t.requested_at).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${statusColor[t.status]}`}>
                      {t.status.replace('_', ' ')}
                    </span>
                  </div>
                  {t.notes && <p className="text-xs text-gray-500 mt-2 bg-gray-50 px-3 py-2 rounded-lg">{t.notes}</p>}
                </div>
              ))
            )}
          </div>

          {/* Transfer detail panel */}
          <div>
            {selectedTransfer ? (
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 sticky top-4">
                <div className="px-5 py-4 border-b border-gray-100">
                  <div className="flex items-center justify-between">
                    <h2 className="font-semibold text-gray-900">Transfer detail</h2>
                    <button onClick={() => setSelectedTransfer(null)} className="text-gray-400 hover:text-gray-600">×</button>
                  </div>
                  <p className="text-xs font-mono text-gray-400 mt-1">{selectedTransfer.transfer_number}</p>
                </div>
                <div className="p-5 space-y-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">From</span>
                    <span className="font-medium">{selectedTransfer.from_location?.name}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">To</span>
                    <span className="font-medium">{selectedTransfer.to_location?.name}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Status</span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusColor[selectedTransfer.status]}`}>
                      {selectedTransfer.status.replace('_', ' ')}
                    </span>
                  </div>

                  {/* Line items */}
                  <div className="border-t border-gray-100 pt-4">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Items</p>
                    <div className="space-y-2">
                      {transferItems.map(line => (
                        <div key={line.id} className="flex justify-between items-center text-sm bg-gray-50 px-3 py-2 rounded-lg">
                          <span className="text-gray-700">{line.items?.name}</span>
                          <span className="font-medium text-gray-900">
                            {line.sent_qty || line.requested_qty} {line.items?.units?.abbreviation}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Action button */}
                  {nextStatus[selectedTransfer.status] && (
                    <button
                      onClick={() => updateStatus(selectedTransfer, nextStatus[selectedTransfer.status].status)}
                      className="w-full bg-yellow-400 text-gray-900 text-sm font-bold py-2.5 rounded-lg hover:bg-yellow-300 transition-colors"
                    >
                      {nextStatus[selectedTransfer.status].label}
                    </button>
                  )}
                  {selectedTransfer.status === 'requested' && (
                    <button
                      onClick={() => updateStatus(selectedTransfer, 'cancelled')}
                      className="w-full border border-gray-200 text-gray-500 text-sm py-2 rounded-lg hover:bg-gray-50"
                    >
                      Cancel transfer
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-xl p-8 text-center shadow-sm border border-gray-100">
                <p className="text-gray-400 text-sm">Select a transfer to see details</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* New Transfer Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white">
              <h2 className="font-bold text-gray-900">New stock transfer</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">From location</label>
                  <select
                    value={form.from_location_id}
                    onChange={e => setForm({ ...form, from_location_id: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                  >
                    <option value="">Select...</option>
                    {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">To location</label>
                  <select
                    value={form.to_location_id}
                    onChange={e => setForm({ ...form, to_location_id: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                  >
                    <option value="">Select...</option>
                    {locations.filter(l => l.id !== form.from_location_id).map(l => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Line items */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-gray-600">Items to transfer</label>
                  <button onClick={addLineItem} className="text-xs text-yellow-600 font-medium hover:underline">+ Add row</button>
                </div>
                <div className="space-y-2">
                  {lineItems.map((line, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <select
                        value={line.item_id}
                        onChange={e => updateLineItem(i, 'item_id', e.target.value)}
                        className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                      >
                        <option value="">Select item...</option>
                        {items.map(item => (
                          <option key={item.id} value={item.id}>{item.name} ({item.units?.abbreviation})</option>
                        ))}
                      </select>
                      <input
                        type="number"
                        value={line.requested_qty}
                        onChange={e => updateLineItem(i, 'requested_qty', e.target.value)}
                        placeholder="Qty"
                        min="0"
                        className="w-20 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                      />
                      {lineItems.length > 1 && (
                        <button onClick={() => removeLineItem(i)} className="text-gray-400 hover:text-red-500 text-lg leading-none">×</button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Notes (optional)</label>
                <textarea
                  value={form.notes}
                  onChange={e => setForm({ ...form, notes: e.target.value })}
                  placeholder="Any special instructions..."
                  rows={2}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 resize-none"
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex gap-3 sticky bottom-0 bg-white">
              <button
                onClick={() => setShowForm(false)}
                className="flex-1 border border-gray-200 text-gray-600 text-sm font-medium py-2.5 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={createTransfer}
                disabled={saving}
                className="flex-1 bg-yellow-400 text-gray-900 text-sm font-bold py-2.5 rounded-lg hover:bg-yellow-300 disabled:opacity-50"
              >
                {saving ? 'Creating...' : 'Create transfer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}