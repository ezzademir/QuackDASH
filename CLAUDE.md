# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start Next.js dev server (http://localhost:3000)
npm run build    # Production build
npm run start    # Production server
npm run lint     # ESLint
```

No test suite is configured. Verify behaviour by running the dev server and using the browser.

## Common Gotchas

### Schema Cache Not Reloading
**Symptom:** "Could not find the table 'public.X' in the schema cache" error
**Cause:** PostgREST hasn't reloaded after a new table was created or altered
**Fix:** Run `NOTIFY pgrst 'reload schema'` in Supabase SQL Editor

### Dashboard Stuck on Loading Spinner
**Symptom:** Page shows "Loading QuackDASH..." indefinitely
**Cause:** One query failed silently, Promise.all rejected the entire batch
**Fix:** Wrap fetch in try/catch/finally, use Promise.allSettled instead of Promise.all, add graceful fallback queries

### Graceful Fallback Queries
**Why:** Migrations roll out over time; not all environments have all columns yet. App must degrade gracefully.
```javascript
// Try with deleted_at column; if it doesn't exist, fallback
let inv = await supabase.from('inventory_levels').select('*, deleted_at')
if (inv.error) {
  inv = await supabase.from('inventory_levels').select('*')
}
```

### Code Reuse After Soft-Delete Fails
**Symptom:** "Duplicate key violates unique constraint" when re-adding location with same code
**Cause:** UNIQUE constraint on code allows no duplicates (even soft-deleted ones)
**Fix:** Use filtered unique index: `CREATE UNIQUE INDEX locations_code_unique ON locations(code) WHERE deleted_at IS NULL`

### Enum Type Conversion Blocked
**Symptom:** "Cannot alter type of column used in policy" when converting enum to text
**Cause:** RLS policies or dependent views reference the column
**Fix:** Drop policies and views first, alter column, recreate policies/views

### Deactivate vs Soft-Delete Confusion
- **Deactivate** (`is_active: false`) — Temporary hide, can reactivate, visible in reports
- **Soft-delete** (`deleted_at IS NOT NULL`) — Permanent archive, hides from all queries, preserves history
- Always filter dashboard with `is_active !== false` to hide deactivated items
- Always filter queries with `.is('deleted_at', null)` or `activeOnly()` to exclude soft-deleted items

## Environment Variables

Three env vars are required in `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY   # Server-only — used in /api/invite only
```

## Architecture

**Stack:** Next.js 16 (App Router) · React 19 · Supabase (Postgres + Auth + Realtime) · Tailwind CSS 4

### Auth & Middleware

`proxy.js` is the auth guard middleware. It uses `@supabase/ssr` to read session cookies server-side, redirects unauthenticated users to `/login`, and redirects authenticated users away from `/login`. Matcher skips `_next/static`, `_next/image`, `favicon.ico`, and all `/api/*` routes.

User creation bypasses email invite — `POST /api/invite` uses the service role key to call `supabase.auth.admin.createUser` directly, then upserts `user_profiles` with the chosen role.

### Page Pattern

Every page is a `'use client'` component. They all follow the same structure:

1. `createClient()` from `lib/supabase` (browser client only — never server-side in pages)
2. Fetch all required data in parallel using `Promise.allSettled()` for resilience — one failed query doesn't block the page
3. Supabase Realtime subscription (`.channel()` + `.subscribe()`) for live updates
4. Mutations wrapped in try/catch/finally to surface error messages and prevent infinite loading
5. Audit logging via `lib/audit.js` after every write
6. Graceful fallback queries: try with new schema columns, catch, fallback without them

Example fetch pattern:
```javascript
async function fetchAll() {
  setLoading(true)
  try {
    // Try with new columns (e.g., deleted_at); gracefully fallback if missing
    let inv = await supabase.from('table').select('*, column_that_might_not_exist')
    if (inv.error) {
      inv = await supabase.from('table').select('*')
    }
    
    // Use Promise.allSettled for parallel queries — one failure won't reject all
    const results = await Promise.allSettled([
      supabase.from('table1').select('*'),
      supabase.from('table2').select('*'),
    ])
    const [t1, t2] = results.map(r => r.status === 'fulfilled' ? r.value : { data: [] })
  } catch (err) {
    console.error('fetchAll failed:', err)
  } finally {
    setLoading(false)
  }
}
```

There are no shared layout components, providers, or context. Headers, modals, and nav are duplicated per page.

### Shared Utilities

| File | Purpose |
|---|---|
| `lib/supabase.js` | `createClient()` — browser Supabase client factory |
| `lib/audit.js` | `logAudit()` + `getCurrentUserEmail()` — write to `audit_logs` table; fails silently if table doesn't exist |
| `lib/db.js` | `activeOnly(supabase, table, buildQuery)` — wraps any query with `.is('deleted_at', null)` filter; falls back to unfiltered if the column doesn't exist |

### Data Model

**Inventory core:**
- `locations` → `name`, `type` (central_kitchen | outlet)
- `items` → `name`, `sku`, `category_id`, `unit_id`, `reorder_level`, `is_active`
- `inventory_levels` → `location_id`, `item_id`, `quantity`
- `categories`, `units` — lookup tables

**Stock movements:**
- `stock_transfers` + `transfer_line_items` — inter-location transfers with workflow: requested → approved → in_transit → received | cancelled
- `stock_takes` + `stock_take_items` — physical counts with system vs counted variance
- `delivery_orders` + `do_line_items` — inbound supplier orders; `price_history` records unit prices per delivery

**Procurement:**
- `suppliers` → contact info

**Quackmaster (production module — integrated with inventory):**
- `qm_production_items` → name, type, unit, max_qty, schedule_days (array), schedule_label, **item_id** (FK to items)
- `qm_stock_levels` → one row per production item; syncs to central_kitchen `inventory_levels`
- `qm_production_logs` → planned vs actual production with yield %; actual qty automatically added to central kitchen inventory

**Users & audit:**
- `user_profiles` → mirrors `auth.users.id` as PK; adds `full_name`, `role` (admin | central_kitchen | outlet_manager | outlet_staff | procurement), `location_id`
- `audit_logs` → table_name, record_id, action (create | update | delete | restore), performed_by (email), performed_at, summary, old_data (JSONB), new_data (JSONB)

### Soft Delete

`locations`, `items`, `qm_production_items`, `suppliers` use soft delete: `deleted_at TIMESTAMPTZ` + `deleted_by TEXT`. Deletion sets these fields rather than removing the row. All queries use `activeOnly()` or `.is('deleted_at', null)` to exclude soft-deleted rows. The `audit_logs` table records every deletion with a snapshot of the old data.

**Code Reuse After Soft-Delete:** Instead of UNIQUE constraints on the entire column (which would prevent code reuse), use filtered unique indexes:
```sql
CREATE UNIQUE INDEX locations_code_unique ON locations(code) WHERE deleted_at IS NULL
```
This allows the same location code or item SKU to be reused after soft-deletion, while preserving the entire audit history.

**Graceful Fallback:** The app degrades gracefully if audit columns haven't been added yet. Queries try with `deleted_at`, catch the error, and fallback without it:
```javascript
let data = await supabase.from('table').select('*, deleted_at').is('deleted_at', null)
if (data.error) {
  data = await supabase.from('table').select('*')  // Fallback for pre-migration environments
}
```

### Active vs Soft Delete (Deactivate vs Delete)

Two separate mechanisms control visibility:

**`is_active` (boolean) — Deactivate**
- User-visible toggle for business logic (temporarily hide items/locations without losing data)
- Deactivated records remain visible in audit logs and reports
- Can be toggled on/off without losing history
- Example: "Deactivate Outlet A" to pause operations, then "Reactivate" later

**`deleted_at` — Soft Delete (Permanent Archive)**
- Hides records completely from normal queries (via `.is('deleted_at', null)`)
- Preserves complete audit history
- Intended for genuine deletion (e.g., user deletes a location from the database)

**Dashboard Pattern:** The dashboard filters for active locations only:
```javascript
const activeLocations = locations.filter(l => l.is_active !== false)
// Then use activeLocations in stat cards, tabs, and location list
```

This filters out `is_active: false` records while still returning all non-soft-deleted records. Always check: should the UI show deactivated items? Usually no — use the `is_active` filter.

**Locations Specifically:** Added `is_active` column for deactivate/reactivate toggle (separate from soft-delete). Locations page shows a toggle button that switches between "Deactivate" and "Reactivate" with appropriate styling.

**Items Specifically:** Also use `is_active` toggle. The dashboard filters inventory with `.eq('is_active', true)` on the joined items table.

### Roles

Five roles stored in `user_profiles.role`. No role enforcement in client code — access control is enforced via Supabase RLS at the database layer.

### Real-time Subscriptions

Dashboard and other pages subscribe to table changes for live updates:
```javascript
function subscribeToInventory() {
  const channel = supabase
    .channel('inventory-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_levels' }, () => fetchAll())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_transfers' }, () => fetchAll())
    .subscribe()
  return () => supabase.removeChannel(channel)
}
```
Unsubscribe in cleanup: `useEffect(() => { subscribeToInventory() }, [])` returns the cleanup function.

### Quackmaster Integration (Production → Inventory Flow)

**Problem Solved:** Quackmaster production was siloed in `qm_stock_levels` and invisible to the main inventory system. Now production flows into central kitchen's `inventory_levels`.

**How it works:**
1. **Link**: `qm_production_items.item_id` FK → `items.id` (matches production items to inventory items)
2. **Stock Take Sync** (manual adjustment):
   - When `saveStockTake()` updates `qm_stock_levels` quantities
   - Automatically syncs to central_kitchen's `inventory_levels` with same qty
3. **Production Log Sync** (incremental):
   - When `saveLog()` logs production (actual_qty)
   - Adds actual_qty to central_kitchen's `inventory_levels` for that item
4. **Dashboard Visibility**:
   - Fetches both `inventory_levels` and `qm_stock_levels`
   - Includes QM stock in total inventory value
   - Subscribes to `qm_production_logs` and `qm_stock_levels` changes for realtime updates

**Data Flow Example:**
```
User sets Quackmaster stock: Duck Broth 100kg
  ↓
saveStockTake() updates qm_stock_levels.qty = 100
  ↓
Automatically syncs to inventory_levels (central_kitchen, duck_broth) = 100
  ↓
Dashboard shows total inventory includes 100kg duck broth
  ↓
User can transfer duck broth to outlets via /transfers
```

**Error Handling:** All sync operations wrapped in try/catch. If sync fails, user sees error message and QM stock is NOT saved to prevent data inconsistency.

### Navigation

The dashboard (`app/page.js`) is the only page with the full nav + user profile fetch. Other pages have their own header with a subset nav. Adding a new page requires manually adding a Link to every page's header nav array.

### Pages Overview

| Page | Purpose | Key Pattern |
|------|---------|------------|
| `/` | Dashboard | Inventory overview, stat cards (active locations, items tracked, low-stock alerts, active transfers), real-time subscriptions |
| `/items` | Item catalog | Create/edit/deactivate items, assign categories & units, set reorder levels, quick-add category/unit forms |
| `/locations` | Location CRUD | Create/edit locations (central kitchen or outlet), toggle `is_active` (deactivate/reactivate), soft-delete |
| `/transfers` | Stock transfers | Request/approve/send transfers between locations, track with line items |
| `/stocktakes` | Physical inventory counts | Start stock take, count items vs. system qty, record variances |
| `/procurement` | Inbound PO tracking | Create delivery orders, receive items, record variances |
| `/users` | User management | Create/edit users, assign roles, toggle active status |
| `/quackmaster` | Admin panel | Manage categories, units, suppliers, production items |
| `/reports` | Analytics | Low-stock alerts, reorder recommendations, stock value by location |
| `/audit` | Change log | View audit_log entries, filter by table/user/action, inspect old_data/new_data diffs |

### Bootstrap & Migration Strategy

**Initial Setup (`schema_bootstrap.sql`):**
Runs first and is idempotent (safe to run multiple times). Creates core tables if missing:
- `categories`, `units` (lookup tables)
- `locations`, `items`, `inventory_levels` (core inventory)
- Seeds 8 common units (kg, g, L, ml, pc, pkt, btl, box)
- Seeds 8 categories (Noodles, Proteins, Sauces, Vegetables, Garnishes, Beverages, Packaging, Cleaning)

**Subsequent Migrations:**
Applied in numbered order. Key migrations include:
- `bridge_items_to_app_schema` — Adds sku, category_id, unit_id, reorder_level columns
- `bridge_all_tables_to_app_schema` — Converts enums (status, role) to text; creates line-item tables
- `fix_locations_code_soft_delete_reuse` — Adds filtered unique index for code reuse after soft-delete
- `auto_generate_locations_code` — Auto-generates location codes on insert

**PostgREST Cache Reload:**
After applying migrations, notify PostgREST to reload:
```sql
NOTIFY pgrst 'reload schema'
```
If tables don't appear in API responses, the cache likely hasn't reloaded.
