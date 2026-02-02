import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';
import { handleLeadReply, executeSequenceStep } from './sequence-executor.js';
import type { Sequence, Lead } from '@outreach/shared/types/entities.js';
import type { SequenceEnrollmentRow, SequenceEnrollmentInsert, LeadRow, MessageRow } from '../lib/db-helpers.js';

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

      // Check if already enrolled with active/paused status (allow re-enrollment for completed)
      const { data: existingEnrollment } = await supabase
        .from('sequence_enrollments')
        .select('id, status')
        .eq('sequence_id', seq.id)
        .eq('lead_id', lead.id)
        .in('status', ['active', 'paused'])
        .maybeSingle();

      if (existingEnrollment) continue;

      // Check trigger conditions
      if (matchesTrigger(seq, messageText)) {
        await enrollLead(lead, seq, accountId);
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

async function enrollLead(lead: Lead, sequence: Sequence, accountId?: string): Promise<boolean> {
  const logger = createLogger('SequenceTrigger');
  const firstStep = sequence.steps[0] as { id: string; delay_minutes?: number } | undefined;

  if (!firstStep) {
    logger.warn('Sequence has no steps', { sequenceId: sequence.id });
    return false;
  }

  // Check for existing enrollment (any status) to handle re-enrollment
  const { data: existingEnrollmentData } = await supabase
    .from('sequence_enrollments')
    .select('id, status')
    .eq('sequence_id', sequence.id)
    .eq('lead_id', lead.id)
    .maybeSingle();

  const existingEnrollment = existingEnrollmentData as Pick<SequenceEnrollmentRow, 'id' | 'status'> | null;

  if (existingEnrollment) {
    // If active or paused, skip
    if (existingEnrollment.status === 'active' || existingEnrollment.status === 'paused') {
      logger.debug('Lead already has active/paused enrollment', {
        sequenceId: sequence.id,
        leadId: lead.id,
        status: existingEnrollment.status
      });
      return false;
    }

    // If completed/failed/exited, delete old enrollment to allow re-enrollment
    logger.info('Deleting old enrollment to allow re-enrollment', {
      sequenceId: sequence.id,
      leadId: lead.id,
      oldStatus: existingEnrollment.status
    });

    await supabase
      .from('sequence_enrollments')
      .delete()
      .eq('id', existingEnrollment.id);
  }

  const delayMinutes = firstStep.delay_minutes || 0;
  const nextStepAt = delayMinutes > 0
    ? new Date(Date.now() + delayMinutes * 60 * 1000).toISOString()
    : null;

  const effectiveAccountId = accountId || lead.assigned_account_id;

  const insertData: SequenceEnrollmentInsert = {
    sequence_id: sequence.id,
    lead_id: lead.id,
    current_step: 0,
    status: 'active',
    next_step_at: nextStepAt,
    account_id: effectiveAccountId,
  };

  const { data: enrollmentData, error } = await supabase
    .from('sequence_enrollments')
    .insert(insertData as never)
    .select()
    .single();

  const enrollment = enrollmentData as SequenceEnrollmentRow | null;

  if (error) {
    // If account_id column doesn't exist, retry without it
    if (error.message?.includes('account_id')) {
      logger.warn('account_id column not found, inserting without it');
      const retryInsert: Omit<SequenceEnrollmentInsert, 'account_id'> = {
        sequence_id: sequence.id,
        lead_id: lead.id,
        current_step: 0,
        status: 'active',
        next_step_at: nextStepAt,
      };
      const { data: retryEnrollmentData, error: retryError } = await supabase
        .from('sequence_enrollments')
        .insert(retryInsert as never)
        .select()
        .single();

      const retryEnrollment = retryEnrollmentData as SequenceEnrollmentRow | null;

      if (retryError) {
        logger.error('Failed to enroll lead', { error: retryError, leadId: lead.id, sequenceId: sequence.id });
        return false;
      }

      if (delayMinutes === 0 && retryEnrollment) {
        executeSequenceStep(retryEnrollment.id, firstStep.id).catch(err => {
          logger.error('Failed to execute immediate step', err);
        });
      }
      return true;
    }

    logger.error('Failed to enroll lead', { error, leadId: lead.id, sequenceId: sequence.id });
    return false;
  }

  logger.info('Enrollment created', { enrollmentId: enrollment?.id, sequenceId: sequence.id, leadId: lead.id });

  // Execute immediately if no delay
  if (delayMinutes === 0 && enrollment) {
    executeSequenceStep(enrollment.id, firstStep.id).catch(err => {
      logger.error('Failed to execute immediate step', err);
    });
  }

  return true;
}

/**
 * Batch enroll existing leads when a sequence is activated.
 * Finds leads with UNANSWERED messages (last message is incoming) from assigned accounts.
 */
export async function batchEnrollExistingLeads(sequence: Sequence): Promise<{ enrolled: number; skipped: number }> {
  const batchLogger = createLogger('SequenceTrigger:BatchEnroll');
  let enrolled = 0;
  let skipped = 0;

  try {
    const assignedAccounts = sequence.assigned_accounts || [];
    if (assignedAccounts.length === 0) {
      batchLogger.warn('Sequence has no assigned accounts', { sequenceId: sequence.id });
      return { enrolled: 0, skipped: 0 };
    }

    batchLogger.info('Starting batch enrollment', {
      sequenceId: sequence.id,
      sequenceName: sequence.name,
      assignedAccounts,
      triggerType: sequence.trigger?.type
    });

    // Skip batch enrollment for keyword/regex triggers (they need specific message text)
    if (sequence.trigger?.type === 'keyword' || sequence.trigger?.type === 'regex') {
      batchLogger.info('Skipping batch for keyword/regex trigger', { triggerType: sequence.trigger.type });
      return { enrolled: 0, skipped: 0 };
    }

    // Step 1: Get all messages from assigned accounts, ordered by created_at DESC
    const { data: messagesData, error: msgError } = await supabase
      .from('messages')
      .select('lead_id, account_id, direction, created_at')
      .in('account_id', assignedAccounts)
      .order('created_at', { ascending: false });

    if (msgError) {
      batchLogger.error('Failed to fetch messages', { error: msgError });
      return { enrolled: 0, skipped: 0 };
    }

    const messages = messagesData as Pick<MessageRow, 'lead_id' | 'account_id' | 'direction' | 'created_at'>[] | null;

    if (!messages || messages.length === 0) {
      batchLogger.info('No messages found for assigned accounts');
      return { enrolled: 0, skipped: 0 };
    }

    // Step 2: Find leads whose LAST message is incoming (unanswered)
    const leadLastMessage = new Map<string, { accountId: string; direction: string }>();
    for (const msg of messages) {
      if (!msg.lead_id) continue;
      // Only keep the first (most recent) message per lead
      if (!leadLastMessage.has(msg.lead_id)) {
        leadLastMessage.set(msg.lead_id, {
          accountId: msg.account_id,
          direction: msg.direction
        });
      }
    }

    // Step 2.5: Find leads who have NEVER received an outgoing message (truly new contacts)
    // Not just "last message is incoming" but "never responded to at all"
    const leadIdsWithIncoming = Array.from(leadLastMessage.keys()).filter(
      leadId => leadLastMessage.get(leadId)?.direction === 'incoming'
    );

    if (leadIdsWithIncoming.length === 0) {
      batchLogger.info('No leads with incoming last message');
      return { enrolled: 0, skipped: 0 };
    }

    // Check which of these leads have EVER received an outgoing message
    const { data: leadsWithOutgoing } = await supabase
      .from('messages')
      .select('lead_id')
      .in('lead_id', leadIdsWithIncoming)
      .in('account_id', assignedAccounts)
      .eq('direction', 'outgoing');

    const leadsAlreadyRespondedTo = new Set((leadsWithOutgoing || []).map(m => m.lead_id));

    // Filter to only truly NEW leads (never responded to)
    const neverRespondedLeads = new Map<string, string>();
    let alreadyRespondedCount = 0;

    for (const leadId of leadIdsWithIncoming) {
      if (leadsAlreadyRespondedTo.has(leadId)) {
        alreadyRespondedCount++;
        continue; // Skip - already had a conversation
      }
      const data = leadLastMessage.get(leadId);
      if (data) {
        neverRespondedLeads.set(leadId, data.accountId);
      }
    }

    batchLogger.info('Filtered to never-responded leads', {
      withIncomingLast: leadIdsWithIncoming.length,
      alreadyRespondedTo: alreadyRespondedCount,
      neverResponded: neverRespondedLeads.size
    });

    if (neverRespondedLeads.size === 0) {
      batchLogger.info('All leads have been responded to before');
      return { enrolled: 0, skipped: alreadyRespondedCount };
    }

    const uniqueLeadIds = Array.from(neverRespondedLeads.keys());

    // Step 3: Check for existing active/paused enrollments
    const { data: existingEnrollmentsData } = await supabase
      .from('sequence_enrollments')
      .select('lead_id')
      .eq('sequence_id', sequence.id)
      .in('lead_id', uniqueLeadIds)
      .in('status', ['active', 'paused']);

    const existingEnrollments = existingEnrollmentsData as Pick<SequenceEnrollmentRow, 'lead_id'>[] | null;
    const alreadyActiveIds = new Set((existingEnrollments || []).map(e => e.lead_id));
    batchLogger.info('Already active enrollments', { count: alreadyActiveIds.size });

    // Step 4: Get lead records for leads to enroll
    const leadsToEnrollIds = uniqueLeadIds.filter(id => !alreadyActiveIds.has(id));

    if (leadsToEnrollIds.length === 0) {
      batchLogger.info('All unanswered leads already have active enrollments');
      return { enrolled: 0, skipped: alreadyActiveIds.size };
    }

    const { data: leadsData, error: leadsError } = await supabase
      .from('leads')
      .select('*')
      .in('id', leadsToEnrollIds);

    if (leadsError) {
      batchLogger.error('Failed to fetch leads', { error: leadsError });
      return { enrolled: 0, skipped: alreadyActiveIds.size };
    }

    const leads = leadsData as LeadRow[] | null;
    batchLogger.info('Leads to enroll', { count: leads?.length || 0 });

    // Step 5: Enroll each lead
    for (const lead of (leads || [])) {
      try {
        const accountId = neverRespondedLeads.get(lead.id) || lead.assigned_account_id || assignedAccounts[0];
        const success = await enrollLead(lead as Lead, sequence, accountId);
        if (success) {
          enrolled++;
        } else {
          skipped++;
        }
      } catch (err) {
        batchLogger.error('Failed to enroll lead', { leadId: lead.id, error: err });
        skipped++;
      }
    }

    batchLogger.info('Batch enrollment completed', {
      sequenceId: sequence.id,
      sequenceName: sequence.name,
      enrolled,
      skipped: skipped + alreadyActiveIds.size
    });

    return { enrolled, skipped: skipped + alreadyActiveIds.size };
  } catch (error) {
    batchLogger.error('Batch enrollment failed', error);
    return { enrolled, skipped };
  }
}
