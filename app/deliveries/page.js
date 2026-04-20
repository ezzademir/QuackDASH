'use client'

import { useEffect, useState } from 'react'
import { createClient } from '../../lib/supabase'
import { activeOnly } from '../../lib/db'
import { logAudit, getCurrentUserEmail } from '../../lib/audit'
import Link from 'next/link'

export default function DeliveriesPage() {
  const supabase = createClient()
  const [deliveries, setDeliveries] = useState([])
  const [locations, setLocations] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [showSupplierForm, setShowSupplierForm] = useState(false)
  const [selectedDO, setSelectedDO] = useState(null)
  const [doLineItems, setDoLineItems] = useState([])
  const [filterStatus, setFilterStatus] = useState('all')
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    do_number: '', location_id: '', supplier_id: '',
    expected_date: '', notes: ''
  })
  const [lineItems, setLineItems] = useState([{ item_id: '', expected_qty: '', unit_price: '' }])
  const [supplierForm, setSupplierForm] = useState({ name: '', contact_name: '', phone: '', email: '' })
  const [invoiceFile, setInvoiceFile] = useState(null)
  const [uploadingInvoice, setUploadingInvoice] = useState(false)

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const [del, loc, sup, itm] = await Promise.all([
      supabase
        .from('delivery_orders')
        .select('*, locations(name), suppliers(name)')
        .order('created_at', { ascending: false }),
      activeOnly(supabase, 'locations', q => q.select('*').order('name')),
      activeOnly(supabase, 'suppliers', q => q.select('*').order('name')),
      supabase.from('items').select('*, units(abbreviation)').eq('is_active', true).order('name'),
    ])
    if (del.data) setDeliveries(del.data)
    if (loc.data) setLocations(loc.data)
    if (sup.data) setSuppliers(sup.data)
    if (itm.data) setItems(itm.data)
    setLoading(false)
  }

  async function openDO(delivery) {
    setSelectedDO(delivery)
    setInvoiceFile(null)
    const { data } = await supabase
      .from('do_line_items')
      .select('*, items(name, units(abbreviation))')
      .eq('do_id', delivery.id)
    setDoLineItems(data || [])
  }

  async function createDO() {
    if (!form.do_number.trim()) return alert('DO number is required')
    if (!form.location_id) return alert('Select a location')
    const validLines = lineItems.filter(l => l.item_id && l.expected_qty > 0)
    if (validLines.length === 0) return alert('Add at least one item')
    setSaving(true)

    const { data: doData, error } = await supabase
      .from('delivery_orders')
      .insert({
        do_number: form.do_number.trim(),
        location_id: form.location_id,
        supplier_id: form.supplier_id || null,
        expected_date: form.expected_date || null,
        notes: form.notes,
        status: 'pending',
      })
      .select()
      .single()

    if (error) {
      alert(error.message.includes('unique') ? 'DO number already exists' : 'Error creating DO')
      setSaving(false)
      return
    }

    await supabase.from('do_line_items').insert(
      validLines.map(l => ({
        do_id: doData.id,
        item_id: l.item_id,
        expected_qty: parseFloat(l.expected_qty),
        unit_price: parseFloat(l.unit_price) || null,
      }))
    )

    const by = await getCurrentUserEmail(supabase)
    const locName = locations.find(l => l.id === form.location_id)?.name
    const supName = suppliers.find(s => s.id === form.supplier_id)?.name
    await logAudit(supabase, {
      table: 'delivery_orders', recordId: doData.id, action: 'create', performedBy: by,
      summary: `Created delivery order ${form.do_number} for ${locName}${supName ? ' from ' + supName : ''}`,
      newData: { do_number: form.do_number, location: locName, supplier: supName, items: validLines.length },
    })

    setSaving(false)
    setShowForm(false)
    setForm({ do_number: '', location_id: '', supplier_id: '', expected_date: '', notes: '' })
    setLineItems([{ item_id: '', expected_qty: '', unit_price: '' }])
    fetchAll()
  }

  async function receiveItem(lineId, value) {
    const qty = parseFloat(value)
    if (isNaN(qty)) return
    await supabase
      .from('do_line_items')
      .update({ received_qty: qty })
      .eq('id', lineId)
    const { data } = await supabase
      .from('do_line_items')
      .select('*, items(name, units(abbreviation))')
      .eq('do_id', selectedDO.id)
    setDoLineItems(data || [])
  }

  async function confirmReceipt(delivery) {
    // Update inventory for all received items
    for (const line of doLineItems) {
      if (line.received_qty === null) continue
      const { data: existing } = await supabase
        .from('inventory_levels')
        .select('*')
        .eq('location_id', delivery.location_id)
        .eq('item_id', line.item_id)
        .single()

      if (existing) {
        await supabase
          .from('inventory_levels')
          .update({ quantity: existing.quantity + line.received_qty })
          .eq('id', existing.id)
      } else {
        await supabase
          .from('inventory_levels')
          .insert({
            location_id: delivery.location_id,
            item_id: line.item_id,
            quantity: line.received_qty,
          })
      }

      // Record price history if unit price exists
      if (line.unit_price && delivery.supplier_id) {
        await supabase.from('price_history').insert({
          item_id: line.item_id,
          supplier_id: delivery.supplier_id,
          unit_price: line.unit_price,
        })
      }
    }

    // Check if any variances
    const hasVariance = doLineItems.some(l => l.variance_qty !== 0 && l.received_qty !== null)
    await supabase
      .from('delivery_orders')
      .update({
        status: hasVariance ? 'partial' : 'received',
        received_date: new Date().toISOString().split('T')[0],
      })
      .eq('id', delivery.id)

    const by = await getCurrentUserEmail(supabase)
    await logAudit(supabase, {
      table: 'delivery_orders', recordId: delivery.id, action: 'update', performedBy: by,
      summary: `Confirmed receipt of ${delivery.do_number}${hasVariance ? ' (with variances)' : ''}`,
      oldData: { status: 'pending' },
      newData: { status: hasVariance ? 'partial' : 'received', variances: hasVariance },
    })
    setSelectedDO({ ...delivery, status: hasVariance ? 'partial' : 'received' })
    fetchAll()
  }

  async function uploadInvoice(delivery) {
    if (!invoiceFile) return alert('Select an invoice file first')
    setUploadingInvoice(true)

    const fileExt = invoiceFile.name.split('.').pop()
    const fileName = `invoices/${delivery.id}-${Date.now()}.${fileExt}`

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('invoices')
      .upload(fileName, invoiceFile)

    if (uploadError) {
      alert('Upload failed — make sure the invoices bucket exists in Supabase Storage')
      setUploadingInvoice(false)
      return
    }

    const { data: { publicUrl } } = supabase.storage
      .from('invoices')
      .getPublicUrl(fileName)

    await supabase.from('invoices').insert({
      invoice_number: `INV-${delivery.do_number}`,
      do_id: delivery.id,
      supplier_id: delivery.supplier_id,
      photo_url: publicUrl,
      status: 'matched',
    })

    setInvoiceFile(null)
    setUploadingInvoice(false)
    alert('Invoice uploaded and matched successfully')
  }

  async function saveSupplier() {
    if (!supplierForm.name.trim()) return alert('Supplier name is required')
    const { data: newSup } = await supabase.from('suppliers').insert({ ...supplierForm }).select().single()
    const by = await getCurrentUserEmail(supabase)
    await logAudit(supabase, {
      table: 'suppliers', recordId: newSup?.id, action: 'create', performedBy: by,
      summary: `Added supplier "${supplierForm.name}"`,
      newData: supplierForm,
    })
    setShowSupplierForm(false)
    setSupplierForm({ name: '', contact_name: '', phone: '', email: '' })
    fetchAll()
  }

  function addLineItem() {
    setLineItems([...lineItems, { item_id: '', expected_qty: '', unit_price: '' }])
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
    ? deliveries
    : deliveries.filter(d => d.status === filterStatus)

  const statusColor = {
    pending:  'bg-amber-100 text-amber-800',
    partial:  'bg-orange-100 text-orange-800',
    received: 'bg-green-100 text-green-800',
    disputed: 'bg-red-100 text-red-800',
  }

  const receivedItems = doLineItems.filter(l => l.received_qty !== null)
  const varianceItems = doLineItems.filter(l => l.variance_qty !== 0 && l.received_qty !== null)

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Header */}
      <header className="bg-gray-900 text-white px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="w-8 h-8 bg-yellow-400 rounded-full flex items-center justify-center text-gray-900 font-bold text-sm">Q</Link>
          <div>
            <h1 className="font-bold text-lg leading-none">Deliveries</h1>
            <p className="text-gray-400 text-xs">Delivery orders &amp; invoices</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowSupplierForm(true)}
            className="border border-gray-600 text-gray-300 text-sm px-3 py-2 rounded-lg hover:bg-gray-800 transition-colors"
          >
            + Supplier
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="bg-yellow-400 text-gray-900 text-sm font-bold px-4 py-2 rounded-lg hover:bg-yellow-300 transition-colors"
          >
            + New DO
          </button>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6">

        {/* Status filter */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {['all', 'pending', 'partial', 'received', 'disputed'].map(s => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors capitalize ${filterStatus === s ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}
            >
              {s}
              {s !== 'all' && (
                <span className="ml-1.5 opacity-60">
                  {deliveries.filter(d => d.status === s).length}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

          {/* DO List */}
          <div className="lg:col-span-2 space-y-3">
            {loading ? (
              <div className="bg-white rounded-xl p-12 text-center shadow-sm border border-gray-100">
                <div className="w-8 h-8 border-4 border-yellow-400 border-t-transparent rounded-full animate-spin mx-auto mb-3"/>
              </div>
            ) : filtered.length === 0 ? (
              <div className="bg-white rounded-xl p-12 text-center shadow-sm border border-gray-100">
                <div className="text-4xl mb-3">🚛</div>
                <p className="text-gray-500 text-sm font-medium">No delivery orders yet</p>
                <p className="text-gray-400 text-xs mt-1">Create a DO when stock arrives</p>
                <button onClick={() => setShowForm(true)} className="mt-4 bg-yellow-400 text-gray-900 text-sm font-bold px-4 py-2 rounded-lg hover:bg-yellow-300">
                  + New DO
                </button>
              </div>
            ) : (
              filtered.map(d => (
                <div
                  key={d.id}
                  onClick={() => openDO(d)}
                  className={`bg-white rounded-xl p-4 shadow-sm border cursor-pointer transition-all hover:shadow-md ${selectedDO?.id === d.id ? 'border-yellow-400' : 'border-gray-100'}`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-xs font-mono font-bold text-gray-700">{d.do_number}</p>
                      <p className="text-sm text-gray-600 mt-0.5">{d.locations?.name}</p>
                      {d.suppliers?.name && (
                        <p className="text-xs text-gray-400">{d.suppliers.name}</p>
                      )}
                      <p className="text-xs text-gray-400 mt-1">
                        {new Date(d.created_at).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' })}
                        {d.expected_date && ` · Expected ${new Date(d.expected_date).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' })}`}
                      </p>
                    </div>
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${statusColor[d.status]}`}>
                      {d.status}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* DO Detail */}
          <div className="lg:col-span-3">
            {selectedDO ? (
              <div className="bg-white rounded-xl shadow-sm border border-gray-100">
                {/* DO Header */}
                <div className="px-5 py-4 border-b border-gray-100">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-mono font-bold text-gray-900">{selectedDO.do_number}</p>
                      <p className="text-sm text-gray-500">{selectedDO.locations?.name} · {selectedDO.suppliers?.name || 'No supplier'}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${statusColor[selectedDO.status]}`}>
                        {selectedDO.status}
                      </span>
                      <button onClick={() => setSelectedDO(null)} className="text-gray-400 hover:text-gray-600">×</button>
                    </div>
                  </div>

                  {/* Summary */}
                  {receivedItems.length > 0 && (
                    <div className="grid grid-cols-3 gap-3 mt-3">
                      <div className="bg-gray-50 rounded-lg p-2 text-center">
                        <p className="text-sm font-bold text-gray-900">{doLineItems.length}</p>
                        <p className="text-xs text-gray-500">Expected</p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-2 text-center">
                        <p className="text-sm font-bold text-green-600">{receivedItems.length}</p>
                        <p className="text-xs text-gray-500">Received</p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-2 text-center">
                        <p className={`text-sm font-bold ${varianceItems.length > 0 ? 'text-red-500' : 'text-green-600'}`}>
                          {varianceItems.length}
                        </p>
                        <p className="text-xs text-gray-500">Variances</p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Line items */}
                <div className="divide-y divide-gray-50 max-h-72 overflow-y-auto">
                  {doLineItems.map(line => {
                    const hasVariance = line.received_qty !== null && line.variance_qty !== 0
                    return (
                      <div key={line.id} className={`px-5 py-3 flex items-center gap-3 ${hasVariance ? 'bg-red-50' : ''}`}>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{line.items?.name}</p>
                          <p className="text-xs text-gray-400">
                            Expected: {line.expected_qty} {line.items?.units?.abbreviation}
                            {line.unit_price && ` · RM${line.unit_price}/${line.items?.units?.abbreviation}`}
                          </p>
                        </div>

                        {selectedDO.status === 'pending' ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min="0"
                              step="0.1"
                              defaultValue={line.received_qty ?? ''}
                              placeholder="Received"
                              onBlur={e => receiveItem(line.id, e.target.value)}
                              className="w-24 border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-yellow-400"
                            />
                            <span className="text-xs text-gray-400">{line.items?.units?.abbreviation}</span>
                          </div>
                        ) : (
                          <div className="text-right">
                            <p className="text-sm font-medium text-gray-900">
                              {line.received_qty ?? '—'} {line.items?.units?.abbreviation}
                            </p>
                            {line.received_qty !== null && line.variance_qty !== 0 && (
                              <p className={`text-xs font-medium ${line.variance_qty > 0 ? 'text-green-600' : 'text-red-500'}`}>
                                {line.variance_qty > 0 ? '+' : ''}{line.variance_qty} variance
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* Invoice upload + actions */}
                <div className="px-5 py-4 border-t border-gray-100 space-y-3">
                  {/* Invoice upload */}
                  <div>
                    <p className="text-xs font-semibold text-gray-600 mb-2">Invoice</p>
                    <div className="flex gap-2">
                      <input
                        type="file"
                        accept="image/*,.pdf"
                        onChange={e => setInvoiceFile(e.target.files[0])}
                        className="flex-1 text-xs text-gray-500 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200"
                      />
                      <button
                        onClick={() => uploadInvoice(selectedDO)}
                        disabled={!invoiceFile || uploadingInvoice}
                        className="bg-gray-900 text-white text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-gray-700 disabled:opacity-40"
                      >
                        {uploadingInvoice ? 'Uploading...' : 'Upload'}
                      </button>
                    </div>
                  </div>

                  {/* Confirm receipt button */}
                  {selectedDO.status === 'pending' && (
                    <button
                      onClick={() => confirmReceipt(selectedDO)}
                      disabled={receivedItems.length === 0}
                      className="w-full bg-yellow-400 text-gray-900 text-sm font-bold py-2.5 rounded-lg hover:bg-yellow-300 disabled:opacity-40 transition-colors"
                    >
                      Confirm receipt &amp; update inventory
                    </button>
                  )}
                  {(selectedDO.status === 'received' || selectedDO.status === 'partial') && (
                    <div className={`text-sm text-center py-2.5 rounded-lg font-medium ${selectedDO.status === 'received' ? 'bg-green-50 text-green-700' : 'bg-orange-50 text-orange-700'}`}>
                      {selectedDO.status === 'received' ? 'Inventory updated — no variances' : `Received with ${varianceItems.length} variance(s)`}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-xl p-12 text-center shadow-sm border border-gray-100">
                <div className="text-4xl mb-3">🚛</div>
                <p className="text-gray-400 text-sm">Select a delivery order to receive stock</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* New DO Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white">
              <h2 className="font-bold text-gray-900">New delivery order</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">DO number *</label>
                  <input
                    type="text"
                    value={form.do_number}
                    onChange={e => setForm({ ...form, do_number: e.target.value })}
                    placeholder="e.g. DO-2026-001"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Expected date</label>
                  <input
                    type="date"
                    value={form.expected_date}
                    onChange={e => setForm({ ...form, expected_date: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Destination *</label>
                  <select
                    value={form.location_id}
                    onChange={e => setForm({ ...form, location_id: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                  >
                    <option value="">Select...</option>
                    {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Supplier</label>
                  <select
                    value={form.supplier_id}
                    onChange={e => setForm({ ...form, supplier_id: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                  >
                    <option value="">Select...</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>

              {/* Line items */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-gray-600">Items expected</label>
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
                        value={line.expected_qty}
                        onChange={e => updateLineItem(i, 'expected_qty', e.target.value)}
                        placeholder="Qty"
                        min="0"
                        className="w-20 border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                      />
                      <input
                        type="number"
                        value={line.unit_price}
                        onChange={e => updateLineItem(i, 'unit_price', e.target.value)}
                        placeholder="RM"
                        min="0"
                        step="0.01"
                        className="w-20 border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                      />
                      {lineItems.length > 1 && (
                        <button onClick={() => removeLineItem(i)} className="text-gray-400 hover:text-red-500 text-lg leading-none">×</button>
                      )}
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-1">Qty · Unit price (RM) — price used for price history tracking</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Notes (optional)</label>
                <textarea
                  value={form.notes}
                  onChange={e => setForm({ ...form, notes: e.target.value })}
                  placeholder="Any delivery notes..."
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
                onClick={createDO}
                disabled={saving}
                className="flex-1 bg-yellow-400 text-gray-900 text-sm font-bold py-2.5 rounded-lg hover:bg-yellow-300 disabled:opacity-50"
              >
                {saving ? 'Creating...' : 'Create DO'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Supplier Modal */}
      {showSupplierForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
            <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-bold text-gray-900">Add supplier</h2>
              <button onClick={() => setShowSupplierForm(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Supplier name *</label>
                <input
                  type="text"
                  value={supplierForm.name}
                  onChange={e => setSupplierForm({ ...supplierForm, name: e.target.value })}
                  placeholder="e.g. KL Fresh Produce Sdn Bhd"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Contact name</label>
                  <input
                    type="text"
                    value={supplierForm.contact_name}
                    onChange={e => setSupplierForm({ ...supplierForm, contact_name: e.target.value })}
                    placeholder="Name"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Phone</label>
                  <input
                    type="text"
                    value={supplierForm.phone}
                    onChange={e => setSupplierForm({ ...supplierForm, phone: e.target.value })}
                    placeholder="+60 12 345 6789"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Email</label>
                <input
                  type="email"
                  value={supplierForm.email}
                  onChange={e => setSupplierForm({ ...supplierForm, email: e.target.value })}
                  placeholder="supplier@email.com"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex gap-3">
              <button
                onClick={() => setShowSupplierForm(false)}
                className="flex-1 border border-gray-200 text-gray-600 text-sm font-medium py-2.5 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={saveSupplier}
                className="flex-1 bg-yellow-400 text-gray-900 text-sm font-bold py-2.5 rounded-lg hover:bg-yellow-300"
              >
                Save supplier
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}