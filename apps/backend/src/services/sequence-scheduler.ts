import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';
import { executeSequenceStep } from './sequence-executor.js';
import { messageQueue, type QueueItem, type SequenceStepPayload } from './message-queue.js';
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

// Register the sequence_step processor with the queue
messageQueue.registerProcessor('sequence_step', async (item: QueueItem) => {
  const payload = item.payload as unknown as SequenceStepPayload;
  logger.info(`Processing queued sequence step`, { enrollmentId: payload.enrollmentId, stepId: payload.stepId });
  await executeSequenceStep(payload.enrollmentId, payload.stepId);
});

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

    const leadsNeedingResponse = Array.from(lastMessageByLead.entries())
      .filter(([, data]) => data.direction === 'incoming' && data.sent_at < cutoffTime)
      .map(([leadId]) => leadId);

    if (leadsNeedingResponse.length === 0) continue;

    const { data: existingEnrollments } = await supabase
      .from('sequence_enrollments')
      .select('lead_id')
      .eq('sequence_id', typedSequence.id)
      .in('status', ['active', 'completed']);

    const enrolledLeadIds = new Set(existingEnrollments?.map(e => (e as Pick<SequenceEnrollmentRow, 'lead_id'>).lead_id) || []);
    const leadsToEnroll = leadsNeedingResponse.filter(id => !enrolledLeadIds.has(id));

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
  const delayMs = delayMinutes * 60 * 1000;

  // If executing immediately, set next_step_at to null to prevent double execution
  const nextStepAt = delayMinutes > 0
    ? new Date(Date.now() + delayMs).toISOString()
    : null;

  const enrollmentData: Record<string, unknown> = {
    sequence_id: sequence.id,
    lead_id: lead.id,
    current_step: 0,
    status: 'active',
    next_step_at: nextStepAt,
  };

  if (lead.assigned_account_id) {
    enrollmentData.account_id = lead.assigned_account_id;
  }

  let { data: enrollment, error } = await supabase
    .from('sequence_enrollments')
    .insert(enrollmentData as SequenceEnrollmentInsert)
    .select()
    .single();

  if (error) {
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

  // Queue first step execution
  if (firstStep && enrollment) {
    const typedEnrollment = enrollment as SequenceEnrollmentRow;

    // Use the queue for delayed execution, or execute immediately
    if (delayMs > 0) {
      messageQueue.enqueue('sequence_step', {
        enrollmentId: typedEnrollment.id,
        stepId: firstStep.id,
        sequenceId: sequence.id,
        leadId: lead.id,
      }, {
        priority: 7,
        maxAttempts: 3,
        delayMs,
      });
      logger.info(`Queued first step for enrollment ${typedEnrollment.id} with ${delayMinutes}min delay`);
    } else {
      // Execute immediately for no-delay steps
      executeSequenceStep(typedEnrollment.id, firstStep.id).catch(err => {
        logger.error(`Failed to execute first step`, err);
      });
    }
  }
}

// Process scheduled steps that are due - now queue-based
async function processScheduledSteps(): Promise<void> {
  const now = new Date().toISOString();

  const { data: dueEnrollments } = await supabase
    .from('sequence_enrollments')
    .select('*, sequences(*)')
    .eq('status', 'active')
    .lte('next_step_at', now)
    .not('next_step_at', 'is', null);

  if (!dueEnrollments || dueEnrollments.length === 0) return;

  logger.info(`Found ${dueEnrollments.length} due enrollments to process`);

  for (const enrollment of dueEnrollments) {
    const typedEnrollment = enrollment as SequenceEnrollmentRow & {
      sequences: Sequence;
    };
    const sequence = typedEnrollment.sequences;
    const steps = sequence.steps as Array<{ id: string; order: number }>;
    const currentStepIndex = typedEnrollment.current_step ?? 0;
    const currentStep = steps[currentStepIndex];

    if (!currentStep) continue;

    // Check if already queued to avoid duplicates
    const isQueued = messageQueue.has({
      type: 'sequence_step',
      payloadMatch: { enrollmentId: typedEnrollment.id, stepId: currentStep.id },
    });

    if (isQueued) {
      logger.debug(`Step already queued for enrollment ${typedEnrollment.id}`);
      continue;
    }

    // Clear next_step_at to prevent re-processing
    await supabase
      .from('sequence_enrollments')
      .update({ next_step_at: null } as SequenceEnrollmentUpdate)
      .eq('id', typedEnrollment.id);

    // Queue for immediate processing
    messageQueue.enqueue('sequence_step', {
      enrollmentId: typedEnrollment.id,
      stepId: currentStep.id,
      sequenceId: sequence.id,
      leadId: typedEnrollment.lead_id,
    }, {
      priority: 7,
      maxAttempts: 3,
    });

    logger.info(`Queued due step for enrollment ${typedEnrollment.id}`);
  }
}

