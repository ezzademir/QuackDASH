'use client'

import { useEffect, useState } from 'react'
import { createClient } from '../lib/supabase'
import Link from 'next/link'

export default function Dashboard() {
  const supabase = createClient()
  const [locations, setLocations] = useState([])
  const [inventory, setInventory] = useState([])
  const [items, setItems] = useState([])
  const [transfers, setTransfers] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeLocation, setActiveLocation] = useState('all')

  useEffect(() => {
    fetchAll()
    subscribeToInventory()
  }, [])

  async function fetchAll() {
    setLoading(true)
    const [loc, inv, itm, trx] = await Promise.all([
      supabase.from('locations').select('*').order('type'),
      supabase.from('inventory_levels').select('*, items(name, reorder_level, units(abbreviation)), locations(name)'),
      supabase.from('items').select('*, categories(name), units(abbreviation)'),
      supabase.from('stock_transfers').select('*, from_location:locations!stock_transfers_from_location_id_fkey(name), to_location:locations!stock_transfers_to_location_id_fkey(name)').in('status', ['requested', 'approved', 'in_transit']).order('requested_at', { ascending: false }).limit(5),
    ])
    if (loc.data) setLocations(loc.data)
    if (inv.data) setInventory(inv.data)
    if (itm.data) setItems(itm.data)
    if (trx.data) setTransfers(trx.data)
    setLoading(false)
  }

  function subscribeToInventory() {
    const channel = supabase
      .channel('inventory-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_levels' }, () => fetchAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_transfers' }, () => fetchAll())
      .subscribe()
    return () => supabase.removeChannel(channel)
  }

  const filteredInventory = activeLocation === 'all'
    ? inventory
    : inventory.filter(i => i.location_id === activeLocation)

  const lowStockItems = inventory.filter(i =>
    i.quantity <= (i.items?.reorder_level || 0) && i.quantity >= 0
  )

  const totalValue = inventory.reduce((sum, i) => sum + (i.quantity || 0), 0)

  const statusColor = {
    requested:  'bg-amber-100 text-amber-800',
    approved:   'bg-blue-100 text-blue-800',
    in_transit: 'bg-purple-100 text-purple-800',
    received:   'bg-green-100 text-green-800',
    cancelled:  'bg-gray-100 text-gray-600',
  }

  const locationColor = [
    'border-l-yellow-400',
    'border-l-blue-400',
    'border-l-green-400',
    'border-l-purple-400',
    'border-l-pink-400',
    'border-l-orange-400',
  ]

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="w-10 h-10 border-4 border-yellow-400 border-t-transparent rounded-full animate-spin mx-auto mb-3"/>
        <p className="text-gray-500 text-sm">Loading QuackDASH...</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Header */}
      <header className="bg-gray-900 text-white px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-yellow-400 rounded-full flex items-center justify-center text-gray-900 font-bold text-sm">Q</div>
          <div>
            <h1 className="font-bold text-lg leading-none">QuackDASH</h1>
            <p className="text-gray-400 text-xs">Inventory Management</p>
          </div>
<div className="flex gap-3 mt-1">
  <Link href="/items" className="text-yellow-400 text-xs hover:underline">Items</Link>
  <Link href="/transfers" className="text-yellow-400 text-xs hover:underline">Transfers</Link>
  <Link href="/stocktakes" className="text-yellow-400 text-xs hover:underline">Stock takes</Link>
  <Link href="/deliveries" className="text-yellow-400 text-xs hover:underline">Deliveries</Link>

</div>
        </div>
        <div className="flex items-center gap-4">
          {lowStockItems.length > 0 && (
            <div className="bg-red-500 text-white text-xs font-bold px-3 py-1 rounded-full animate-pulse">
              {lowStockItems.length} low stock
            </div>
          )}
          <div className="text-xs text-gray-400">
            {new Date().toLocaleDateString('en-MY', { weekday: 'short', day: 'numeric', month: 'short' })}
          </div>
<button
  onClick={async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.href = '/login'
  }}
  className="text-xs text-gray-400 hover:text-white transition-colors"
>
  Sign out
