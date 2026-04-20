'use client'

import { useEffect, useState } from 'react'
import { createClient } from '../../lib/supabase'
import { activeOnly } from '../../lib/db'
import Link from 'next/link'

export default function ReportsPage() {
  const supabase = createClient()
  const [activeReport, setActiveReport] = useState('stock_value')
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState([])
  const [filterLocation, setFilterLocation] = useState('all')
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 30)
    return d.toISOString().split('T')[0]
  })
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split('T')[0])

  useEffect(() => { fetchLocations() }, [])
  useEffect(() => { fetchReport() }, [activeReport, filterLocation, dateFrom, dateTo])

  async function fetchLocations() {
    const { data } = await activeOnly(supabase, 'locations', q => q.select('*').order('name'))
    if (data) setLocations(data)
  }

  async function fetchReport() {
    setLoading(true)
    setData([])

    if (activeReport === 'stock_value') await fetchStockValue()
    if (activeReport === 'transfer_history') await fetchTransferHistory()
    if (activeReport === 'variance') await fetchVariance()
    if (activeReport === 'delivery') await fetchDelivery()
    if (activeReport === 'low_stock') await fetchLowStock()

    setLoading(false)
  }

  async function fetchStockValue() {
    let query = supabase
      .from('inventory_levels')
      .select('*, items!inner(name, reorder_level, is_active, deleted_at, categories(name), units(abbreviation)), locations(name)')
      .eq('items.is_active', true)
      .is('items.deleted_at', null)
      .order('quantity', { ascending: false })
    if (filterLocation !== 'all') query = query.eq('location_id', filterLocation)
    const { data } = await query
    setData(data || [])
  }

  async function fetchTransferHistory() {
    let query = supabase
      .from('stock_transfers')
      .select('*, from_location:locations!stock_transfers_from_location_id_fkey(name), to_location:locations!stock_transfers_to_location_id_fkey(name)')
      .gte('requested_at', dateFrom)
      .lte('requested_at', dateTo + 'T23:59:59')
      .order('requested_at', { ascending: false })
    if (filterLocation !== 'all') {
      query = query.or(`from_location_id.eq.${filterLocation},to_location_id.eq.${filterLocation}`)
    }
    const { data } = await query
    setData(data || [])
  }

  async function fetchVariance() {
    let query = supabase
      .from('stock_takes')
      .select('*, locations(name), stock_take_items(*, items(name, units(abbreviation)))')
      .eq('status', 'approved')
      .gte('started_at', dateFrom)
      .lte('started_at', dateTo + 'T23:59:59')
      .order('started_at', { ascending: false })
    if (filterLocation !== 'all') query = query.eq('location_id', filterLocation)
    const { data } = await query

    // Flatten to individual variance lines
    const rows = []
    for (const take of data || []) {
      for (const item of take.stock_take_items || []) {
        if (item.variance_qty !== 0 && item.counted_qty !== null) {
          rows.push({
            id: item.id,
            location: take.locations?.name,
            date: take.started_at,
            item_name: item.items?.name,
            system_qty: item.system_qty,
            counted_qty: item.counted_qty,
            variance_qty: item.variance_qty,
            unit: item.items?.units?.abbreviation,
          })
        }
      }
    }
    setData(rows)
  }

  async function fetchDelivery() {
    let query = supabase
      .from('delivery_orders')
      .select('*, locations(name), suppliers(name), do_line_items(*, items(name, units(abbreviation)))')
      .gte('created_at', dateFrom)
      .lte('created_at', dateTo + 'T23:59:59')
      .order('created_at', { ascending: false })
    if (filterLocation !== 'all') query = query.eq('location_id', filterLocation)
    const { data } = await query
    setData(data || [])
  }

  async function fetchLowStock() {
    let query = supabase
      .from('inventory_levels')
      .select('*, items!inner(name, reorder_level, is_active, deleted_at, categories(name), units(abbreviation)), locations(name)')
      .eq('items.is_active', true)
      .is('items.deleted_at', null)
    if (filterLocation !== 'all') query = query.eq('location_id', filterLocation)
    const { data } = await query
    const low = (data || []).filter(i => i.quantity <= (i.items?.reorder_level || 0))
    low.sort((a, b) => a.quantity - b.quantity)
    setData(low)
  }

  function exportCSV() {
    if (data.length === 0) return alert('No data to export')
    let csv = ''
    let rows = []

    if (activeReport === 'stock_value') {
      csv = 'Location,Item,Category,Quantity,Unit,Reorder Level\n'
      rows = data.map(d => [
        d.locations?.name, d.items?.name, d.items?.categories?.name,
        d.quantity, d.items?.units?.abbreviation, d.items?.reorder_level
      ])
    }
    if (activeReport === 'transfer_history') {
      csv = 'Transfer No,From,To,Status,Date\n'
      rows = data.map(d => [
        d.transfer_number, d.from_location?.name, d.to_location?.name,
        d.status, new Date(d.requested_at).toLocaleDateString('en-MY')
      ])
    }
    if (activeReport === 'variance') {
      csv = 'Date,Location,Item,System Qty,Counted Qty,Variance,Unit\n'
      rows = data.map(d => [
        new Date(d.date).toLocaleDateString('en-MY'),
        d.location, d.item_name, d.system_qty, d.counted_qty, d.variance_qty, d.unit
      ])
    }
    if (activeReport === 'delivery') {
      csv = 'DO Number,Location,Supplier,Status,Date\n'
      rows = data.map(d => [
        d.do_number, d.locations?.name, d.suppliers?.name,
        d.status, new Date(d.created_at).toLocaleDateString('en-MY')
      ])
    }
    if (activeReport === 'low_stock') {
      csv = 'Location,Item,Category,Current Qty,Reorder Level,Unit,Shortfall\n'
      rows = data.map(d => [
        d.locations?.name, d.items?.name, d.items?.categories?.name,
        d.quantity, d.items?.reorder_level, d.items?.units?.abbreviation,
        d.items?.reorder_level - d.quantity
      ])
    }

    csv += rows.map(r => r.map(v => `"${v ?? ''}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `quackdash-${activeReport}-${dateTo}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const reports = [
    { id: 'stock_value',       label: 'Stock value',       icon: '📦' },
    { id: 'low_stock',         label: 'Low stock',         icon: '🔴' },
    { id: 'transfer_history',  label: 'Transfer history',  icon: '🚚' },
    { id: 'variance',          label: 'Variance report',   icon: '⚠️' },
    { id: 'delivery',          label: 'Delivery & supplier', icon: '🛒' },
  ]

  const statusColor = {
    pending:  'bg-amber-100 text-amber-800',
    partial:  'bg-orange-100 text-orange-800',
    received: 'bg-green-100 text-green-800',
    disputed: 'bg-red-100 text-red-800',
    requested:  'bg-amber-100 text-amber-800',
    approved:   'bg-blue-100 text-blue-800',
    in_transit: 'bg-purple-100 text-purple-800',
    cancelled:  'bg-gray-100 text-gray-600',
  }

  const showDateFilter = ['transfer_history', 'variance', 'delivery'].includes(activeReport)

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Header */}
      <header className="bg-gray-900 text-white px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="w-8 h-8 bg-yellow-400 rounded-full flex items-center justify-center text-gray-900 font-bold text-sm">Q</Link>
          <div>
            <h1 className="font-bold text-lg leading-none">Reports</h1>
            <p className="text-gray-400 text-xs">Data &amp; analytics</p>
          </div>
        </div>
        <button
          onClick={exportCSV}
          className="bg-yellow-400 text-gray-900 text-sm font-bold px-4 py-2 rounded-lg hover:bg-yellow-300 transition-colors"
        >
          Export CSV
        </button>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">

          {/* Sidebar */}
          <div className="space-y-2">
            {/* Report selector */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-2 mb-2">Reports</p>
              {reports.map(r => (
                <button
                  key={r.id}
                  onClick={() => setActiveReport(r.id)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${activeReport === r.id ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-50'}`}
                >
                  <span className="text-base">{r.icon}</span>
                  {r.label}
                </button>
              ))}
            </div>

            {/* Filters */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 space-y-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Filters</p>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Location</label>
                <select
                  value={filterLocation}
                  onChange={e => setFilterLocation(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                >
                  <option value="all">All locations</option>
                  {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
              {showDateFilter && (
                <>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">From</label>
                    <input
                      type="date"
                      value={dateFrom}
                      onChange={e => setDateFrom(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">To</label>
                    <input
                      type="date"
                      value={dateTo}
                      onChange={e => setDateTo(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                    />
                  </div>
                </>
              )}
            </div>

            {/* Summary card */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Summary</p>
              <p className="text-2xl font-bold text-gray-900">{data.length}</p>
              <p className="text-xs text-gray-500">
                {activeReport === 'stock_value' && 'inventory lines'}
                {activeReport === 'low_stock' && 'items below reorder level'}
                {activeReport === 'transfer_history' && 'transfers'}
                {activeReport === 'variance' && 'variance lines'}
                {activeReport === 'delivery' && 'delivery orders'}
              </p>
            </div>
          </div>

          {/* Report content */}
          <div className="lg:col-span-3 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">

            {/* Report header */}
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg">{reports.find(r => r.id === activeReport)?.icon}</span>
                <h2 className="font-semibold text-gray-900">{reports.find(r => r.id === activeReport)?.label}</h2>
              </div>
              {data.length > 0 && (
                <p className="text-xs text-gray-400">{data.length} records</p>
              )}
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-20">
                <div className="w-8 h-8 border-4 border-yellow-400 border-t-transparent rounded-full animate-spin"/>
              </div>
            ) : data.length === 0 ? (
              <div className="text-center py-20">
                <p className="text-gray-400 text-sm">No data for this report</p>
                <p className="text-gray-300 text-xs mt-1">Try adjusting the filters</p>
              </div>
            ) : (

              <div className="overflow-x-auto">

                {/* Stock value table */}
                {activeReport === 'stock_value' && (
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-100">
                      <tr>
                        <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-5 py-3">Item</th>
                        <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-5 py-3">Category</th>
                        <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-5 py-3">Location</th>
                        <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wide px-5 py-3">Quantity</th>
                        <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wide px-5 py-3">Reorder at</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {data.map(row => {
                        const isLow = row.quantity <= (row.items?.reorder_level || 0)
                        return (
                          <tr key={row.id} className={isLow ? 'bg-red-50' : 'hover:bg-gray-50'}>
                            <td className="px-5 py-3 text-sm font-medium text-gray-900">{row.items?.name}</td>
                            <td className="px-5 py-3"><span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full">{row.items?.categories?.name}</span></td>
                            <td className="px-5 py-3 text-sm text-gray-600">{row.locations?.name}</td>
                            <td className="px-5 py-3 text-right">
                              <span className={`text-sm font-bold ${isLow ? 'text-red-600' : 'text-gray-900'}`}>
                                {row.quantity} {row.items?.units?.abbreviation}
                              </span>
                            </td>
                            <td className="px-5 py-3 text-right text-sm text-gray-500">{row.items?.reorder_level} {row.items?.units?.abbreviation}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}

                {/* Low stock table */}
                {activeReport === 'low_stock' && (
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-100">
                      <tr>
                        <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-5 py-3">Item</th>
                        <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-5 py-3">Location</th>
                        <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wide px-5 py-3">Current</th>
                        <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wide px-5 py-3">Reorder at</th>
                        <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wide px-5 py-3">Shortfall</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {data.map(row => (
                        <tr key={row.id} className="bg-red-50 hover:bg-red-100">
                          <td className="px-5 py-3">
                            <p className="text-sm font-medium text-gray-900">{row.items?.name}</p>
                            <p className="text-xs text-gray-400">{row.items?.categories?.name}</p>
                          </td>
                          <td className="px-5 py-3 text-sm text-gray-600">{row.locations?.name}</td>
                          <td className="px-5 py-3 text-right text-sm font-bold text-red-600">{row.quantity} {row.items?.units?.abbreviation}</td>
                          <td className="px-5 py-3 text-right text-sm text-gray-500">{row.items?.reorder_level} {row.items?.units?.abbreviation}</td>
                          <td className="px-5 py-3 text-right">
                            <span className="text-sm font-bold text-red-700 bg-red-100 px-2 py-1 rounded-lg">
                              -{row.items?.reorder_level - row.quantity} {row.items?.units?.abbreviation}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {/* Transfer history table */}
                {activeReport === 'transfer_history' && (
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-100">
                      <tr>
                        <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-5 py-3">Transfer no.</th>
                        <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-5 py-3">From</th>
                        <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-5 py-3">To</th>
                        <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-5 py-3">Status</th>
                        <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-5 py-3">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {data.map(row => (
                        <tr key={row.id} className="hover:bg-gray-50">
                          <td className="px-5 py-3 text-xs font-mono text-gray-600">{row.transfer_number}</td>
                          <td className="px-5 py-3 text-sm text-gray-900">{row.from_location?.name}</td>
                          <td className="px-5 py-3 text-sm text-gray-900">{row.to_location?.name}</td>
                          <td className="px-5 py-3">
                            <span className={`text-xs font-medium px-2 py-1 rounded-full ${statusColor[row.status]}`}>
                              {row.status.replace('_', ' ')}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-sm text-gray-500">
                            {new Date(row.requested_at).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {/* Variance report table */}
                {activeReport === 'variance' && (
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-100">
                      <tr>
                        <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-5 py-3">Date</th>
                        <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-5 py-3">Location</th>
                        <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-5 py-3">Item</th>
                        <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wide px-5 py-3">System</th>
                        <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wide px-5 py-3">Counted</th>
                        <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wide px-5 py-3">Variance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {data.map(row => (
                        <tr key={row.id} className={`hover:bg-gray-50 ${row.variance_qty < 0 ? 'bg-red-50' : 'bg-green-50'}`}>
                          <td className="px-5 py-3 text-sm text-gray-500">
                            {new Date(row.date).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' })}
                          </td>
                          <td className="px-5 py-3 text-sm text-gray-900">{row.location}</td>
                          <td className="px-5 py-3 text-sm font-medium text-gray-900">{row.item_name}</td>
                          <td className="px-5 py-3 text-right text-sm text-gray-600">{row.system_qty} {row.unit}</td>
                          <td className="px-5 py-3 text-right text-sm text-gray-600">{row.counted_qty} {row.unit}</td>
                          <td className="px-5 py-3 text-right">
                            <span className={`text-sm font-bold ${row.variance_qty > 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {row.variance_qty > 0 ? '+' : ''}{row.variance_qty} {row.unit}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {/* Delivery report table */}
                {activeReport === 'delivery' && (
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-100">
                      <tr>
                        <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-5 py-3">DO number</th>
                        <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-5 py-3">Location</th>
                        <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-5 py-3">Supplier</th>
                        <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-5 py-3">Status</th>
                        <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wide px-5 py-3">Items</th>
                        <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-5 py-3">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {data.map(row => (
                        <tr key={row.id} className="hover:bg-gray-50">
                          <td className="px-5 py-3 text-xs font-mono font-bold text-gray-700">{row.do_number}</td>
                          <td className="px-5 py-3 text-sm text-gray-900">{row.locations?.name}</td>
                          <td className="px-5 py-3 text-sm text-gray-600">{row.suppliers?.name || '—'}</td>
                          <td className="px-5 py-3">
                            <span className={`text-xs font-medium px-2 py-1 rounded-full ${statusColor[row.status]}`}>
                              {row.status}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-right text-sm text-gray-600">{row.do_line_items?.length || 0}</td>
                          <td className="px-5 py-3 text-sm text-gray-500">
                            {new Date(row.created_at).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}