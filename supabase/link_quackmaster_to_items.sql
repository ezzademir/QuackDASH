-- Link Quackmaster production items to main inventory items
-- This enables production data to flow into central kitchen inventory

-- 1. Add item_id column to qm_production_items if it doesn't exist
ALTER TABLE qm_production_items ADD COLUMN IF NOT EXISTS item_id UUID REFERENCES items(id) ON DELETE SET NULL;

-- 2. Link existing qm_production_items to items by name (case-insensitive)
UPDATE qm_production_items qm
SET item_id = i.id
FROM items i
WHERE LOWER(qm.name) = LOWER(i.name)
  AND qm.item_id IS NULL;

-- 3. Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_qm_production_items_item_id ON qm_production_items(item_id);

-- 4. Add central_kitchen_location_id to qm_stock_levels to track where production is stored
-- (Alternatively, we hardcode it in the app to the first central_kitchen location)
-- For now, keeping it simple: all Quackmaster stock belongs to central kitchen

-- 5. Ensure RLS allows access
ALTER TABLE qm_production_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "qm_production_items read" ON qm_production_items;
DROP POLICY IF EXISTS "qm_production_items write" ON qm_production_items;
CREATE POLICY "qm_production_items read"  ON qm_production_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "qm_production_items write" ON qm_production_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
