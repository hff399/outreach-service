import type { Database } from '@outreach/shared/types/supabase.js';

// Helper types for Supabase query results
export type TgAccountRow = Database['public']['Tables']['tg_accounts']['Row'];
export type TgAccountUpdate = Database['public']['Tables']['tg_accounts']['Update'];

export type SequenceRow = Database['public']['Tables']['sequences']['Row'];
export type SequenceUpdate = Database['public']['Tables']['sequences']['Update'];

export type SequenceEnrollmentRow = Database['public']['Tables']['sequence_enrollments']['Row'];
export type SequenceEnrollmentUpdate = Database['public']['Tables']['sequence_enrollments']['Update'];
export type SequenceEnrollmentInsert = Database['public']['Tables']['sequence_enrollments']['Insert'];

export type LeadRow = Database['public']['Tables']['leads']['Row'];
export type LeadUpdate = Database['public']['Tables']['leads']['Update'];

export type MessageRow = Database['public']['Tables']['messages']['Row'];
export type MessageInsert = Database['public']['Tables']['messages']['Insert'];

export type LeadTagRow = Database['public']['Tables']['lead_tags']['Row'];
export type LeadTagInsert = Database['public']['Tables']['lead_tags']['Insert'];

export type ReminderInsert = Database['public']['Tables']['reminders']['Insert'];

export type CampaignRow = Database['public']['Tables']['campaigns']['Row'];
export type CampaignUpdate = Database['public']['Tables']['campaigns']['Update'];
