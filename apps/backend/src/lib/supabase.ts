import { createClient } from '@supabase/supabase-js';
import { appConfig } from './config.js';
import type { Database } from '@outreach/shared/types/supabase.js';

export const supabase = createClient<Database>(
  appConfig.supabase.url,
  appConfig.supabase.serviceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);
