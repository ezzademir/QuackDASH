'use client'

export const dynamic = 'force-dynamic'
import { useEffect, useState } from 'react'
import { createClient } from '../../lib/supabase'
import { logAudit, getCurrentUserEmail } from '../../lib/audit'
import Link from 'next/link'

const LOCATION_DEFAULTS = { name: '', type: 'outlet' }

const typeLabel = { central_kitchen: 'Central Kitchen', outlet: 'Outlet' }
const typeColor = {
  central_kitchen: 'bg-yellow-100 text-yellow-800',
  outlet: 'bg-blue-100 text-blue-800',
}
const borderColor = [
  'border-l-yellow-400', 'border-l-blue-400', 'border-l-green-400',
  'border-l-purple-400', 'border-l-pink-400', 'border-l-orange-400',
]

export default function LocationsPage() {
  const supabase = createClient()
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(LOCATION_DEFAULTS)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(null)

  useEffect(() => { fetchLocations() }, [])

  async function fetchLocations() {
    setLoading(true)
    // Try with soft-delete filter; fall back without it if column doesn't exist yet
    let { data, error } = await supabase
      .from('locations').select('*').is('deleted_at', null).order('type').order('name')
    if (error) {
      ;({ data } = await supabase.from('locations').select('*').order('type').order('name'))
    }
    if (data) setLocations(data)
    setLoading(false)
  }

  function openNew() {
    setEditing(null)
    setForm(LOCATION_DEFAULTS)
    setModal(true)
  }

  function openEdit(loc) {
    setEditing(loc)
    setForm({ name: loc.name, type: loc.type })
    setModal(true)
  }

  async function save() {
    if (!form.name.trim()) return alert('Name is required')
    setSaving(true)
    const by = await getCurrentUserEmail(supabase)
    const payload = { name: form.name.trim(), type: form.type }

    if (editing) {
      const { error } = await supabase.from('locations').update(payload).eq('id', editing.id)
      if (error) { alert('Error: ' + error.message); setSaving(false); return }
      await logAudit(supabase, {
        table: 'locations', recordId: editing.id, action: 'update', performedBy: by,
        summary: `Updated location "${payload.name}"`,
        oldData: { name: editing.name, type: editing.type },
        newData: payload,
      })
    } else {
      const { data, error } = await supabase.from('locations').insert(payload).select().single()
      if (error) { alert('Error: ' + error.message); setSaving(false); return }
      await logAudit(supabase, {
        table: 'locations', recordId: data?.id, action: 'create', performedBy: by,
        summary: `Created location "${payload.name}" (${payload.type})`,
        newData: payload,
      })
    }

    setSaving(false)
    setModal(false)
    fetchLocations()
  }

  async function toggleActive(loc) {
    const by = await getCurrentUserEmail(supabase)
    const newActive = !loc.is_active
    const { error } = await supabase
      .from('locations').update({ is_active: newActive }).eq('id', loc.id)
    if (error) { alert('Error: ' + error.message); return }
    await logAudit(supabase, {
      table: 'locations', recordId: loc.id,
      action: newActive ? 'restore' : 'delete', performedBy: by,
      summary: `${newActive ? 'Reactivated' : 'Deactivated'} location "${loc.name}"`,
    })
    fetchLocations()
  }

  async function deleteLocation(loc) {
    if (!confirm(`Delete "${loc.name}"?\n\nThe location will be hidden but all linked data (inventory, transfers, procurement) is preserved and visible in the audit log.`)) return
    setDeleting(loc.id)
    const by = await getCurrentUserEmail(supabase)
    const now = new Date().toISOString()

    // Try soft delete first; fall back to hard delete if column doesn't exist
    let { error } = await supabase
      .from('locations').update({ deleted_at: now, deleted_by: by }).eq('id', loc.id)
    if (error) {
      ;({ error } = await supabase.from('locations').delete().eq('id', loc.id))
    }
    if (error) { alert('Could not delete location: ' + error.message); setDeleting(null); return }

    await logAudit(supabase, {
      table: 'locations', recordId: loc.id, action: 'delete', performedBy: by,
      summary: `Deleted location "${loc.name}"`,
      oldData: { name: loc.name, type: loc.type },
    })

    setDeleting(null)
    fetchLocations()
  }

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Header */}
      <header className="bg-gray-900 text-white">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Link href="/" className="w-8 h-8 bg-yellow-400 rounded-full flex items-center justify-center text-gray-900 font-bold text-sm shrink-0">Q</Link>
            <div>
              <h1 className="font-bold text-base leading-none">Locations</h1>
              <p className="text-gray-400 text-[10px] mt-0.5">Outlets & kitchen management</p>
            </div>
          </div>
          <button
            onClick={openNew}
            className="bg-yellow-400 text-gray-900 text-sm font-bold px-4 py-2 rounded-lg hover:bg-yellow-300 transition-colors shrink-0"
          >
            + Add location
          </button>
        </div>
        <div className="px-4 pb-2 flex gap-1 overflow-x-auto scrollbar-none">
          {[
            { href: '/',            label: 'Dashboard' },
            { href: '/items',       label: 'Items' },
            { href: '/transfers',   label: 'Transfers' },
            { href: '/stocktakes',  label: 'Stock takes' },
            { href: '/procurement',  label: 'Procurement' },
            { href: '/quackmaster', label: 'Quackmaster' },
            { href: '/reports',     label: 'Reports' },
            { href: '/users',       label: 'Users' },
          ].map(({ href, label }) => (
            <Link key={href} href={href} className="shrink-0 text-yellow-400 text-xs px-3 py-1.5 rounded-full hover:bg-gray-800 transition-colors whitespace-nowrap">
              {label}
            </Link>
          ))}
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-6">

        {/* Summary */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Active locations</p>
            <p className="text-3xl font-bold text-gray-900 mt-1">{locations.filter(l => l.is_active !== false).length}</p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Outlets</p>
            <p className="text-3xl font-bold text-gray-900 mt-1">
              {locations.filter(l => l.type === 'outlet' && l.is_active !== false).length}
            </p>
          </div>
        </div>

        {/* Location list */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">All locations</h2>
            <p className="text-xs text-gray-400 mt-0.5">Edit name or type, or remove a location.</p>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-8 h-8 border-4 border-yellow-400 border-t-transparent rounded-full animate-spin"/>
            </div>
          ) : locations.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-gray-400 text-sm">No locations yet.</p>
              <button onClick={openNew} className="mt-3 bg-yellow-400 text-gray-900 text-sm font-bold px-4 py-2 rounded-lg">
                + Add first location
              </button>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {locations.map((loc, i) => (
                <div key={loc.id} className={`flex items-center gap-4 px-5 py-4 border-l-4 ${borderColor[i % borderColor.length]}`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900">{loc.name}</p>
                    <span className={`inline-block mt-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${typeColor[loc.type] || 'bg-gray-100 text-gray-600'}`}>
                      {typeLabel[loc.type] || loc.type}
                    </span>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => openEdit(loc)}
                      className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => toggleActive(loc)}
                      className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                        loc.is_active !== false
                          ? 'border-yellow-100 text-yellow-600 hover:bg-yellow-50'
                          : 'border-green-100 text-green-600 hover:bg-green-50'
                      }`}
                    >
                      {loc.is_active !== false ? 'Deactivate' : 'Reactivate'}
                    </button>
                    <button
                      onClick={() => deleteLocation(loc)}
                      disabled={deleting === loc.id}
                      className="text-xs px-3 py-1.5 rounded-lg border border-red-100 text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
                    >
                      {deleting === loc.id ? '…' : 'Delete'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
            <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">{editing ? 'Edit location' : 'New location'}</h3>
              <button onClick={() => setModal(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Hartamas Outlet"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Type</label>
                <select
                  value={form.type}
                  onChange={e => setForm({ ...form, type: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                >
                  <option value="outlet">Outlet</option>
                  <option value="central_kitchen">Central Kitchen</option>
                </select>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex gap-3">
              <button
                onClick={() => setModal(false)}
                className="flex-1 border border-gray-200 text-gray-600 text-sm font-medium py-2.5 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="flex-1 bg-yellow-400 text-gray-900 text-sm font-bold py-2.5 rounded-lg hover:bg-yellow-300 disabled:opacity-50 transition-colors"
              >
                {saving ? 'Saving…' : editing ? 'Save changes' : 'Add location'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
