'use client'

import { useEffect, useState } from 'react'
import { createClient } from '../../lib/supabase'
import { activeOnly } from '../../lib/db'
import { logAudit, getCurrentUserEmail } from '../../lib/audit'
import Link from 'next/link'

export default function UsersPage() {
  const supabase = createClient()
  const [users, setUsers] = useState([])
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [userAdded, setUserAdded] = useState(false)
  const [form, setForm] = useState({
    email: '', full_name: '', role: 'outlet_staff', location_id: '', password: ''
  })

  const roles = [
    { value: 'admin',           label: 'Admin',           desc: 'Full access to everything' },
    { value: 'central_kitchen', label: 'Central Kitchen',  desc: 'Quackmaster staff, sees all outlets' },
    { value: 'outlet_manager',  label: 'Outlet Manager',   desc: 'Manages their assigned outlet' },
    { value: 'outlet_staff',    label: 'Outlet Staff',     desc: 'Basic access to their outlet' },
    { value: 'procurement',     label: 'Procurement',      desc: 'Suppliers, DOs, invoices' },
  ]

  const roleColor = {
    admin:           'bg-purple-100 text-purple-800',
    central_kitchen: 'bg-yellow-100 text-yellow-800',
    outlet_manager:  'bg-blue-100 text-blue-800',
    outlet_staff:    'bg-gray-100 text-gray-600',
    procurement:     'bg-green-100 text-green-800',
  }

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    try {
      const results = await Promise.allSettled([
        supabase.from('user_profiles').select('*, locations(name)').order('created_at', { ascending: false }),
        activeOnly(supabase, 'locations', q => q.select('*').order('name')),
      ])
      const [usr, loc] = results.map(r => r.status === 'fulfilled' ? r.value : { data: [] })
      if (usr.data) setUsers(usr.data)
      if (loc.data) setLocations(loc.data)
    } catch (err) {
      console.error('fetchAll failed:', err)
    } finally {
      setLoading(false)
    }
  }

  async function addUser() {
    if (!form.email.trim()) return alert('Email is required')
    if (!form.full_name.trim()) return alert('Name is required')
    if (!form.password || form.password.length < 6) return alert('Password must be at least 6 characters')
    setSaving(true)

    const res = await fetch('/api/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: form.email,
        full_name: form.full_name,
        role: form.role,
        location_id: form.location_id || null,
        password: form.password,
      })
    })

    const result = await res.json()

    if (!res.ok) {
      alert(result.error || 'Failed to create user')
      setSaving(false)
      return
    }

    const by = await getCurrentUserEmail(supabase)
    await logAudit(supabase, {
      table: 'user_profiles', recordId: result.userId || null, action: 'create', performedBy: by,
      summary: `Added user "${form.full_name}" (${form.email}) with role ${form.role}`,
      newData: { email: form.email, full_name: form.full_name, role: form.role },
    })
    setSaving(false)
    setUserAdded(true)
    setForm({ email: '', full_name: '', role: 'outlet_staff', location_id: '', password: '' })
    fetchAll()
  }

  async function updateUserRole(userId, role) {
    const prev = users.find(u => u.id === userId)
    await supabase.from('user_profiles').update({ role }).eq('id', userId)
    const by = await getCurrentUserEmail(supabase)
    await logAudit(supabase, {
      table: 'user_profiles', recordId: userId, action: 'update', performedBy: by,
      summary: `Changed role of "${prev?.full_name || userId}" from ${prev?.role} to ${role}`,
      oldData: { role: prev?.role }, newData: { role },
    })
    fetchAll()
  }

  async function updateUserLocation(userId, locationId) {
    const prev = users.find(u => u.id === userId)
    await supabase.from('user_profiles').update({ location_id: locationId || null }).eq('id', userId)
    const by = await getCurrentUserEmail(supabase)
    const locName = locations.find(l => l.id === locationId)?.name || 'All locations'
    await logAudit(supabase, {
      table: 'user_profiles', recordId: userId, action: 'update', performedBy: by,
      summary: `Updated location of "${prev?.full_name || userId}" to ${locName}`,
      oldData: { location_id: prev?.location_id }, newData: { location_id: locationId || null },
    })
    fetchAll()
  }

  async function toggleActive(user) {
    await supabase.from('user_profiles').update({ is_active: !user.is_active }).eq('id', user.id)
    const by = await getCurrentUserEmail(supabase)
    await logAudit(supabase, {
      table: 'user_profiles', recordId: user.id,
      action: user.is_active ? 'delete' : 'restore', performedBy: by,
      summary: `${user.is_active ? 'Deactivated' : 'Reactivated'} user "${user.full_name}"`,
    })
    fetchAll()
  }

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Header */}
      <header className="bg-gray-900 text-white px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="w-8 h-8 bg-yellow-400 rounded-full flex items-center justify-center text-gray-900 font-bold text-sm">Q</Link>
          <div>
            <h1 className="font-bold text-lg leading-none">Users</h1>
            <p className="text-gray-400 text-xs">Team management</p>
          </div>
        </div>
        <button
          onClick={() => { setShowForm(true); setUserAdded(false) }}
          className="bg-yellow-400 text-gray-900 text-sm font-bold px-4 py-2 rounded-lg hover:bg-yellow-300 transition-colors"
        >
          + Add user
        </button>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-6">

        {/* Role legend */}
        <div className="flex gap-2 flex-wrap mb-6">
          {roles.map(r => (
            <span key={r.value} className={`text-xs font-medium px-2.5 py-1 rounded-full ${roleColor[r.value]}`}>
              {r.label}
            </span>
          ))}
        </div>

        {/* Users table */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          {loading ? (
            <div className="text-center py-16">
              <div className="w-8 h-8 border-4 border-yellow-400 border-t-transparent rounded-full animate-spin mx-auto"/>
            </div>
          ) : users.length === 0 ? (
            <div className="text-center py-16">
              <div className="text-4xl mb-3">👥</div>
              <p className="text-gray-500 text-sm font-medium">No users yet</p>
              <button onClick={() => setShowForm(true)} className="mt-4 bg-yellow-400 text-gray-900 text-sm font-bold px-4 py-2 rounded-lg">
                + Add first user
              </button>
            </div>
          ) : (
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-5 py-3">Name</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-5 py-3">Role</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-5 py-3">Location</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-5 py-3">Status</th>
                  <th className="px-5 py-3"/>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {users.map(user => (
                  <tr key={user.id} className={`hover:bg-gray-50 ${!user.is_active ? 'opacity-50' : ''}`}>
                    <td className="px-5 py-3">
                      <p className="text-sm font-medium text-gray-900">{user.full_name || '—'}</p>
                    </td>
                    <td className="px-5 py-3">
                      <select
                        value={user.role}
                        onChange={e => updateUserRole(user.id, e.target.value)}
                        className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                      >
                        {roles.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </select>
                    </td>
                    <td className="px-5 py-3">
                      <select
                        value={user.location_id || ''}
                        onChange={e => updateUserLocation(user.id, e.target.value)}
                        className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                      >
                        <option value="">All locations</option>
                        {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                      </select>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`text-xs font-medium px-2 py-1 rounded-full ${user.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {user.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => toggleActive(user)}
                        className="text-xs text-gray-400 hover:underline"
                      >
                        {user.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Invite Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
            <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-bold text-gray-900">Add team member</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>

            {userAdded ? (
              <div className="px-6 py-10 text-center">
                <div className="text-5xl mb-4">✅</div>
                <p className="font-bold text-gray-900 text-lg">User added</p>
                <p className="text-gray-500 text-sm mt-2">They can now log in with their email and password.</p>
                <div className="flex gap-3 mt-6">
                  <button onClick={() => setUserAdded(false)} className="flex-1 border border-gray-200 text-gray-600 text-sm py-2.5 rounded-lg hover:bg-gray-50">
                    Add another
                  </button>
                  <button onClick={() => setShowForm(false)} className="flex-1 bg-yellow-400 text-gray-900 text-sm font-bold py-2.5 rounded-lg hover:bg-yellow-300">
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="px-6 py-5 space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5">Full name *</label>
                    <input
                      type="text"
                      value={form.full_name}
                      onChange={e => setForm({ ...form, full_name: e.target.value })}
                      placeholder="e.g. YOB"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5">Email address *</label>
                    <input
                      type="email"
                      value={form.email}
                      onChange={e => setForm({ ...form, email: e.target.value })}
                      placeholder="staff@quackteow.com"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5">Role</label>
                    <select
                      value={form.role}
                      onChange={e => setForm({ ...form, role: e.target.value })}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                    >
                      {roles.map(r => (
                        <option key={r.value} value={r.value}>{r.label} — {r.desc}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5">Assigned location</label>
                    <select
                      value={form.location_id}
                      onChange={e => setForm({ ...form, location_id: e.target.value })}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                    >
                      <option value="">All locations (admin / central kitchen)</option>
                      {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5">Password *</label>
                    <input
                      type="password"
                      value={form.password}
                      onChange={e => setForm({ ...form, password: e.target.value })}
                      placeholder="Min. 6 characters"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                    />
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
                    onClick={addUser}
                    disabled={saving}
                    className="flex-1 bg-yellow-400 text-gray-900 text-sm font-bold py-2.5 rounded-lg hover:bg-yellow-300 disabled:opacity-50"
                  >
                    {saving ? 'Creating...' : 'Add user'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}