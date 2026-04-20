'use client'

import { useEffect, useState } from 'react'
import { createClient } from '../../lib/supabase'
import Link from 'next/link'

const ACTION_STYLE = {
  create:  'bg-green-100 text-green-700',
  update:  'bg-blue-100 text-blue-700',
  delete:  'bg-red-100 text-red-700',
  restore: 'bg-purple-100 text-purple-700',
}

const TABLE_LABEL = {
  locations:          'Locations',
  items:              'Items',
  qm_production_items: 'Production Items',
  suppliers:          'Suppliers',
  stock_transfers:    'Transfers',
  stock_takes:        'Stock Takes',
  delivery_orders:    'Deliveries',
  user_profiles:      'Users',
}

export default function AuditPage() {
  const supabase = createClient()
  const [logs, setLogs]       = useState([])
  const [loading, setLoading] = useState(true)
  const [filterTable, setFilterTable] = useState('all')
  const [filterAction, setFilterAction] = useState('all')
  const [expanded, setExpanded] = useState(null)
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 50

  useEffect(() => { fetchLogs() }, [filterTable, filterAction, page])

  async function fetchLogs() {
    setLoading(true)
    let q = supabase
      .from('audit_logs')
      .select('*')
      .order('performed_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (filterTable  !== 'all') q = q.eq('table_name', filterTable)
    if (filterAction !== 'all') q = q.eq('action', filterAction)

    const { data } = await q
    if (data) setLogs(data)
    setLoading(false)
  }

  function fmtDate(iso) {
    return new Date(iso).toLocaleString('en-MY', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  }

  const tables  = Object.keys(TABLE_LABEL)
  const actions = ['create', 'update', 'delete', 'restore']

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Header */}
      <header className="bg-gray-900 text-white">
        <div className="px-4 py-3 flex items-center gap-2.5">
          <Link href="/" className="w-8 h-8 bg-yellow-400 rounded-full flex items-center justify-center text-gray-900 font-bold text-sm shrink-0">Q</Link>
          <div>
            <h1 className="font-bold text-base leading-none">Audit Log</h1>
            <p className="text-gray-400 text-[10px] mt-0.5">All changes across QuackDASH</p>
          </div>
        </div>
        <div className="px-4 pb-2 flex gap-1 overflow-x-auto scrollbar-none">
          {[
            { href: '/',            label: 'Dashboard' },
            { href: '/items',       label: 'Items' },
            { href: '/transfers',   label: 'Transfers' },
            { href: '/stocktakes',  label: 'Stock takes' },
            { href: '/deliveries',  label: 'Deliveries' },
            { href: '/quackmaster', label: 'Quackmaster' },
            { href: '/locations',   label: 'Locations' },
            { href: '/reports',     label: 'Reports' },
            { href: '/users',       label: 'Users' },
          ].map(({ href, label }) => (
            <Link key={href} href={href} className="shrink-0 text-yellow-400 text-xs px-3 py-1.5 rounded-full hover:bg-gray-800 transition-colors whitespace-nowrap">
              {label}
            </Link>
          ))}
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">

        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          <select
            value={filterTable}
            onChange={e => { setFilterTable(e.target.value); setPage(0) }}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-yellow-400 bg-white"
          >
            <option value="all">All tables</option>
            {tables.map(t => <option key={t} value={t}>{TABLE_LABEL[t]}</option>)}
          </select>
          <select
            value={filterAction}
            onChange={e => { setFilterAction(e.target.value); setPage(0) }}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-yellow-400 bg-white"
          >
            <option value="all">All actions</option>
            {actions.map(a => <option key={a} value={a}>{a.charAt(0).toUpperCase() + a.slice(1)}</option>)}
          </select>
        </div>

        {/* Log list */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-8 h-8 border-4 border-yellow-400 border-t-transparent rounded-full animate-spin"/>
            </div>
          ) : logs.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-gray-400 text-sm">No audit entries yet.</p>
              <p className="text-gray-400 text-xs mt-1">Actions across the app will appear here.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {logs.map(log => (
                <div key={log.id}>
                  <button
                    onClick={() => setExpanded(expanded === log.id ? null : log.id)}
                    className="w-full px-5 py-3 flex items-start gap-3 hover:bg-gray-50 transition-colors text-left"
                  >
                    {/* Action badge */}
                    <span className={`shrink-0 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full mt-0.5 ${ACTION_STYLE[log.action] || 'bg-gray-100 text-gray-600'}`}>
                      {log.action}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-900 truncate">{log.summary || `${log.action} on ${log.table_name}`}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        <span className="font-medium text-gray-600">{log.performed_by}</span>
                        {' · '}
                        {TABLE_LABEL[log.table_name] || log.table_name}
                        {' · '}
                        {fmtDate(log.performed_at)}
                      </p>
                    </div>
                    <span className="text-gray-300 text-xs shrink-0">{expanded === log.id ? '▲' : '▼'}</span>
                  </button>

                  {expanded === log.id && (log.old_data || log.new_data) && (
                    <div className="px-5 pb-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {log.old_data && (
                        <div className="bg-red-50 rounded-lg p-3">
                          <p className="text-[10px] font-bold uppercase text-red-500 mb-2">Before</p>
                          <pre className="text-xs text-red-800 whitespace-pre-wrap break-all">
                            {JSON.stringify(log.old_data, null, 2)}
                          </pre>
                        </div>
                      )}
                      {log.new_data && (
                        <div className="bg-green-50 rounded-lg p-3">
                          <p className="text-[10px] font-bold uppercase text-green-500 mb-2">After</p>
                          <pre className="text-xs text-green-800 whitespace-pre-wrap break-all">
                            {JSON.stringify(log.new_data, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pagination */}
        <div className="flex justify-between items-center">
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            className="text-sm px-4 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors"
          >
            ← Previous
          </button>
          <span className="text-xs text-gray-400">Page {page + 1}</span>
          <button
            onClick={() => setPage(p => p + 1)}
            disabled={logs.length < PAGE_SIZE}
            className="text-sm px-4 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors"
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  )
}
