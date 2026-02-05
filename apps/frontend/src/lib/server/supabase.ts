import { createClient } from '@supabase/supabase-js';
import { config } from './config';

// Server-side Supabase client with service role key
export const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);
