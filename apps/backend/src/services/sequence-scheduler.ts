import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';
import { executeSequenceStep } from './sequence-executor.js';
import type { Lead, Sequence, SequenceEnrollment } from '@outreach/shared/types/entities.js';
import type {
  SequenceRow,
  SequenceEnrollmentRow,
  SequenceEnrollmentInsert,
  SequenceEnrollmentUpdate,
  LeadRow,
  MessageRow
} from '../lib/db-helpers.js';

const logger = createLogger('SequenceScheduler');

type TriggerCondition = {
  field: 'status' | 'tag' | 'has_messages' | 'last_message_direction' | 'custom_field';
  operator: 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'greater_than' | 'less_than' | 'is_empty' | 'is_not_empty';
  value?: string | number | boolean;
  custom_field_key?: string;
};

type SequenceTrigger = {
  type: 'new_message' | 'keyword' | 'regex' | 'any' | 'no_reply' | 'no_response' | 'status_change' | 'scheduled';
  keywords?: string[];
  regex_pattern?: string;
  source_campaign_ids?: string[];
  timeout_minutes?: number;
  from_status_id?: string;
  to_status_id?: string;
  schedule_cron?: string;
  conditions?: TriggerCondition[];
};

// Check if lead matches all trigger conditions
async function checkConditions(lead: Lead, conditions: TriggerCondition[]): Promise<boolean> {
  for (const condition of conditions) {
    const matches = await checkSingleCondition(lead, condition);
    if (!matches) return false;
  }
  return true;
}

async function checkSingleCondition(lead: Lead, condition: TriggerCondition): Promise<boolean> {
  let fieldValue: unknown;

  switch (condition.field) {
    case 'status':
      fieldValue = lead.status_id;
      break;
    case 'tag':
      // Get lead tags
      const { data: tags } = await supabase
        .from('lead_tags')
        .select('tag')
        .eq('lead_id', lead.id);
      fieldValue = tags?.map(t => (t as { tag: string }).tag) || [];
      break;
    case 'has_messages':
      const { count } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('lead_id', lead.id);
      fieldValue = (count || 0) > 0;
      break;
    case 'last_message_direction':
      const { data: lastMsg } = await supabase
        .from('messages')
        .select('direction')
        .eq('lead_id', lead.id)
        .order('sent_at', { ascending: false })
        .limit(1)
        .single();
      fieldValue = (lastMsg as Pick<MessageRow, 'direction'> | null)?.direction;
      break;
    case 'custom_field':
      fieldValue = lead.custom_fields?.[condition.custom_field_key || ''];
      break;
    default:
      return true;
  }

  // Evaluate operator
  switch (condition.operator) {
    case 'equals':
      return fieldValue === condition.value;
    case 'not_equals':
      return fieldValue !== condition.value;
    case 'contains':
      if (Array.isArray(fieldValue)) {
        return fieldValue.includes(condition.value);
      }
      return String(fieldValue || '').includes(String(condition.value || ''));
    case 'not_contains':
      if (Array.isArray(fieldValue)) {
        return !fieldValue.includes(condition.value);
      }
      return !String(fieldValue || '').includes(String(condition.value || ''));
    case 'greater_than':
      return Number(fieldValue) > Number(condition.value);
    case 'less_than':
      return Number(fieldValue) < Number(condition.value);
    case 'is_empty':
      return !fieldValue || (Array.isArray(fieldValue) && fieldValue.length === 0);
    case 'is_not_empty':
      return !!fieldValue && (!Array.isArray(fieldValue) || fieldValue.length > 0);
    default:
      return true;
  }
}

