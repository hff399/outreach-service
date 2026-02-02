# CRITICAL: Database Migration Required

## Issue
The `sequence_enrollments` table is missing columns required for the auto-responder feature to work.

## How to Fix

### Option 1: Automated Script (Recommended)

Run the migration script from the project root:

```bash
node scripts/apply-migration.mjs
```

The script will:
- Check if columns already exist
- Execute the migration via Supabase API
- Provide clear success/error output
- Show manual SQL fallback if needed

### Option 2: Manual SQL Execution

1. Open your Supabase Dashboard: https://supabase.com/dashboard/project/syrqegtfuenfftkssaoe/sql/new

2. Paste and run this SQL:

```sql
-- Add missing columns to sequence_enrollments table
ALTER TABLE public.sequence_enrollments
ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES public.tg_accounts(id) ON DELETE SET NULL;

ALTER TABLE public.sequence_enrollments
ADD COLUMN IF NOT EXISTS waiting_for VARCHAR(20);

ALTER TABLE public.sequence_enrollments
ADD COLUMN IF NOT EXISTS wait_until TIMESTAMPTZ;

-- Add indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_sequence_enrollments_waiting
ON public.sequence_enrollments(waiting_for) WHERE waiting_for IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sequence_enrollments_account
ON public.sequence_enrollments(account_id);
```

3. Click "Run" to execute the migration

4. Restart the backend server

## Verification

After running the migration, you can verify it worked by running:

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'sequence_enrollments';
```

You should see `account_id`, `waiting_for`, and `wait_until` in the results.
