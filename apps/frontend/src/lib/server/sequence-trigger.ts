import { supabase } from './supabase';
import { createLogger } from './logger';
import { executeSequenceStep, handleLeadReply } from './sequence-executor';
import { messageQueue } from './message-queue';

const logger = createLogger('SequenceTrigger');

type Lead = {
  id: string;
  tg_user_id: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  assigned_account_id?: string;
  status_id?: string;
  custom_fields?: Record<string, unknown>;
};

type Sequence = {
  id: string;
  name: string;
  status: string;
  trigger: { type: string; keywords?: string[]; regex_pattern?: string };
  steps: Array<{ id: string; order: number; delay_minutes?: number }>;
  assigned_accounts: string[];
};

export async function checkAndEnrollSequences(lead: Lead, messageText: string, accountId: string): Promise<void> {
  try {
    // CRITICAL: Check if we have EVER sent an outgoing message to this lead
    // If yes, do NOT trigger auto-reply - only trigger on TRUE FIRST CONTACT
    const { data: existingOutgoing, error: outgoingError } = await supabase
      .from('messages')
      .select('id')
      .eq('lead_id', lead.id)
      .eq('direction', 'outgoing')
      .limit(1);

    if (outgoingError) {
      logger.error('Failed to check outgoing messages', { error: outgoingError, leadId: lead.id });
      return;
    }

    if (existingOutgoing && existingOutgoing.length > 0) {
      // Lead has already received a message from us - don't auto-enroll
      // Only handle as a reply (advance sequence if already enrolled)
      logger.info('Lead already has outgoing messages, skipping auto-enrollment', { leadId: lead.id });
      await handleLeadReply(lead.id);
      return;
    }

    const { data: sequences } = await supabase
      .from('sequences')
      .select('*')
      .eq('status', 'active')
      .contains('assigned_accounts', [accountId]);

    if (!sequences?.length) return;

    for (const sequence of sequences as Sequence[]) {
      // Check if already enrolled
      const { data: existing } = await supabase
        .from('sequence_enrollments')
        .select('id, status')
        .eq('sequence_id', sequence.id)
        .eq('lead_id', lead.id)
        .in('status', ['active', 'paused'])
        .maybeSingle();

      if (existing) continue;

      if (matchesTrigger(sequence, messageText)) {
        await enrollLead(lead, sequence, accountId);
        logger.info(`Enrolled lead ${lead.id} in sequence ${sequence.name}`);
        break; // Only first matching
      }
    }

    await handleLeadReply(lead.id);
  } catch (error) {
    logger.error('Failed to check sequences', error);
  }
}

function matchesTrigger(sequence: Sequence, messageText: string): boolean {
  const trigger = sequence.trigger;

  switch (trigger.type) {
    case 'any':
    case 'new_message':
      return true;
    case 'keyword':
      if (!trigger.keywords?.length) return false;
      const lower = messageText.toLowerCase();
      return trigger.keywords.some(kw => lower.includes(kw.toLowerCase()));
    case 'regex':
      if (!trigger.regex_pattern) return false;
      try {
        return new RegExp(trigger.regex_pattern, 'i').test(messageText);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

async function enrollLead(lead: Lead, sequence: Sequence, accountId?: string): Promise<boolean> {
  const firstStep = sequence.steps.find(s => s.order === 0) || sequence.steps[0];
  if (!firstStep) return false;

  // Delete old completed enrollment if exists
  const { data: oldEnrollment } = await supabase
    .from('sequence_enrollments')
    .select('id, status')
    .eq('sequence_id', sequence.id)
    .eq('lead_id', lead.id)
    .maybeSingle();

  if (oldEnrollment) {
    if (['active', 'paused'].includes(oldEnrollment.status)) return false;
    await supabase.from('sequence_enrollments').delete().eq('id', oldEnrollment.id);
  }

  const delayMs = (firstStep.delay_minutes || 0) * 60 * 1000;
  const nextStepAt = delayMs > 0 ? new Date(Date.now() + delayMs).toISOString() : null;

  const { data: enrollment, error } = await supabase
    .from('sequence_enrollments')
    .insert({
      sequence_id: sequence.id,
      lead_id: lead.id,
      current_step: 0,
      status: 'active',
      next_step_at: nextStepAt,
      account_id: accountId || lead.assigned_account_id,
    })
    .select()
    .single();

  if (error) {
    logger.error('Failed to enroll lead', { error, leadId: lead.id });
    return false;
  }

  if (delayMs > 0) {
    messageQueue.enqueue('sequence_step', {
      enrollmentId: enrollment.id,
      stepId: firstStep.id,
      sequenceId: sequence.id,
      leadId: lead.id,
    }, { priority: 7, maxAttempts: 3, delayMs });
  } else {
    executeSequenceStep(enrollment.id, firstStep.id).catch(err => {
      logger.error('Failed to execute first step', err);
    });
  }

  return true;
}

// Background scheduler - call this periodically
export async function processScheduledSteps(): Promise<void> {
  const now = new Date().toISOString();

  const { data: dueEnrollments } = await supabase
    .from('sequence_enrollments')
    .select('*, sequences(*)')
    .eq('status', 'active')
    .lte('next_step_at', now)
    .not('next_step_at', 'is', null);

  if (!dueEnrollments?.length) return;

  logger.info(`Processing ${dueEnrollments.length} due enrollments`);

  for (const enrollment of dueEnrollments) {
    const steps = enrollment.sequences.steps as Array<{ id: string; order: number }>;
    const currentStep = steps[enrollment.current_step ?? 0];
    if (!currentStep) continue;

    // Prevent duplicates
    if (messageQueue.has({ type: 'sequence_step', payloadMatch: { enrollmentId: enrollment.id, stepId: currentStep.id } })) continue;

    await supabase.from('sequence_enrollments').update({ next_step_at: null }).eq('id', enrollment.id);

    messageQueue.enqueue('sequence_step', {
      enrollmentId: enrollment.id,
      stepId: currentStep.id,
      sequenceId: enrollment.sequences.id,
      leadId: enrollment.lead_id,
    }, { priority: 7, maxAttempts: 3 });
  }
}
