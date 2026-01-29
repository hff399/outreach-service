import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';
import { handleLeadReply } from './sequence-executor.js';
import type { Sequence, Lead } from '@outreach/shared/types/entities.js';

const logger = createLogger('SequenceTrigger');

/**
 * Check if a lead should be enrolled in a sequence and enroll them if so.
 * This is a standalone function to avoid circular dependencies.
 */
export async function checkAndEnrollSequences(
  lead: Lead,
  messageText: string,
  accountId: string
): Promise<void> {
  try {
    // Get active sequences for this account
    const { data: sequences } = await supabase
      .from('sequences')
      .select('*')
      .eq('status', 'active')
      .contains('assigned_accounts', [accountId]);

    if (!sequences?.length) return;

    for (const sequence of sequences) {
      const seq = sequence as Sequence;

      // Check if already enrolled
      const { data: existingEnrollment } = await supabase
        .from('sequence_enrollments')
        .select('id')
        .eq('sequence_id', seq.id)
        .eq('lead_id', lead.id)
        .single();

      if (existingEnrollment) continue;

      // Check trigger conditions
      if (matchesTrigger(seq, messageText)) {
        await enrollLead(lead, seq);
        logger.info(`Enrolled lead ${lead.id} in sequence ${seq.name}`);
        break; // Only enroll in first matching sequence
      }
    }

    // Also check if this reply should advance any waiting enrollments
    await handleLeadReply(lead.id);
  } catch (error) {
    logger.error('Failed to check sequences for lead', error);
  }
}

function matchesTrigger(sequence: Sequence, messageText: string): boolean {
  const trigger = sequence.trigger;

  switch (trigger.type) {
    case 'any':
      return true;

    case 'new_message':
      // This triggers for new leads - caller should check if lead is new
      return true;

    case 'keyword':
      if (!trigger.keywords?.length) return false;
      const lowerText = messageText.toLowerCase();
      return trigger.keywords.some((kw) => lowerText.includes(kw.toLowerCase()));

    case 'regex':
      if (!trigger.regex_pattern) return false;
      try {
        const regex = new RegExp(trigger.regex_pattern, 'i');
        return regex.test(messageText);
      } catch {
        return false;
      }

    default:
      return false;
  }
}

async function enrollLead(lead: Lead, sequence: Sequence): Promise<void> {
  const firstStep = sequence.steps[0];
  const nextStepAt = firstStep
    ? new Date(Date.now() + (firstStep.delay_minutes || 0) * 60 * 1000)
    : null;

  await supabase.from('sequence_enrollments').insert({
    sequence_id: sequence.id,
    lead_id: lead.id,
    current_step: 0,
    status: 'active',
    next_step_at: nextStepAt?.toISOString(),
  });
}
