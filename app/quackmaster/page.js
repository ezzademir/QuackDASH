'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '../../lib/supabase'
import Link from 'next/link'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
// JS Date.getDay(): 0 = Sunday. Map to our DAYS array index.
const todayShort = DAYS[(new Date().getDay() + 6) % 7]

export default function QuackmasterPage() {
  const supabase = createClient()

  const [tab, setTab] = useState('stock')            // 'stock' | 'log' | 'schedule' | 'items'
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState([])
  const [stock, setStock] = useState([])             // stock_levels rows
  const [logs, setLogs] = useState([])               // recent production_logs
  const [edits, setEdits] = useState({})             // { itemId: newQty } — stock take draft
  const [savingStock, setSavingStock] = useState(false)

  // Production-log form state
  const [logForm, setLogForm] = useState({ item_id: '', planned_qty: '', actual_qty: '', note: '' })
  const [savingLog, setSavingLog] = useState(false)

  // Item management state
  const ITEM_DEFAULTS = { name: '', type: 'protein', unit: '', max_qty: '', schedule_days: [], schedule_label: '' }
  const [itemModal, setItemModal] = useState(false)
  const [editingItem, setEditingItem] = useState(null)  // null = new, object = edit
  const [itemForm, setItemForm] = useState(ITEM_DEFAULTS)
  const [savingItem, setSavingItem] = useState(false)
  const [deletingItem, setDeletingItem] = useState(null)

  useEffect(() => {
    fetchAll()
    const channel = supabase
      .channel('quackmaster-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'qm_stock_levels' }, () => fetchAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'qm_production_logs' }, () => fetchAll())
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [])

  async function fetchAll() {
    setLoading(true)
    const [it, st, lg] = await Promise.all([
      supabase.from('qm_production_items').select('*').order('name'),
      supabase.from('qm_stock_levels').select('*'),
      supabase.from('qm_production_logs')
        .select('*, qm_production_items(name, unit)')
        .order('logged_at', { ascending: false })
        .limit(30),
    ])
    if (it.data) setItems(it.data)
    if (st.data) setStock(st.data)
    if (lg.data) setLogs(lg.data)
    setLoading(false)
  }

  // Merge items + their latest stock row
  const itemsWithStock = useMemo(() => items.map(i => {
    const row = stock.find(s => s.item_id === i.id)
    const qty = row?.qty ?? 0
    return {
      ...i,
      qty,
      stock_updated_at: row?.updated_at || null,
      pct: i.max_qty > 0 ? Math.min(100, Math.round((qty / i.max_qty) * 100)) : 0,
    }
  }), [items, stock])

  const typeColor = {
    protein: 'bg-rose-100 text-rose-700',
    sauce:   'bg-amber-100 text-amber-700',
    garnish: 'bg-emerald-100 text-emerald-700',
    stock:   'bg-blue-100 text-blue-700',
    noodle:  'bg-violet-100 text-violet-700',
  }

  function barColor(pct) {
    if (pct <= 25) return 'bg-red-500'
    if (pct <= 60) return 'bg-amber-400'
    return 'bg-green-500'
  }

  // --------------------------------------------------------
  // STOCK TAKE
  // --------------------------------------------------------
  function onEditQty(itemId, value) {
    setEdits(prev => ({ ...prev, [itemId]: value }))
  }

  async function saveStockTake() {
    const entries = Object.entries(edits).filter(([, v]) => v !== '' && !isNaN(parseFloat(v)))
    if (entries.length === 0) return alert('No changes to save.')
    setSavingStock(true)
    const now = new Date().toISOString()
    const { data: { user } } = await supabase.auth.getUser()
    const who = user?.email || 'unknown'

    // upsert each row (unique on item_id)
    const payload = entries.map(([item_id, v]) => ({
      item_id,
      qty: parseFloat(v),
      updated_at: now,
      updated_by: who,
    }))
    const { error } = await supabase
      .from('qm_stock_levels')
      .upsert(payload, { onConflict: 'item_id' })

    setSavingStock(false)
    if (error) { alert('Error saving: ' + error.message); return }
    setEdits({})
    fetchAll()
  }

  const hasEdits = Object.values(edits).some(v => v !== '' && !isNaN(parseFloat(v)))

  // --------------------------------------------------------
  // PRODUCTION LOG
  // --------------------------------------------------------
  async function saveLog() {
    if (!logForm.item_id) return alert('Pick an item')
    const planned = parseFloat(logForm.planned_qty)
    const actual  = parseFloat(logForm.actual_qty)
    if (isNaN(planned) || isNaN(actual)) return alert('Enter planned and actual quantities')
    setSavingLog(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('qm_production_logs').insert({
      item_id: logForm.item_id,
      planned_qty: planned,
      actual_qty: actual,
      note: logForm.note.trim() || null,
      logged_by: user?.email || 'unknown',
    })
    setSavingLog(false)
    if (error) { alert('Error: ' + error.message); return }
    setLogForm({ item_id: '', planned_qty: '', actual_qty: '', note: '' })
    fetchAll()
  }

  function yieldPct(planned, actual) {
    if (!planned || planned <= 0) return null
    return Math.round((actual / planned) * 100)
  }

  function yieldColor(pct) {
    if (pct === null) return 'text-gray-400'
    if (pct >= 95) return 'text-green-600'
    if (pct >= 80) return 'text-amber-600'
    return 'text-red-500'
  }

  // --------------------------------------------------------
  // ITEM MANAGEMENT
  // --------------------------------------------------------
  function openNewItem() {
    setEditingItem(null)
    setItemForm(ITEM_DEFAULTS)
    setItemModal(true)
  }

  function openEditItem(item) {
    setEditingItem(item)
    setItemForm({
      name: item.name,
      type: item.type || 'protein',
      unit: item.unit,
      max_qty: item.max_qty ?? '',
      schedule_days: item.schedule_days || [],
      schedule_label: item.schedule_label || '',
    })
    setItemModal(true)
  }

  function toggleScheduleDay(day) {
    setItemForm(prev => ({
      ...prev,
      schedule_days: prev.schedule_days.includes(day)
        ? prev.schedule_days.filter(d => d !== day)
        : [...prev.schedule_days, day],
    }))
  }

  async function saveItem() {
    if (!itemForm.name.trim()) return alert('Name is required')
    if (!itemForm.unit.trim()) return alert('Unit is required')
    setSavingItem(true)
    const payload = {
      name: itemForm.name.trim(),
      type: itemForm.type,
      unit: itemForm.unit.trim(),
      max_qty: itemForm.max_qty !== '' ? parseFloat(itemForm.max_qty) : null,
      schedule_days: itemForm.schedule_days,
      schedule_label: itemForm.schedule_label.trim() || null,
    }
    let error
    if (editingItem) {
      ;({ error } = await supabase.from('qm_production_items').update(payload).eq('id', editingItem.id))
    } else {
      ;({ error } = await supabase.from('qm_production_items').insert(payload))
    }
    setSavingItem(false)
    if (error) { alert('Error: ' + error.message); return }
    setItemModal(false)
    fetchAll()
  }

  async function deleteItem(item) {
    if (!confirm(`Delete "${item.name}"? This cannot be undone.`)) return
    setDeletingItem(item.id)
    const { error } = await supabase.from('qm_production_items').delete().eq('id', item.id)
    setDeletingItem(null)
    if (error) { alert('Error: ' + error.message); return }
    fetchAll()
  }

  // --------------------------------------------------------
  // RENDER
  // --------------------------------------------------------
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="w-10 h-10 border-4 border-yellow-400 border-t-transparent rounded-full animate-spin mx-auto mb-3"/>
        <p className="text-gray-500 text-sm">Loading Quackmaster...</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Header (matches QuackDASH style) */}
      <header className="bg-gray-900 text-white px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="w-8 h-8 bg-yellow-400 rounded-full flex items-center justify-center text-gray-900 font-bold text-sm">Q</Link>
          <div>
            <h1 className="font-bold text-lg leading-none">Quackmaster</h1>
            <p className="text-gray-400 text-xs">Central kitchen production tracker</p>
            <div className="flex gap-3 mt-1">
              <Link href="/"           className="text-yellow-400 text-xs hover:underline">Dashboard</Link>
              <Link href="/items"      className="text-yellow-400 text-xs hover:underline">Items</Link>
              <Link href="/transfers"  className="text-yellow-400 text-xs hover:underline">Transfers</Link>
              <Link href="/stocktakes" className="text-yellow-400 text-xs hover:underline">Stock takes</Link>
              <Link href="/deliveries" className="text-yellow-400 text-xs hover:underline">Deliveries</Link>
              <Link href="/reports"    className="text-yellow-400 text-xs hover:underline">Reports</Link>
              <Link href="/users"      className="text-yellow-400 text-xs hover:underline">Users</Link>
            </div>
          </div>
        </div>
        <div className="text-xs text-gray-400">
          {new Date().toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'short' })}
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">

        {/* Tabs */}
        <div className="flex gap-2 flex-wrap">
          {[
            { id: 'stock',    label: 'Stock Levels' },
            { id: 'log',      label: 'Production Log' },
            { id: 'schedule', label: 'Weekly Schedule' },
            { id: 'items',    label: 'Manage Items' },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`text-sm px-4 py-2 rounded-full font-medium transition-colors ${tab === t.id ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* -------- STOCK LEVELS TAB -------- */}
        {tab === 'stock' && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-gray-900">Current stock levels</h2>
                <p className="text-xs text-gray-400 mt-0.5">Edit quantities and hit Save stock take to commit.</p>
              </div>
              <button
                onClick={saveStockTake}
                disabled={!hasEdits || savingStock}
                className="bg-yellow-400 text-gray-900 text-sm font-bold px-4 py-2 rounded-lg hover:bg-yellow-300 disabled:opacity-40 transition-colors"
              >
                {savingStock ? 'Saving...' : `Save stock take${hasEdits ? ` (${Object.keys(edits).filter(k => edits[k] !== '').length})` : ''}`}
              </button>
            </div>

            <div className="divide-y divide-gray-50">
              {itemsWithStock.map(i => {
                const draft = edits[i.id]
                const displayQty = draft !== undefined && draft !== '' ? parseFloat(draft) : i.qty
                const displayPct = i.max_qty > 0 ? Math.min(100, Math.max(0, Math.round((displayQty / i.max_qty) * 100))) : 0
                return (
                  <div key={i.id} className="px-5 py-4 flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-gray-900 truncate">{i.name}</p>
                        <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full font-medium ${typeColor[i.type] || 'bg-gray-100 text-gray-600'}`}>
                          {i.type}
                        </span>
                      </div>
                      {/* bar */}
                      <div className="mt-2 flex items-center gap-3">
                        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${barColor(displayPct)}`}
                            style={{ width: `${displayPct}%` }}
                          />
                        </div>
                        <p className="text-xs text-gray-500 w-28 text-right">
                          {displayQty} / {i.max_qty} {i.unit} · {displayPct}%
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        placeholder={String(i.qty)}
                        value={edits[i.id] ?? ''}
                        onChange={e => onEditQty(i.id, e.target.value)}
                        className="w-24 border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-yellow-400"
                      />
                      <span className="text-xs text-gray-400 w-6">{i.unit}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* -------- PRODUCTION LOG TAB -------- */}
        {tab === 'log' && (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

            {/* Form */}
            <div className="lg:col-span-2">
              <div className="bg-white rounded-xl shadow-sm border border-gray-100">
                <div className="px-5 py-4 border-b border-gray-100">
                  <h2 className="font-semibold text-gray-900">Log a production run</h2>
                  <p className="text-xs text-gray-400 mt-0.5">Yield % is calculated automatically.</p>
                </div>
                <div className="p-5 space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5">Item</label>
                    <select
                      value={logForm.item_id}
                      onChange={e => setLogForm({ ...logForm, item_id: e.target.value })}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                    >
                      <option value="">Select item...</option>
                      {items.map(i => (
                        <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1.5">Planned qty</label>
                      <input
                        type="number" min="0" step="0.1"
                        value={logForm.planned_qty}
                        onChange={e => setLogForm({ ...logForm, planned_qty: e.target.value })}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1.5">Actual qty</label>
                      <input
                        type="number" min="0" step="0.1"
                        value={logForm.actual_qty}
                        onChange={e => setLogForm({ ...logForm, actual_qty: e.target.value })}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                      />
                    </div>
                  </div>

                  {/* live yield preview */}
                  {logForm.planned_qty && logForm.actual_qty && (
                    <div className="bg-gray-50 rounded-lg px-4 py-3 flex items-center justify-between">
                      <span className="text-xs text-gray-500">Yield</span>
                      <span className={`text-lg font-bold ${yieldColor(yieldPct(parseFloat(logForm.planned_qty), parseFloat(logForm.actual_qty)))}`}>
                        {yieldPct(parseFloat(logForm.planned_qty), parseFloat(logForm.actual_qty))}%
                      </span>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5">Note (optional)</label>
                    <textarea
                      rows={2}
                      value={logForm.note}
                      onChange={e => setLogForm({ ...logForm, note: e.target.value })}
                      placeholder="e.g. oven temp spike, short on shallots..."
                      className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 resize-none"
                    />
                  </div>
                </div>
                <div className="px-5 py-4 border-t border-gray-100">
                  <button
                    onClick={saveLog}
                    disabled={savingLog}
                    className="w-full bg-yellow-400 text-gray-900 text-sm font-bold py-2.5 rounded-lg hover:bg-yellow-300 disabled:opacity-50"
                  >
                    {savingLog ? 'Saving...' : 'Log production run'}
                  </button>
                </div>
              </div>
            </div>

            {/* Recent logs */}
            <div className="lg:col-span-3">
              <div className="bg-white rounded-xl shadow-sm border border-gray-100">
                <div className="px-5 py-4 border-b border-gray-100">
                  <h2 className="font-semibold text-gray-900">Recent production runs</h2>
                </div>
                <div className="divide-y divide-gray-50 max-h-[34rem] overflow-y-auto">
                  {logs.length === 0 ? (
                    <div className="text-center py-12">
                      <div className="text-4xl mb-3">🏭</div>
                      <p className="text-gray-500 text-sm">No production logs yet</p>
                      <p className="text-gray-400 text-xs mt-1">Log a run on the left to get started.</p>
                    </div>
                  ) : logs.map(l => {
                    const y = yieldPct(l.planned_qty, l.actual_qty)
                    return (
                      <div key={l.id} className="px-5 py-3 flex items-center gap-4">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {l.qm_production_items?.name || '—'}
                          </p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {new Date(l.logged_at).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            {l.logged_by ? ` · ${l.logged_by}` : ''}
                          </p>
                          {l.note && (
                            <p className="text-xs text-gray-500 mt-1 bg-gray-50 inline-block px-2 py-0.5 rounded">{l.note}</p>
                          )}
                        </div>
                        <div className="text-right">
                          <p className="text-sm text-gray-700">
                            <span className="text-gray-400">plan</span> {l.planned_qty}
                            <span className="mx-1 text-gray-300">/</span>
                            <span className="text-gray-400">actual</span> <span className="font-medium">{l.actual_qty}</span>
                            <span className="text-gray-400 ml-1">{l.qm_production_items?.unit}</span>
                          </p>
                          <p className={`text-sm font-bold ${yieldColor(y)}`}>
                            {y === null ? '—' : `${y}% yield`}
                          </p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* -------- WEEKLY SCHEDULE TAB -------- */}
        {tab === 'schedule' && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-gray-900">Weekly production schedule</h2>
                <p className="text-xs text-gray-400 mt-0.5">Today is <span className="font-medium text-gray-700">{todayShort}</span>. Highlighted days are scheduled runs.</p>
              </div>
              <div className="flex items-center gap-1 text-xs text-gray-500 bg-gray-50 px-3 py-1.5 rounded-full">
                <span className="w-2 h-2 bg-yellow-400 rounded-full" /> today
              </div>
            </div>

            <div className="divide-y divide-gray-50">
              {items.map(i => {
                const scheduledToday = (i.schedule_days || []).includes(todayShort)
                return (
                  <div key={i.id} className={`px-5 py-4 flex items-center gap-4 ${scheduledToday ? 'bg-yellow-50/50' : ''}`}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-gray-900 truncate">{i.name}</p>
                        <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full font-medium ${typeColor[i.type] || 'bg-gray-100 text-gray-600'}`}>
                          {i.type}
                        </span>
                        {scheduledToday && (
                          <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-yellow-400 text-gray-900">
                            Today
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {i.schedule_label || '—'} · par {i.max_qty} {i.unit}
                      </p>
                    </div>
                    <div className="flex gap-1.5">
                      {DAYS.map(d => {
                        const on    = (i.schedule_days || []).includes(d)
                        const today = d === todayShort
                        const base  = 'w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-semibold border'
                        const style = today && on
                          ? 'bg-yellow-400 text-gray-900 border-yellow-400 ring-2 ring-yellow-200'
                          : on
                            ? 'bg-gray-900 text-white border-gray-900'
                            : today
                              ? 'bg-white text-gray-900 border-yellow-400'
                              : 'bg-gray-50 text-gray-400 border-gray-100'
                        return <div key={d} className={`${base} ${style}`}>{d[0]}</div>
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
        {/* -------- MANAGE ITEMS TAB -------- */}
        {tab === 'items' && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-gray-900">Production items</h2>
                <p className="text-xs text-gray-400 mt-0.5">Add, edit, or remove items tracked in Quackmaster.</p>
              </div>
              <button
                onClick={openNewItem}
                className="bg-yellow-400 text-gray-900 text-sm font-bold px-4 py-2 rounded-lg hover:bg-yellow-300 transition-colors"
              >
                + Add item
              </button>
            </div>

            <div className="divide-y divide-gray-50">
              {items.length === 0 && (
                <div className="text-center py-12">
                  <p className="text-gray-400 text-sm">No production items yet. Add one above.</p>
                </div>
              )}
              {items.map(i => (
                <div key={i.id} className="px-5 py-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-gray-900">{i.name}</p>
                      <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full font-medium ${typeColor[i.type] || 'bg-gray-100 text-gray-600'}`}>
                        {i.type}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Unit: {i.unit} · Par: {i.max_qty ?? '—'}
                      {i.schedule_label ? ` · ${i.schedule_label}` : ''}
                      {i.schedule_days?.length > 0 ? ` · ${i.schedule_days.join(', ')}` : ''}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => openEditItem(i)}
                      className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => deleteItem(i)}
                      disabled={deletingItem === i.id}
                      className="text-xs px-3 py-1.5 rounded-lg border border-red-100 text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
                    >
                      {deletingItem === i.id ? '…' : 'Delete'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>

      {/* -------- ITEM MODAL -------- */}
      {itemModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">{editingItem ? 'Edit item' : 'New production item'}</h3>
              <button onClick={() => setItemModal(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>

            <div className="p-6 space-y-4">
              {/* Name */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Name</label>
                <input
                  type="text"
                  value={itemForm.name}
                  onChange={e => setItemForm({ ...itemForm, name: e.target.value })}
                  placeholder="e.g. Braised Duck (whole)"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                />
              </div>

              {/* Type + Unit */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Type</label>
                  <select
                    value={itemForm.type}
                    onChange={e => setItemForm({ ...itemForm, type: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                  >
                    {['protein', 'sauce', 'garnish', 'stock', 'noodle'].map(t => (
                      <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Unit</label>
                  <input
                    type="text"
                    value={itemForm.unit}
                    onChange={e => setItemForm({ ...itemForm, unit: e.target.value })}
                    placeholder="e.g. pcs, kg, L"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                  />
                </div>
              </div>

              {/* Max qty + Schedule label */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Par / Max qty</label>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={itemForm.max_qty}
                    onChange={e => setItemForm({ ...itemForm, max_qty: e.target.value })}
                    placeholder="e.g. 200"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Schedule label</label>
                  <input
                    type="text"
                    value={itemForm.schedule_label}
                    onChange={e => setItemForm({ ...itemForm, schedule_label: e.target.value })}
                    placeholder="e.g. Daily batch"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                  />
                </div>
              </div>

              {/* Schedule days */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-2">Production days</label>
                <div className="flex gap-2 flex-wrap">
                  {DAYS.map(d => {
                    const active = itemForm.schedule_days.includes(d)
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() => toggleScheduleDay(d)}
                        className={`w-10 h-10 rounded-full text-xs font-semibold border transition-colors ${active ? 'bg-gray-900 text-white border-gray-900' : 'bg-gray-50 text-gray-400 border-gray-100 hover:border-gray-300'}`}
                      >
                        {d[0]}
                      </button>
                    )
                  })}
                </div>
                <p className="text-xs text-gray-400 mt-1.5">
                  {itemForm.schedule_days.length > 0 ? itemForm.schedule_days.join(', ') : 'No days selected'}
                </p>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex gap-3">
              <button
                onClick={() => setItemModal(false)}
                className="flex-1 border border-gray-200 text-gray-600 text-sm font-medium py-2.5 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveItem}
                disabled={savingItem}
                className="flex-1 bg-yellow-400 text-gray-900 text-sm font-bold py-2.5 rounded-lg hover:bg-yellow-300 disabled:opacity-50 transition-colors"
              >
                {savingItem ? 'Saving…' : editingItem ? 'Save changes' : 'Add item'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
