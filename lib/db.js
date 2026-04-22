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
  const q = supabase.from(table)
  let query = buildQuery(q)
  query = query.is('deleted_at', null)
  const { data, error } = await query

  if (error) {
    // deleted_at column likely doesn't exist yet — fall back to all rows
    const { data: fallback } = await buildQuery(supabase.from(table))
    return { data: fallback ?? [] }
  }
  return { data: data ?? [] }
}
