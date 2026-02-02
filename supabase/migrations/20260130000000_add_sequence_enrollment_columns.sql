-- ==========================================
-- Add missing columns to sequence_enrollments table
-- ==========================================

-- Add account_id column (which TG account should send messages)
ALTER TABLE public.sequence_enrollments
ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES public.tg_accounts(id) ON DELETE SET NULL;

-- Add waiting_for column (for wait step conditions: 'reply', 'no_reply', 'time')
ALTER TABLE public.sequence_enrollments
ADD COLUMN IF NOT EXISTS waiting_for VARCHAR(20);

-- Add wait_until column (timeout for wait conditions)
ALTER TABLE public.sequence_enrollments
ADD COLUMN IF NOT EXISTS wait_until TIMESTAMPTZ;

-- Add index for efficient querying of waiting enrollments
CREATE INDEX IF NOT EXISTS idx_sequence_enrollments_waiting
ON public.sequence_enrollments(waiting_for) WHERE waiting_for IS NOT NULL;

-- Add index for account_id lookups
CREATE INDEX IF NOT EXISTS idx_sequence_enrollments_account
ON public.sequence_enrollments(account_id);
