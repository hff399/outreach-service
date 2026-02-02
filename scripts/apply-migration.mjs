#!/usr/bin/env node
/**
 * Migration script to add missing columns to sequence_enrollments table.
 *
 * Usage:
 *   node scripts/apply-migration.mjs
 *
 * Uses Supabase service role key to execute SQL directly via PostgREST.
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from project root
dotenv.config({ path: join(__dirname, '..', '.env') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('ERROR: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

// Create Supabase client with service role (bypasses RLS)
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false }
});

const MIGRATIONS = [
  {
    name: 'Add account_id column',
    sql: `ALTER TABLE public.sequence_enrollments ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES public.tg_accounts(id) ON DELETE SET NULL;`
  },
  {
    name: 'Add waiting_for column',
    sql: `ALTER TABLE public.sequence_enrollments ADD COLUMN IF NOT EXISTS waiting_for VARCHAR(20);`
  },
  {
    name: 'Add wait_until column',
    sql: `ALTER TABLE public.sequence_enrollments ADD COLUMN IF NOT EXISTS wait_until TIMESTAMPTZ;`
  },
  {
    name: 'Create index on waiting_for',
    sql: `CREATE INDEX IF NOT EXISTS idx_sequence_enrollments_waiting ON public.sequence_enrollments(waiting_for) WHERE waiting_for IS NOT NULL;`
  },
  {
    name: 'Create index on account_id',
    sql: `CREATE INDEX IF NOT EXISTS idx_sequence_enrollments_account ON public.sequence_enrollments(account_id);`
  }
];

/**
 * Execute SQL via Supabase PostgREST API directly
 */
async function executeSql(sql) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseServiceKey,
      'Authorization': `Bearer ${supabaseServiceKey}`,
      'Prefer': 'return=representation'
    },
    body: JSON.stringify({ query: sql })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  return response;
}

/**
 * Check if columns already exist by attempting a select
 */
async function checkExistingColumns() {
  console.log('Checking existing columns...');

  const { data, error } = await supabase
    .from('sequence_enrollments')
    .select('account_id, waiting_for, wait_until')
    .limit(1);

  if (error) {
    // If error mentions missing columns, they don't exist yet
    if (error.message.includes('account_id') ||
        error.message.includes('waiting_for') ||
        error.message.includes('wait_until')) {
      console.log('  Some columns are missing - migration needed.\n');
      return false;
    }
    console.log('  Warning: Could not verify columns:', error.message);
    return false;
  }

  console.log('  All columns already exist!\n');
  return true;
}

/**
 * Run migrations using direct SQL execution
 */
async function runMigration() {
  console.log('='.repeat(60));
  console.log('APPLYING SEQUENCE ENROLLMENTS MIGRATION');
  console.log('='.repeat(60));
  console.log(`Supabase URL: ${supabaseUrl}`);
  console.log('');

  let successCount = 0;
  let errorCount = 0;
  const failedMigrations = [];

  for (const migration of MIGRATIONS) {
    process.stdout.write(`  ${migration.name}... `);
    try {
      await executeSql(migration.sql);
      console.log('✓');
      successCount++;
    } catch (err) {
      console.log('✗');
      console.log(`    Error: ${err.message}`);
      errorCount++;
      failedMigrations.push(migration);
    }
  }

  console.log('');
  console.log(`Results: ${successCount} succeeded, ${errorCount} failed`);

  if (errorCount > 0) {
    console.log('');
    console.log('-'.repeat(60));
    console.log('Some migrations failed. Please run this SQL manually in Supabase Dashboard:');
    console.log(`https://supabase.com/dashboard/project/syrqegtfuenfftkssaoe/sql/new`);
    console.log('');
    console.log('SQL to run:');
    console.log('');
    failedMigrations.forEach(m => {
      console.log(`-- ${m.name}`);
      console.log(m.sql);
      console.log('');
    });
    console.log('-'.repeat(60));
  } else {
    console.log('✓ All migrations applied successfully!');
  }

  console.log('');
  console.log('='.repeat(60));
}

async function main() {
  const columnsExist = await checkExistingColumns();

  if (columnsExist) {
    console.log('Migration already applied. Nothing to do.');
    return;
  }

  await runMigration();
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
