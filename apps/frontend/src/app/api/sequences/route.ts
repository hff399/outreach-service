import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabase } from '@/lib/server/supabase';

const stepConditionSchema = z.object({
  type: z.enum(['no_reply', 'replied', 'keyword_match', 'status_is', 'has_tag']),
  value: z.string().optional(),
  timeout_minutes: z.number().optional(),
});

const stepSchema = z.object({
  id: z.string().uuid().optional(),
  order: z.number().min(0),
  type: z.enum(['message', 'status_change', 'reminder', 'wait', 'branch', 'tag', 'assign', 'webhook']),
  delay_minutes: z.number().min(0).default(0),
  conditions: z.array(stepConditionSchema).optional(),
  message_type: z.enum(['text', 'video', 'video_note', 'voice', 'photo', 'document']).optional(),
  content: z.string().optional(),
  status_id: z.string().uuid().optional(),
  reminder: z.object({
    title: z.string(),
    due_minutes: z.number().min(1),
    priority: z.enum(['low', 'medium', 'high']).optional(),
  }).optional(),
  wait_condition: z.object({
    type: z.enum(['reply', 'no_reply', 'time']),
    timeout_minutes: z.number().optional(),
  }).optional(),
  branches: z.array(z.object({
    condition: stepConditionSchema,
    next_step_id: z.string().uuid(),
  })).optional(),
  default_next_step_id: z.string().uuid().optional(),
  tags_to_add: z.array(z.string()).optional(),
  tags_to_remove: z.array(z.string()).optional(),
  assign_to_account_id: z.string().uuid().optional(),
  webhook_url: z.string().url().optional(),
  webhook_method: z.enum(['GET', 'POST']).optional(),
});

const triggerSchema = z.object({
  type: z.enum(['new_message', 'keyword', 'regex', 'any', 'no_reply', 'no_response', 'status_change', 'scheduled']),
  keywords: z.array(z.string()).optional(),
  regex_pattern: z.string().optional(),
  source_campaign_ids: z.array(z.string().uuid()).optional(),
  timeout_minutes: z.number().optional(),
  from_status_id: z.string().uuid().optional(),
  to_status_id: z.string().uuid().optional(),
  schedule_cron: z.string().optional(),
  conditions: z.array(z.object({
    field: z.enum(['status', 'tag', 'has_messages', 'last_message_direction', 'custom_field']),
    operator: z.enum(['equals', 'not_equals', 'contains', 'not_contains', 'greater_than', 'less_than', 'is_empty', 'is_not_empty']),
    value: z.union([z.string(), z.number(), z.boolean()]).optional(),
    custom_field_key: z.string().optional(),
  })).optional(),
});

const createSequenceSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  trigger: triggerSchema,
  steps: z.array(stepSchema).min(1),
  assigned_accounts: z.array(z.string().uuid()).optional(),
});

// GET /api/sequences
export async function GET(request: NextRequest) {
  const status = request.nextUrl.searchParams.get('status');

  let query = supabase
    .from('sequences')
    .select('*')
    .order('created_at', { ascending: false });

  if (status) {
    query = query.eq('status', status);
  }

  const { data: sequences, error } = await query;

  if (error) {
    return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: sequences });
}

// POST /api/sequences
export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = createSequenceSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: parsed.error.flatten() },
    }, { status: 400 });
  }

  // Add IDs to steps
  const stepsWithIds = parsed.data.steps.map((step, index) => ({
    ...step,
    id: crypto.randomUUID(),
    order: index,
  }));

  const { data: sequence, error } = await supabase
    .from('sequences')
    .insert({
      ...parsed.data,
      steps: stepsWithIds,
      status: 'active',
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: sequence }, { status: 201 });
}
