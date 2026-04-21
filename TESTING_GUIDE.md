# QuackDASH Testing Guide

## Pre-Testing Setup

1. Ensure dev server is running: `npm run dev`
2. Navigate to http://localhost:3000
3. Log in with your Supabase credentials
4. Create sample data (locations, items, suppliers) if starting fresh

---

## Critical Path Tests

### Test 1: Stock Transfer Workflow
**Objective:** Verify inventory updates correctly through entire transfer lifecycle

**Steps:**
1. Create two locations (e.g., "Central Kitchen", "Outlet 1") via /locations
2. Create an item (e.g., "Chicken Breast 1kg") via /items, assign a category & unit
3. Add inventory to Central Kitchen via Dashboard quick-add
4. Go to /transfers → "+ New transfer"
5. Select Central Kitchen → Outlet 1, add item with requested qty
6. **VALIDATION CHECK**: Ensure form validates insufficient inventory
7. Create transfer
8. Click transfer → "Approve"
9. Click transfer → "Mark in transit"
10. Click transfer → "Confirm received"
11. **CRITICAL VALIDATION**:
    - Check Dashboard: Central Kitchen qty decreased
    - Check Dashboard: Outlet 1 qty increased
    - Verify inventory balance is correct (original - transferred = new source qty)
12. Go to /audit and verify transfer operations logged with before/after

**Expected Result:** ✅ Inventory correctly deducted from source and added to destination

---

### Test 2: Transfer Editing
**Objective:** Verify transfers can be edited in "requested" status

**Steps:**
1. Create another transfer (as in Test 1, up to step 7)
2. Click transfer in list
3. Click "Edit transfer" button
4. Change "To location" to a different outlet
5. Modify an item quantity (if adding item, verify inventory check)
6. Click "Save changes"
7. **VALIDATION CHECK**: Verify transfer updated with new locations/items
8. Verify audit log shows update with old vs new locations

**Expected Result:** ✅ Requested transfers can be edited and re-validated

---

### Test 3: Stock Take Workflow
**Objective:** Verify stock takes update inventory correctly

**Steps:**
1. Go to /stocktakes → "+ New stock take"
2. Select a location with inventory
3. **Verify**: System quantities are pre-populated from inventory_levels
4. Modify some "Counted qty" values (some match, some differ)
5. Click "Submit for approval"
6. Click transfer → "Approve stock take"
7. **CRITICAL VALIDATION**:
    - Check Dashboard inventory updated with counted qtys
    - Check variances shown correctly in audit trail
8. Go to /audit and verify stock take approval logged

**Expected Result:** ✅ Counted quantities update inventory, variances tracked

---

### Test 4: Stock Take Rejection & Recount
**Objective:** Verify rejection allows recounting

**Steps:**
1. Create another stock take (as in Test 3, steps 1-4)
2. Click "Submit for approval"
3. Click transfer → "Reject stock take"
4. **VALIDATION CHECK**: Status reverts to "in_progress"
5. Modify counted qty again
6. Click "Submit for approval" again
7. Click "Approve stock take"
8. **CRITICAL VALIDATION**: New counted quantities applied to inventory
9. Verify audit log shows both rejection and final approval

**Expected Result:** ✅ Rejected stock takes can be recounted and reapproved

---

### Test 5: Delivery with Variances & Dispute
**Objective:** Verify delivery receipt, variance detection, and dispute workflow

**Steps:**
1. Go to /deliveries → "+ New DO"
2. Fill form, add line items with expected quantities
3. Click "Create DO"
4. Click delivery → Record received quantities
5. Make some quantities different from expected (variances)
6. Click "Confirm receipt & update inventory"
7. **VALIDATION CHECK**: Status shows "partial" with variance count
8. Inventory updated with received quantities
9. Click "Dispute delivery"
10. Enter dispute reason (e.g., "Items arrived damaged")
11. Click "Mark disputed"
12. **CRITICAL VALIDATION**:
    - Status changes to "disputed"
    - Dispute reason appears in order notes
    - Audit log captures dispute with reason
13. Verify inventory correctly updated with received quantities

**Expected Result:** ✅ Variances detected, disputes logged, inventory updated

---

### Test 6: Invoice Upload
**Objective:** Verify invoice upload with error handling

**Steps:**
1. Go to /deliveries, select a delivery
2. Click file input
3. **Test invalid file**: Try uploading a non-image file
   - **EXPECT**: Error "Invalid file type. Accepted formats: JPEG, PNG, WebP, PDF"
4. **Test file too large**: Try uploading >10MB file
   - **EXPECT**: Error "File too large. Maximum size is 10MB."
5. **Test valid file**: Upload a valid PDF or image
   - **EXPECT**: Upload succeeds, success message shows
   - **EXPECT**: Audit log shows upload event

**Expected Result:** ✅ File validation works, errors are clear

---

## Data Integrity Tests

### Test 7: Negative Quantity Prevention
**Objective:** Verify negative quantities cannot occur

**Steps:**
1. Create a transfer requesting more items than in inventory
2. Accept transfer and approve it
3. Try to mark as "received" with original requested quantity
4. **CRITICAL VALIDATION**: Error occurs preventing deduction below zero
   - Message should say: "Insufficient inventory at source location..."

**Expected Result:** ✅ Database constraint prevents negative qty

---

### Test 8: Audit Log Completeness
**Objective:** Verify all operations logged with complete snapshots