// Check for leads that need follow-up (no response from us)
async function checkNoResponseTriggers(): Promise<void> {
  const { data: sequences } = await supabase
    .from('sequences')
    .select('*')
    .eq('status', 'active')
    .contains('trigger', { type: 'no_response' });

  if (!sequences || sequences.length === 0) return;

  for (const sequence of sequences) {
    const typedSequence = sequence as SequenceRow;
    const trigger = typedSequence.trigger as SequenceTrigger;
    const timeoutMinutes = trigger.timeout_minutes || 60;
    const cutoffTime = new Date(Date.now() - timeoutMinutes * 60 * 1000).toISOString();

    // Find leads where last message is incoming and older than timeout
    const { data: messages } = await supabase
      .from('messages')
      .select('lead_id, direction, sent_at')
      .order('sent_at', { ascending: false });

    // Group by lead and find those with incoming last message older than cutoff
    const lastMessageByLead = new Map<string, { direction: string; sent_at: string }>();
    for (const msg of messages || []) {
      const typedMsg = msg as Pick<MessageRow, 'lead_id' | 'direction' | 'sent_at'>;
      if (!lastMessageByLead.has(typedMsg.lead_id)) {
        lastMessageByLead.set(typedMsg.lead_id, { direction: typedMsg.direction, sent_at: typedMsg.sent_at });
      }
    }

    const leadsNeedingResponse = Array.from(lastMessageByLead.entries())
      .filter(([, data]) => data.direction === 'incoming' && data.sent_at < cutoffTime)
      .map(([leadId]) => leadId);

    if (leadsNeedingResponse.length === 0) continue;

    // Get leads not already enrolled
    const { data: existingEnrollments } = await supabase
      .from('sequence_enrollments')
      .select('lead_id')
      .eq('sequence_id', typedSequence.id)
      .in('status', ['active', 'completed']);

    const enrolledLeadIds = new Set(existingEnrollments?.map(e => (e as Pick<SequenceEnrollmentRow, 'lead_id'>).lead_id) || []);
    const leadsToEnroll = leadsNeedingResponse.filter(id => !enrolledLeadIds.has(id));

    // Enroll leads
    for (const leadId of leadsToEnroll) {
      const { data: lead } = await supabase
        .from('leads')
        .select('*')
        .eq('id', leadId)
        .single();

      if (!lead) continue;

      // Check conditions
      if (trigger.conditions && trigger.conditions.length > 0) {
        const matches = await checkConditions(lead as Lead, trigger.conditions);
        if (!matches) continue;
      }

      // Enroll in sequence
      await enrollLeadInSequence(lead as Lead, typedSequence as Sequence);
    }
  }
}

// Check for leads who haven't replied
async function checkNoReplyTriggers(): Promise<void> {
  const { data: sequences } = await supabase
    .from('sequences')
    .select('*')
    .eq('status', 'active')
    .contains('trigger', { type: 'no_reply' });

  if (!sequences || sequences.length === 0) return;

  for (const sequence of sequences) {
    const typedSequence = sequence as SequenceRow;
    const trigger = typedSequence.trigger as SequenceTrigger;
    const timeoutMinutes = trigger.timeout_minutes || 60;
    const cutoffTime = new Date(Date.now() - timeoutMinutes * 60 * 1000).toISOString();

    // Find leads where last message is outgoing and older than timeout
    const { data: messages } = await supabase
      .from('messages')
      .select('lead_id, direction, sent_at')
      .order('sent_at', { ascending: false });

    const lastMessageByLead = new Map<string, { direction: string; sent_at: string }>();
    for (const msg of messages || []) {
      const typedMsg = msg as Pick<MessageRow, 'lead_id' | 'direction' | 'sent_at'>;
      if (!lastMessageByLead.has(typedMsg.lead_id)) {
        lastMessageByLead.set(typedMsg.lead_id, { direction: typedMsg.direction, sent_at: typedMsg.sent_at });
      }
    }

    const leadsNotReplied = Array.from(lastMessageByLead.entries())
      .filter(([, data]) => data.direction === 'outgoing' && data.sent_at < cutoffTime)
      .map(([leadId]) => leadId);

    if (leadsNotReplied.length === 0) continue;

    // Get leads not already enrolled
    const { data: existingEnrollments } = await supabase
      .from('sequence_enrollments')
      .select('lead_id')
      .eq('sequence_id', typedSequence.id)
      .in('status', ['active', 'completed']);

    const enrolledLeadIds = new Set(existingEnrollments?.map(e => (e as Pick<SequenceEnrollmentRow, 'lead_id'>).lead_id) || []);
    const leadsToEnroll = leadsNotReplied.filter(id => !enrolledLeadIds.has(id));

    for (const leadId of leadsToEnroll) {
      const { data: lead } = await supabase
        .from('leads')
        .select('*')
        .eq('id', leadId)
        .single();

      if (!lead) continue;

      if (trigger.conditions && trigger.conditions.length > 0) {
        const matches = await checkConditions(lead as Lead, trigger.conditions);
        if (!matches) continue;
      }

      await enrollLeadInSequence(lead as Lead, typedSequence as Sequence);
    }
  }
}