</button>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">

        {/* Stat Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Locations</p>
            <p className="text-3xl font-bold text-gray-900 mt-1">{locations.length}</p>
            <p className="text-xs text-gray-400 mt-1">1 kitchen + {locations.length - 1} outlets</p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Items tracked</p>
            <p className="text-3xl font-bold text-gray-900 mt-1">{items.length}</p>
            <p className="text-xs text-gray-400 mt-1">across all locations</p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Low stock alerts</p>
            <p className={`text-3xl font-bold mt-1 ${lowStockItems.length > 0 ? 'text-red-500' : 'text-green-500'}`}>
              {lowStockItems.length}
            </p>
            <p className="text-xs text-gray-400 mt-1">{lowStockItems.length === 0 ? 'All good' : 'needs attention'}</p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Active transfers</p>
            <p className="text-3xl font-bold text-gray-900 mt-1">{transfers.length}</p>
            <p className="text-xs text-gray-400 mt-1">in progress</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Inventory Panel */}
          <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-100">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Inventory levels</h2>
              <div className="flex items-center gap-1 text-xs text-green-600 bg-green-50 px-2 py-1 rounded-full">
                <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"/>
                Live
              </div>
            </div>

            {/* Location filter tabs */}
            <div className="px-5 pt-3 flex gap-2 flex-wrap">
              <button
                onClick={() => setActiveLocation('all')}
                className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${activeLocation === 'all' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                All
              </button>
              {locations.map(loc => (
                <button
                  key={loc.id}
                  onClick={() => setActiveLocation(loc.id)}
                  className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${activeLocation === loc.id ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                  {loc.name}
                </button>
              ))}
            </div>

            {/* Inventory table */}
            <div className="p-5">
              {filteredInventory.length === 0 ? (
                <div className="text-center py-12">
                  <div className="text-4xl mb-3">📦</div>
                  <p className="text-gray-500 text-sm">No inventory yet</p>
                  <p className="text-gray-400 text-xs mt-1">Add items to start tracking stock</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredInventory.map(inv => {
                    const isLow = inv.quantity <= (inv.items?.reorder_level || 0)
                    const locIndex = locations.findIndex(l => l.id === inv.location_id)
                    return (
                      <div
                        key={inv.id}
                        className={`flex items-center justify-between p-3 rounded-lg border-l-4 bg-gray-50 ${locationColor[locIndex] || 'border-l-gray-300'} ${isLow ? 'bg-red-50' : ''}`}
                      >
                        <div>
                          <p className="text-sm font-medium text-gray-900">{inv.items?.name}</p>
                          <p className="text-xs text-gray-500">{inv.locations?.name}</p>
                        </div>
                        <div className="text-right">
                          <p className={`text-sm font-bold ${isLow ? 'text-red-600' : 'text-gray-900'}`}>
                            {inv.quantity} {inv.items?.units?.abbreviation}
                          </p>
                          {isLow && <p className="text-xs text-red-500">Low stock</p>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right column */}
          <div className="space-y-6">

            {/* Locations card */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100">
              <div className="px-5 py-4 border-b border-gray-100">
                <h2 className="font-semibold text-gray-900">Locations</h2>
              </div>
              <div className="p-5 space-y-2">
                {locations.map((loc, i) => {
                  const locInventory = inventory.filter(inv => inv.location_id === loc.id)
                  const locLowStock = locInventory.filter(inv => inv.quantity <= (inv.items?.reorder_level || 0))
                  return (
                    <div key={loc.id} className={`flex items-center justify-between p-3 rounded-lg border-l-4 bg-gray-50 ${locationColor[i] || 'border-l-gray-300'}`}>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{loc.name}</p>
                        <p className="text-xs text-gray-500 capitalize">{loc.type.replace('_', ' ')}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-gray-500">{locInventory.length} items</p>
                        {locLowStock.length > 0 && (
                          <p className="text-xs text-red-500 font-medium">{locLowStock.length} low</p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Active transfers */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100">
              <div className="px-5 py-4 border-b border-gray-100">
                <h2 className="font-semibold text-gray-900">Active transfers</h2>
              </div>
              <div className="p-5">
                {transfers.length === 0 ? (
                  <div className="text-center py-6">
                    <p className="text-gray-400 text-sm">No active transfers</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {transfers.map(t => (
                      <div key={t.id} className="p-3 bg-gray-50 rounded-lg">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-xs font-mono text-gray-500">{t.transfer_number}</p>
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusColor[t.status]}`}>
                            {t.status.replace('_', ' ')}
                          </span>
                        </div>
                        <p className="text-sm text-gray-700">
                          {t.from_location?.name} → {t.to_location?.name}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  )
}