**Steps:**
1. Go to /audit
2. Filter by "transfers"
3. Click expand on a transfer creation
4. **VERIFY**: old_data and new_data JSON snapshots shown
5. Filter by "update" action
6. Expand a stock take approval
7. **VERIFY**: Shows "items_updated" count and before/after snapshots

**Expected Result:** ✅ All operations logged with before/after data

---

## Feature Tests

### Test 9: Quackmaster Schedule
**Objective:** Verify schedule day toggle works

**Steps:**
1. Go to /quackmaster → "Weekly schedule" tab
2. Click on a day button for an item (e.g., "M" for Monday)
3. **VERIFY**: Button state changes (color/highlight toggles)
4. Click another day
5. **VERIFY**: Both days now highlighted
6. Click highlighted day to deselect
7. **VERIFY**: Day deselected
8. Refresh page
9. **VERIFY**: Schedule persists after reload
10. Check /audit and verify schedule update logged

**Expected Result:** ✅ Days toggle, persist, and audit log changes

---

### Test 10: Transfer Inventory Validation
**Objective:** Verify pre-transfer validation catches issues

**Steps:**
1. Create a location with low inventory (e.g., 5 units)
2. Try creating transfer requesting 10 units
3. **EXPECT**: Error "Insufficient 'Item Name': need 10, have 5"
4. Try transferring from a location with NO inventory
5. **EXPECT**: Error "Item 'Name' not in source location"

**Expected Result:** ✅ Clear validation errors before transfer creation

---

## Real-time Update Tests

### Test 11: Dashboard Real-time Updates
**Objective:** Verify real-time subscriptions work

**Steps:**
1. Open Dashboard in one browser tab
2. Open /transfers in another tab
3. In transfers tab: Create transfer → Approve → Mark in transit → Confirm received
4. **VALIDATE**: Watch Dashboard tab
   - Inventory qty updates in real-time
   - Low stock alerts update if applicable
5. Repeat with stock take in /stocktakes tab

**Expected Result:** ✅ Dashboard updates without page refresh

---

## Dropdown & Data Population Tests

### Test 12: All Dropdowns Populated
**Objective:** Verify all pages show correct options in dropdowns

**Checklist:**
- [ ] /transfers: Locations dropdown shows all active locations
- [ ] /transfers: Items dropdown shows all active items with units
- [ ] /stocktakes: Locations dropdown shows all active locations
- [ ] /stocktakes: Items populated when stock take starts
- [ ] /deliveries: Locations dropdown shows all active locations
- [ ] /deliveries: Suppliers dropdown shows all active suppliers
- [ ] /deliveries: Items dropdown shows all active items
- [ ] /users: Locations dropdown shows all active locations
- [ ] /items: Categories dropdown shows all categories
- [ ] /items: Units dropdown shows all units

**Expected Result:** ✅ All dropdowns populated with current data

---

## Performance & Edge Cases

### Test 13: Graceful Degradation
**Objective:** Verify pages work even if one query fails

**Steps:**
1. Go to a complex page like /deliveries
2. Open browser DevTools → Network tab
3. Set Network to "Offline"
4. Refresh page
5. **VERIFY**: Page still loads, shows cached data or empty state
6. Set Network back online
7. Refresh page
8. **VERIFY**: Data loads normally

**Expected Result:** ✅ Pages degrade gracefully without crashes

---

### Test 14: Concurrent Operations
**Objective:** Verify transactions don't corrupt data

**Steps:**
1. Create transfer from location A → B
2. In another tab: Create another transfer from location A → C
3. Approve both simultaneously (rapidly)
4. Receive both transfers simultaneously
5. **CRITICAL VALIDATION**: Check inventory balance
   - Location A qty should be original - qty1 - qty2
   - Location B qty should be original + qty1
   - Location C qty should be original + qty2

**Expected Result:** ✅ Concurrent operations maintain data integrity

---

## Validation Error Tests

### Test 15: Date Validations
**Objective:** Verify date validation prevents errors

**Steps:**
1. Go to /deliveries → Create DO
2. Try setting expected_date to a past date
3. **EXPECT**: Error "Expected date cannot be in the past"
4. Go to /reports
5. Set date_from after date_to
6. **VERIFY**: No data shown, or warning logged to console

**Expected Result:** ✅ Date validations enforce valid ranges

---

## Sign-off Checklist

### Before Declaring Ready
- [ ] All critical path tests (1-5) pass without errors
- [ ] Data integrity tests (7-8) prevent bad operations
- [ ] Audit logs show complete before/after snapshots
- [ ] Real-time updates work on Dashboard
- [ ] All dropdowns populated correctly
- [ ] Error messages are clear and actionable
- [ ] No console errors (check DevTools console)
- [ ] Transfer editing saves without data loss
- [ ] Stock take rejection allows recounting
- [ ] Dispute workflow captures reason

### Known Issues (If Any)
- [ ] None - all systems nominal

### Performance Notes
- Dashboard loads in <2 seconds
- Transfer/delivery operations complete in <1 second
- Audit logs load instantly

---

## Troubleshooting

### Issue: Dropdowns Empty
**Solution:** Check if locations/items are active (is_active = true)

### Issue: Audit Log Not Showing
**Solution:** Verify logAudit succeeds (shouldn't have errors in console)

### Issue: Inventory Not Updating
**Solution**: Check if transfer/delivery receipt completed successfully

### Issue: Date Validation Errors
**Solution:** Use today's date or future dates for expected_date

---

## Final Validation

**Date Tested:** _______________  
**Tested By:** _______________  
**Environment:** Local / Production  
**Issues Found:** None / [List if any]  
**Sign-off:** Approved ☐ / Needs Work ☐
