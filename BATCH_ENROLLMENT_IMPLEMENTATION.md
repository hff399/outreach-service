# Batch Enrollment Implementation

## Summary
Implemented batch enrollment of existing leads when a sequence is activated. This allows autoresponse to work for messages received BEFORE the campaign started.

## Changes Made

### 1. `/apps/backend/src/services/sequence-trigger.ts`

Added new exported function `batchEnrollExistingLeads`:

**Functionality:**
- Finds all leads who have sent incoming messages to the sequence's assigned accounts
- Deduplicates leads (a lead may have multiple messages)
- Checks if lead is already enrolled (skips if active/paused enrollment exists)
- Skips leads for keyword/regex triggers (these need real-time message matching)
- Enrolls eligible leads using the existing `enrollLead` function
- Returns stats: `{ enrolled: number; skipped: number }`

**Behavior:**
- For 'any' or 'new_message' triggers: All leads with incoming messages are eligible
- For 'keyword' or 'regex' triggers: Batch enrollment is skipped (requires real-time message content matching)
- Uses lead's `assigned_account_id` or falls back to first assigned account

### 2. `/apps/backend/src/routes/sequences.ts`

Modified the `/api/sequences/:id/activate` endpoint:

**Changes:**
- Added import for `batchEnrollExistingLeads` function and `Sequence` type
- After activating sequence, calls `batchEnrollExistingLeads` in background
- Runs asynchronously to not block the API response
- Logs results (enrolled/skipped counts) to console

## How It Works

1. **User activates sequence** via POST `/api/sequences/:id/activate`
2. **Sequence status updated** to 'active' in database
3. **API responds immediately** with success
4. **Background process starts:**
   - Queries all leads with incoming messages on assigned accounts
   - Filters out already-enrolled leads
   - For 'any'/'new_message' triggers: enrolls all eligible leads
   - For 'keyword'/'regex' triggers: skips (needs real-time matching)
5. **Logs completion** with enrollment statistics

## Testing Notes

**TypeScript Compilation:**
The code will show TypeScript errors until the database migration is applied and types are regenerated. This is expected.

**Required Migration:**
The migration file already exists: `supabase/migrations/20260130000000_add_sequence_enrollment_columns.sql`

To apply:
1. Run the migration in production Supabase dashboard
2. Regenerate types: `npx supabase gen types typescript --project-id YOUR_PROJECT_ID > packages/shared/src/types/supabase.ts`
3. TypeScript errors will resolve

**Test Scenario:**
1. Create leads with incoming messages (before sequence activation)
2. Create a sequence with trigger type 'any' or 'new_message'
3. Assign TG accounts to the sequence
4. Activate the sequence via POST `/api/sequences/:id/activate`
5. Check server logs for batch enrollment stats
6. Verify leads are enrolled in `sequence_enrollments` table
7. Verify first step executes for enrolled leads

## Files Modified

1. `apps/backend/src/services/sequence-trigger.ts` - Added `batchEnrollExistingLeads` function
2. `apps/backend/src/routes/sequences.ts` - Added batch enrollment call on sequence activation

## Database Schema Notes

The implementation uses the new `account_id` column in `sequence_enrollments` table, which tracks which TG account should send messages for each enrollment. The migration adds:
- `account_id` (UUID) - References tg_accounts table
- `waiting_for` (VARCHAR) - For wait step conditions
- `wait_until` (TIMESTAMPTZ) - For wait step timeouts
