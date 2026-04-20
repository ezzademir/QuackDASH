/**
 * Fetch rows from a table filtering out soft-deleted records.
 * Falls back to an unfiltered query if the deleted_at column doesn't exist yet
 * (i.e. the audit migration hasn't been run).
 *
 * @param {Function} buildQuery  - Receives a Supabase query builder and returns it
 *                                 with .select(), .order(), etc. chained on.
 * @example
 *   const locs = await activeOnly(supabase, 'locations',
 *     q => q.select('*').order('name'))
 */
export async function activeOnly(supabase, table, buildQuery) {
  const { data, error } = await buildQuery(
    supabase.from(table).is('deleted_at', null)
  )
  if (error) {
    // deleted_at column likely doesn't exist yet — fall back to all rows
    const { data: fallback } = await buildQuery(supabase.from(table))
    return { data: fallback ?? [] }
  }
  return { data: data ?? [] }
}