// Enroll a lead in a sequence
async function enrollLeadInSequence(lead: Lead, sequence: Sequence): Promise<void> {
  const steps = sequence.steps as Array<{ id: string; order: number; delay_minutes?: number }>;
  const firstStep = steps.find(s => s.order === 0) || steps[0];

  const delayMinutes = firstStep.delay_minutes || 0;
  // If executing immediately, set next_step_at to null to prevent double execution
  const nextStepAt = delayMinutes > 0
    ? new Date(Date.now() + delayMinutes * 60 * 1000).toISOString()
    : null;

  // Build enrollment data dynamically to handle missing columns
  const enrollmentData: Record<string, unknown> = {
    sequence_id: sequence.id,
    lead_id: lead.id,
    current_step: 0,
    status: 'active',
    next_step_at: nextStepAt,
  };

  // Add account_id if available
  if (lead.assigned_account_id) {
    enrollmentData.account_id = lead.assigned_account_id;
  }

  let { data: enrollment, error } = await supabase
    .from('sequence_enrollments')
    .insert(enrollmentData as SequenceEnrollmentInsert)
    .select()
    .single();

  if (error) {
    // Check if error is due to missing column and retry without account_id
    if (error.message?.includes('account_id')) {
      logger.warn('account_id column not found in sequence_enrollments. Run the database migration.');
      delete enrollmentData.account_id;
      const retryResult = await supabase
        .from('sequence_enrollments')
        .insert(enrollmentData as SequenceEnrollmentInsert)
        .select()
        .single();

      if (retryResult.error) {
        logger.error(`Failed to enroll lead ${lead.id} in sequence ${sequence.id}`, retryResult.error);
        return;
      }
      enrollment = retryResult.data;
    } else {
      logger.error(`Failed to enroll lead ${lead.id} in sequence ${sequence.id}`, error);
      return;
    }
  }

  logger.info(`Enrolled lead ${lead.id} in sequence ${sequence.name}`);

  // Execute first step immediately if no delay
  if (firstStep && enrollment && delayMinutes === 0) {
    const typedEnrollment = enrollment as SequenceEnrollmentRow;
    executeSequenceStep(typedEnrollment.id, firstStep.id).catch(err => {
      logger.error(`Failed to execute first step`, err);
    });
  }
}

// Schedule a step to be executed
function scheduleStep(
  enrollment: SequenceEnrollment,
  step: { id: string; delay_minutes?: number }
): void {
  const delayMs = (step.delay_minutes || 0) * 60 * 1000;

  if (delayMs === 0) {
    // Execute immediately
    executeSequenceStep(enrollment.id, step.id).catch(err => {
      logger.error(`Failed to execute step ${step.id}`, err);
    });
  } else {
    // Schedule for later
    const executeAt = new Date(Date.now() + delayMs).toISOString();
    supabase
      .from('sequence_enrollments')
      .update({
        next_step_at: executeAt,
      } as SequenceEnrollmentUpdate)
      .eq('id', enrollment.id)
      .then(() => {
        logger.debug(`Scheduled step ${step.id} for ${executeAt}`);
      });
  }
}

// Process scheduled steps that are due
async function processScheduledSteps(): Promise<void> {
  const now = new Date().toISOString();

  const { data: dueEnrollments } = await supabase
    .from('sequence_enrollments')
    .select('*, sequences(*)')
    .eq('status', 'active')
    .lte('next_step_at', now)
    .not('next_step_at', 'is', null);

  if (!dueEnrollments || dueEnrollments.length === 0) return;

  for (const enrollment of dueEnrollments) {
    const typedEnrollment = enrollment as SequenceEnrollmentRow & {
      sequences: Sequence;
    };
    const sequence = typedEnrollment.sequences;
    const steps = sequence.steps as Array<{ id: string; order: number }>;
    const currentStepIndex = typedEnrollment.current_step ?? 0;
    const currentStep = steps[currentStepIndex];

    if (!currentStep) continue;

    await executeSequenceStep(typedEnrollment.id, currentStep.id).catch(err => {
      logger.error(`Failed to execute scheduled step`, err);
    });
  }
}

// Main scheduler loop
let schedulerInterval: NodeJS.Timeout | null = null;

export function startSequenceScheduler(intervalMs = 30000): void {
  if (schedulerInterval) {
    logger.warn('Sequence scheduler already running');
    return;
  }

  logger.info(`Starting sequence scheduler with ${intervalMs}ms interval`);

  const runChecks = async () => {
    try {
      await Promise.all([
        checkNoResponseTriggers(),
        checkNoReplyTriggers(),
        processScheduledSteps(),
      ]);
    } catch (error) {
      logger.error('Sequence scheduler error', error);
    }
  };

  // Run immediately
  runChecks();

  // Then run on interval
  schedulerInterval = setInterval(runChecks, intervalMs);
}

export function stopSequenceScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    logger.info('Sequence scheduler stopped');
  }
}