// Check for enrollments waiting on timeout
async function checkWaitTimeouts(): Promise<void> {
  const now = new Date().toISOString();

  try {
    const { data: timedOutEnrollments, error } = await supabase
      .from('sequence_enrollments')
      .select('*, sequences(*)')
      .eq('status', 'active')
      .not('waiting_for', 'is', null)
      .lte('wait_until', now);

    if (error) {
      if (error.message?.includes('waiting_for') || error.message?.includes('wait_until')) {
        // Columns don't exist, skip this check
        return;
      }
      throw error;
    }

    if (!timedOutEnrollments || timedOutEnrollments.length === 0) return;

    logger.info(`Found ${timedOutEnrollments.length} timed out wait conditions`);

    for (const enrollment of timedOutEnrollments) {
      const typedEnrollment = enrollment as SequenceEnrollmentRow & {
        sequences: Sequence;
        waiting_for?: string;
      };
      const sequence = typedEnrollment.sequences;
      const steps = sequence.steps as Array<{ id: string; order: number; wait_condition?: { type: string } }>;
      const currentStepIndex = typedEnrollment.current_step ?? 0;
      const currentStep = steps[currentStepIndex];

      if (!currentStep) continue;

      // Clear wait condition
      await supabase
        .from('sequence_enrollments')
        .update({
          waiting_for: null,
          wait_until: null,
        } as SequenceEnrollmentUpdate)
        .eq('id', typedEnrollment.id);

      // Find and queue next step
      const nextStep = steps
        .filter(s => s.order > currentStep.order)
        .sort((a, b) => a.order - b.order)[0];

      if (nextStep) {
        const delayMs = ((nextStep as { delay_minutes?: number }).delay_minutes || 0) * 60 * 1000;

        // Update enrollment
        await supabase
          .from('sequence_enrollments')
          .update({
            current_step: steps.indexOf(nextStep),
            next_step_at: delayMs > 0 ? new Date(Date.now() + delayMs).toISOString() : null,
          } as SequenceEnrollmentUpdate)
          .eq('id', typedEnrollment.id);

        if (delayMs === 0) {
          messageQueue.enqueue('sequence_step', {
            enrollmentId: typedEnrollment.id,
            stepId: nextStep.id,
            sequenceId: sequence.id,
            leadId: typedEnrollment.lead_id,
          }, {
            priority: 7,
            maxAttempts: 3,
          });
        }
      } else {
        // Complete enrollment
        await supabase
          .from('sequence_enrollments')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
          } as SequenceEnrollmentUpdate)
          .eq('id', typedEnrollment.id);
      }
    }
  } catch (err) {
    logger.error('Error checking wait timeouts', err);
  }
}

// Main scheduler loop
let schedulerInterval: NodeJS.Timeout | null = null;

export function startSequenceScheduler(intervalMs = 15000): void {
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
        checkWaitTimeouts(),
      ]);
    } catch (error) {
      logger.error('Sequence scheduler error', error);
    }
  };

  // Run immediately
  runChecks();

  // Then run on interval (reduced from 30s to 15s for better responsiveness)
  schedulerInterval = setInterval(runChecks, intervalMs);
}

export function stopSequenceScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    logger.info('Sequence scheduler stopped');
  }
}

// Export for use in sequence-executor when advancing steps
export function queueNextStep(
  enrollmentId: string,
  stepId: string,
  sequenceId: string,
  leadId: string,
  delayMs: number
): void {
  if (delayMs > 0) {
    messageQueue.enqueue('sequence_step', {
      enrollmentId,
      stepId,
      sequenceId,
      leadId,
    }, {
      priority: 7,
      maxAttempts: 3,
      delayMs,
    });
    logger.info(`Queued next step ${stepId} for enrollment ${enrollmentId} with ${delayMs}ms delay`);
  } else {
    // Execute immediately
    executeSequenceStep(enrollmentId, stepId).catch(err => {
      logger.error(`Failed to execute step ${stepId}`, err);
    });
  }
}
