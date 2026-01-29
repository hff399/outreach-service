-- Add custom_message column to campaigns table
-- This allows campaigns to have a custom message instead of using a template

ALTER TABLE public.campaigns
ADD COLUMN IF NOT EXISTS custom_message TEXT;

COMMENT ON COLUMN public.campaigns.custom_message IS 'Custom message content when not using a template';
