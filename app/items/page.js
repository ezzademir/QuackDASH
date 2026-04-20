'use client'

import { useEffect, useState } from 'react'
import { createClient } from '../../lib/supabase'
import { logAudit, getCurrentUserEmail } from '../../lib/audit'
import Link from 'next/link'

export default function ItemsPage() {
  const supabase = createClient()
  const [items, setItems] = useState([])
  const [categories, setCategories] = useState([])
  const [units, setUnits] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editItem, setEditItem] = useState(null)
  const [search, setSearch] = useState('')
  const [filterCategory, setFilterCategory] = useState('all')
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    name: '', sku: '', category_id: '', unit_id: '', reorder_level: 0
  })

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const [itm, cat, unt] = await Promise.all([
      supabase.from('items').select('*, categories(name), units(abbreviation, name)').order('name'),
      supabase.from('categories').select('*').order('name'),
      supabase.from('units').select('*').order('name'),
    ])
    if (itm.data) setItems(itm.data)
    if (cat.data) setCategories(cat.data)
    if (unt.data) setUnits(unt.data)
    setLoading(false)
  }

  function openNew() {
    setEditItem(null)
    setForm({ name: '', sku: '', category_id: '', unit_id: '', reorder_level: 0 })
    setShowForm(true)
  }

  function openEdit(item) {
    setEditItem(item)
    setForm({
      name: item.name,
      sku: item.sku || '',
      category_id: item.category_id || '',
      unit_id: item.unit_id || '',
      reorder_level: item.reorder_level || 0,
    })
    setShowForm(true)
  }

  async function saveItem() {
    if (!form.name.trim()) return alert('Item name is required')
    setSaving(true)
    const by = await getCurrentUserEmail(supabase)
    const payload = {
      name: form.name.trim(),
      sku: form.sku.trim() || null,
      category_id: form.category_id || null,
      unit_id: form.unit_id || null,
      reorder_level: parseFloat(form.reorder_level) || 0,
      is_active: true,
    }
    if (editItem) {
      await supabase.from('items').update(payload).eq('id', editItem.id)
      await logAudit(supabase, {
        table: 'items', recordId: editItem.id, action: 'update', performedBy: by,
        summary: `Updated item "${payload.name}"`,
        oldData: { name: editItem.name, sku: editItem.sku, reorder_level: editItem.reorder_level },
        newData: payload,
      })
    } else {
      const { data } = await supabase.from('items').insert(payload).select().single()
      await logAudit(supabase, {
        table: 'items', recordId: data?.id, action: 'create', performedBy: by,
        summary: `Created item "${payload.name}"`,
        newData: payload,
      })
    }
    setSaving(false)
    setShowForm(false)
    fetchAll()
  }

  async function toggleActive(item) {
    const by = await getCurrentUserEmail(supabase)
    await supabase.from('items').update({ is_active: !item.is_active }).eq('id', item.id)
    await logAudit(supabase, {
      table: 'items', recordId: item.id,
      action: item.is_active ? 'delete' : 'restore',
      performedBy: by,
      summary: `${item.is_active ? 'Deactivated' : 'Reactivated'} item "${item.name}"`,
    })
    fetchAll()
  }

  const filtered = items.filter(i => {
    const matchSearch = i.name.toLowerCase().includes(search.toLowerCase()) ||
      (i.sku && i.sku.toLowerCase().includes(search.toLowerCase()))
    const matchCat = filterCategory === 'all' || i.category_id === filterCategory
    return matchSearch && matchCat
  })

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Header */}
      <header className="bg-gray-900 text-white px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="w-8 h-8 bg-yellow-400 rounded-full flex items-center justify-center text-gray-900 font-bold text-sm">Q</Link>
          <div>
            <h1 className="font-bold text-lg leading-none">Items</h1>
            <p className="text-gray-400 text-xs">Manage inventory items</p>
          </div>
        </div>
        <button
          onClick={openNew}
          className="bg-yellow-400 text-gray-900 text-sm font-bold px-4 py-2 rounded-lg hover:bg-yellow-300 transition-colors"
        >
          + Add item
        </button>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-6">

        {/* Search + filter bar */}
        <div className="flex gap-3 mb-6">
          <input
            type="text"
            placeholder="Search items or SKU..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 bg-white border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
          />
          <select
            value={filterCategory}
            onChange={e => setFilterCategory(e.target.value)}
            className="bg-white border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
          >
            <option value="all">All categories</option>
            {categories.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 text-center">
            <p className="text-2xl font-bold text-gray-900">{items.length}</p>
            <p className="text-xs text-gray-500 mt-1">Total items</p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 text-center">
            <p className="text-2xl font-bold text-green-600">{items.filter(i => i.is_active).length}</p>
            <p className="text-xs text-gray-500 mt-1">Active</p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 text-center">
            <p className="text-2xl font-bold text-gray-400">{items.filter(i => !i.is_active).length}</p>
            <p className="text-xs text-gray-500 mt-1">Inactive</p>
          </div>
        </div>

        {/* Items table */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          {loading ? (
            <div className="text-center py-16">
              <div className="w-8 h-8 border-4 border-yellow-400 border-t-transparent rounded-full animate-spin mx-auto mb-3"/>
              <p className="text-gray-400 text-sm">Loading items...</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16">
              <div className="text-4xl mb-3">📦</div>
              <p className="text-gray-500 text-sm font-medium">No items found</p>
              <p className="text-gray-400 text-xs mt-1">Add your first inventory item to get started</p>
              <button onClick={openNew} className="mt-4 bg-yellow-400 text-gray-900 text-sm font-bold px-4 py-2 rounded-lg hover:bg-yellow-300">
                + Add item
              </button>
            </div>
          ) : (
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-5 py-3">Item</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-5 py-3">Category</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-5 py-3">Unit</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-5 py-3">Reorder at</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-5 py-3">Status</th>
                  <th className="px-5 py-3"/>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(item => (
                  <tr key={item.id} className={`hover:bg-gray-50 transition-colors ${!item.is_active ? 'opacity-50' : ''}`}>
                    <td className="px-5 py-3">
                      <p className="text-sm font-medium text-gray-900">{item.name}</p>
                      {item.sku && <p className="text-xs text-gray-400 font-mono">{item.sku}</p>}
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full">
                        {item.categories?.name || '—'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-sm text-gray-600">{item.units?.abbreviation || '—'}</td>
                    <td className="px-5 py-3 text-sm text-gray-600">{item.reorder_level} {item.units?.abbreviation}</td>
                    <td className="px-5 py-3">
                      <span className={`text-xs font-medium px-2 py-1 rounded-full ${item.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {item.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2 justify-end">
                        <button onClick={() => openEdit(item)} className="text-xs text-blue-600 hover:underline">Edit</button>
                        <button onClick={() => toggleActive(item)} className="text-xs text-gray-400 hover:underline">
                          {item.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Add / Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
            <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-bold text-gray-900">{editItem ? 'Edit item' : 'Add new item'}</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Item name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Kuey Teow Noodles"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">SKU / Code</label>
                <input
                  type="text"
                  value={form.sku}
                  onChange={e => setForm({ ...form, sku: e.target.value })}
                  placeholder="e.g. NLD-001"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Category</label>
                  <select
                    value={form.category_id}
                    onChange={e => setForm({ ...form, category_id: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                  >
                    <option value="">Select...</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Unit</label>
                  <select
                    value={form.unit_id}
                    onChange={e => setForm({ ...form, unit_id: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                  >
                    <option value="">Select...</option>
                    {units.map(u => <option key={u.id} value={u.id}>{u.name} ({u.abbreviation})</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Reorder level</label>
                <input
                  type="number"
                  value={form.reorder_level}
                  onChange={e => setForm({ ...form, reorder_level: e.target.value })}
                  placeholder="0"
                  min="0"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                />
                <p className="text-xs text-gray-400 mt-1">Dashboard will alert when stock falls below this</p>
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
                onClick={saveItem}
                disabled={saving}
                className="flex-1 bg-yellow-400 text-gray-900 text-sm font-bold py-2.5 rounded-lg hover:bg-yellow-300 disabled:opacity-50"
              >
                {saving ? 'Saving...' : editItem ? 'Save changes' : 'Add item'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}