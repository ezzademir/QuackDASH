'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'

/**
 * Hook to fetch transfers with realtime updates
 * Handles caching, error states, and subscriptions
 *
 * @param {object} filters - { status?, fromLocationId?, toLocationId?, limit? }
 * @returns { transfers, loading, error, refetch, actionLoading }
 */
export function useTransfers(filters = {}) {
  const supabase = createClient()
  const [transfers, setTransfers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [actionLoading, setActionLoading] = useState(false)

  // Build cache key based on filters
  const cacheKey = JSON.stringify(filters)

  const fetchTransfers = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams()
      if (filters.status) params.append('status', filters.status)
      if (filters.fromLocationId) params.append('from_location_id', filters.fromLocationId)
      if (filters.toLocationId) params.append('to_location_id', filters.toLocationId)
      if (filters.limit) params.append('limit', filters.limit)

      const url = `/api/transfers/list${params.toString() ? `?${params.toString()}` : ''}`
      const res = await fetch(url)

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error?.message || 'Failed to fetch transfers')
      }

      const json = await res.json()
      setTransfers(json.data || [])
    } catch (err) {
      setError(err.message)
      setTransfers([])
    } finally {
      setLoading(false)
    }
  }, [cacheKey]) // Refetch when filters change

  // Subscribe to realtime changes
  useEffect(() => {
    fetchTransfers()

    const channel = supabase
      .channel('transfers-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'stock_transfers' },
        () => {
          // Refetch on any transfer change
          fetchTransfers()
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'transfer_line_items' },
        () => {
          // Refetch on any line item change
          fetchTransfers()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [cacheKey, fetchTransfers, supabase])

  // Action handlers (request, approve, send, receive, cancel)
  const requestTransfer = useCallback(
    async (fromLocationId, toLocationId, items) => {
      setActionLoading(true)
      try {
        const res = await fetch('/api/transfers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'request',
            fromLocationId,
            toLocationId,
            items,
          }),
        })

        const json = await res.json()
        if (!json.success) {
          throw new Error(json.error?.message || 'Failed to create transfer')
        }

        await fetchTransfers() // Refetch after successful action
        return { success: true, data: json.data }
      } catch (err) {
        return { success: false, error: err.message }
      } finally {
        setActionLoading(false)
      }
    },
    [fetchTransfers]
  )

  const approveTransfer = useCallback(
    async (transferId) => {
      setActionLoading(true)
      try {
        const res = await fetch('/api/transfers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'approve', transferId }),
        })

        const json = await res.json()
        if (!json.success) {
          throw new Error(json.error?.message || 'Failed to approve transfer')
        }

        await fetchTransfers()
        return { success: true }
      } catch (err) {
        return { success: false, error: err.message }
      } finally {
        setActionLoading(false)
      }
    },
    [fetchTransfers]
  )

  const sendTransfer = useCallback(
    async (transferId) => {
      setActionLoading(true)
      try {
        const res = await fetch('/api/transfers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'send', transferId }),
        })

        const json = await res.json()
        if (!json.success) {
          throw new Error(json.error?.message || 'Failed to send transfer')
        }

        await fetchTransfers()
        return { success: true }
      } catch (err) {
        return { success: false, error: err.message }
      } finally {
        setActionLoading(false)
      }
    },
    [fetchTransfers]
  )

  const receiveTransfer = useCallback(
    async (transferId) => {
      setActionLoading(true)
      try {
        const res = await fetch('/api/transfers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'receive', transferId }),
        })

        const json = await res.json()
        if (!json.success) {
          throw new Error(json.error?.message || 'Failed to receive transfer')
        }

        await fetchTransfers()
        return { success: true }
      } catch (err) {
        return { success: false, error: err.message }
      } finally {
        setActionLoading(false)
      }
    },
    [fetchTransfers]
  )

  const cancelTransfer = useCallback(
    async (transferId, reason = '') => {
      setActionLoading(true)
      try {
        const res = await fetch('/api/transfers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'cancel', transferId, reason }),
        })

        const json = await res.json()
        if (!json.success) {
          throw new Error(json.error?.message || 'Failed to cancel transfer')
        }

        await fetchTransfers()
        return { success: true }
      } catch (err) {
        return { success: false, error: err.message }
      } finally {
        setActionLoading(false)
      }
    },
    [fetchTransfers]
  )

  return {
    transfers,
    loading,
    error,
    refetch: fetchTransfers,
    actionLoading,
    // Action handlers
    requestTransfer,
    approveTransfer,
    sendTransfer,
    receiveTransfer,
    cancelTransfer,
  }
}
