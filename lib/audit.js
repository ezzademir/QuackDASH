/**
 * Log an auditable action to the audit_logs table.
 *
 * @param {object} supabase  - Supabase client instance
 * @param {object} opts
 * @param {string} opts.table        - Table being affected (e.g. 'locations')
 * @param {string} [opts.recordId]   - ID of the affected record
 * @param {'create'|'update'|'delete'|'restore'} opts.action
 * @param {string} opts.performedBy  - User email
 * @param {string} [opts.summary]    - Human-readable description
 * @param {object} [opts.oldData]    - Snapshot before the change
 * @param {object} [opts.newData]    - Snapshot after the change
 */
export async function logAudit(supabase, {
  table, recordId, action, performedBy, summary, oldData, newData,
}) {
  try {
    await supabase.from('audit_logs').insert({
      table_name:   table,
      record_id:    recordId ? String(recordId) : null,
      action,
      performed_by: performedBy,
      summary:      summary || null,
      old_data:     oldData  || null,
      new_data:     newData  || null,
    })
  } catch (_) {
    // audit_logs table may not exist yet — fail silently so app keeps working
  }
}

/**
 * Get the current user's email from a Supabase client.
 * Returns 'unknown' if not authenticated.
 */
export async function getCurrentUserEmail(supabase) {
  const { data: { user } } = await supabase.auth.getUser()
  return user?.email || 'unknown'
}
