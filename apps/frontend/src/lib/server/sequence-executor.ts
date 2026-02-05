import { supabase } from './supabase';
import { createLogger } from './logger';
import { telegramManager } from './telegram';
import { messageQueue } from './message-queue';

const logger = createLogger('SequenceExecutor');

type SequenceStep = {
  id: string;
  order: number;
  type: 'message' | 'status_change' | 'reminder' | 'wait' | 'branch' | 'tag' | 'assign' | 'webhook';
  delay_minutes?: number;
  message_type?: 'text' | 'video' | 'video_note' | 'voice' | 'photo' | 'document';
  content?: string;
  status_id?: string;
  tags_to_add?: string[];
  tags_to_remove?: string[];
  webhook_url?: string;
  webhook_method?: 'GET' | 'POST';
  wait_condition?: { type: string; timeout_minutes?: number };
  branches?: Array<{ condition: { type: string; value?: string }; next_step_id: string }>;
  default_next_step_id?: string;
};

export async function executeSequenceStep(enrollmentId: string, stepId: string): Promise<void> {
  logger.info('Executing sequence step', { enrollmentId, stepId });

  const { data: enrollment, error } = await supabase
    .from('sequence_enrollments')
    .select('*, sequences(*), leads(*)')
    .eq('id', enrollmentId)
    .single();

  if (error || !enrollment) {
    logger.error('Enrollment not found', { enrollmentId });
    return;
  }

  if (enrollment.status !== 'active') {
    logger.warn('Enrollment not active', { enrollmentId, status: enrollment.status });
    return;
  }

  const sequence = enrollment.sequences;
  const lead = enrollment.leads;
  const steps = sequence.steps as SequenceStep[];
  const step = steps.find(s => s.id === stepId);

  if (!step) {
    logger.error('Step not found', { stepId });
    return;
  }

  try {
    switch (step.type) {
      case 'message':
        await executeMessageStep(enrollment, lead, step);
        break;
      case 'status_change':
        if (step.status_id) {
          await supabase.from('leads').update({ status_id: step.status_id }).eq('id', lead.id);
        }
        break;
      case 'tag':
        if (step.tags_to_add?.length) {
          const tags = step.tags_to_add.map(tag => ({ lead_id: lead.id, tag }));
          await supabase.from('lead_tags').upsert(tags, { onConflict: 'lead_id,tag', ignoreDuplicates: true });
        }
        if (step.tags_to_remove?.length) {
          await supabase.from('lead_tags').delete().eq('lead_id', lead.id).in('tag', step.tags_to_remove);
        }
        break;
      case 'webhook':
        if (step.webhook_url) {
          await fetch(step.webhook_url, {
            method: step.webhook_method || 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: step.webhook_method !== 'GET' ? JSON.stringify({
              event: 'sequence_step',
              sequence_id: sequence.id,
              lead: { id: lead.id, tg_user_id: lead.tg_user_id, username: lead.username },
            }) : undefined,
          });
        }
        break;
      case 'wait':
        if (step.wait_condition) {
          const waitUntil = new Date(Date.now() + (step.wait_condition.timeout_minutes || 60) * 60 * 1000);
          await supabase.from('sequence_enrollments').update({
            waiting_for: step.wait_condition.type,
            wait_until: waitUntil.toISOString(),
            next_step_at: null,
          }).eq('id', enrollment.id);
        }
        return; // Don't advance
      case 'branch':
        await executeBranchStep(enrollment, lead, step, steps);
        return; // Branch handles its own next step
    }

    // Advance to next step
    await advanceToNextStep(enrollment, step, steps);
  } catch (error) {
    const err = error as Error;
    logger.error('Step execution failed', { error: err.message, enrollmentId, stepId });

    const isAuthError = err.message.includes('AUTH_KEY') || err.message.includes('not connected');
    await supabase.from('sequence_enrollments').update({
      status: isAuthError ? 'paused' : 'failed',
      ...(isAuthError ? { waiting_for: 'account_auth' } : { completed_at: new Date().toISOString() }),
    }).eq('id', enrollment.id);
  }
}

async function executeMessageStep(enrollment: { id: string; account_id?: string }, lead: { id: string; tg_user_id: string; assigned_account_id?: string; first_name?: string; last_name?: string; username?: string; custom_fields?: Record<string, string> }, step: SequenceStep): Promise<void> {
  const accountId = enrollment.account_id || lead.assigned_account_id;
  if (!accountId) throw new Error('No account assigned');
  if (!telegramManager.isConnected(accountId)) throw new Error('Account not connected');

  const accessHash = lead.custom_fields?.tg_access_hash;
  const content = (step.content || '')
    .replace(/\{first_name\}/g, lead.first_name || '')
    .replace(/\{last_name\}/g, lead.last_name || '')
    .replace(/\{username\}/g, lead.username || '');

  if (!content.trim()) throw new Error('Message content is empty');

  await telegramManager.sendTypingStatus(accountId, lead.tg_user_id, accessHash);
  await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));

  const result = await telegramManager.sendMessage(accountId, lead.tg_user_id, content, accessHash);

  if (result) {
    await supabase.from('messages').insert({
      lead_id: lead.id,
      account_id: accountId,
      direction: 'outgoing',
      type: 'text',
      content,
      status: 'sent',
      tg_message_id: result.id.toString(),
      sent_at: new Date().toISOString(),
    });
    await supabase.from('leads').update({ last_message_at: new Date().toISOString() }).eq('id', lead.id);
  }

  await telegramManager.markAsRead(accountId, lead.tg_user_id, accessHash);
}

async function executeBranchStep(enrollment: { id: string; sequence_id: string; lead_id: string }, lead: { id: string; status_id?: string }, step: SequenceStep, allSteps: SequenceStep[]): Promise<void> {
  if (!step.branches) {
    if (step.default_next_step_id) await goToStep(enrollment, step.default_next_step_id, allSteps);
    return;
  }

  for (const branch of step.branches) {
    const matches = await evaluateCondition(lead, branch.condition);
    if (matches) {
      await goToStep(enrollment, branch.next_step_id, allSteps);
      return;
    }
  }

  if (step.default_next_step_id) {
    await goToStep(enrollment, step.default_next_step_id, allSteps);
  } else {
    await completeEnrollment(enrollment.id);
  }
}

async function evaluateCondition(lead: { id: string; status_id?: string }, condition: { type: string; value?: string }): Promise<boolean> {
  switch (condition.type) {
    case 'replied': {
      const { data } = await supabase.from('messages').select('id').eq('lead_id', lead.id).eq('direction', 'incoming')
        .gte('sent_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()).limit(1);
      return (data?.length || 0) > 0;
    }
    case 'no_reply': {
      const { data } = await supabase.from('messages').select('id').eq('lead_id', lead.id).eq('direction', 'incoming')
        .gte('sent_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()).limit(1);
      return (data?.length || 0) === 0;
    }
    case 'status_is':
      return lead.status_id === condition.value;
    case 'has_tag': {
      const { data } = await supabase.from('lead_tags').select('tag').eq('lead_id', lead.id).eq('tag', condition.value || '').limit(1);
      return (data?.length || 0) > 0;
    }
    default:
      return true;
  }
}

async function goToStep(enrollment: { id: string; sequence_id: string; lead_id: string }, nextStepId: string, allSteps: SequenceStep[]): Promise<void> {
  const nextStepIndex = allSteps.findIndex(s => s.id === nextStepId);
  const nextStep = allSteps[nextStepIndex];
  if (!nextStep || nextStepIndex === -1) {
    await completeEnrollment(enrollment.id);
    return;
  }

  const delayMs = (nextStep.delay_minutes || 0) * 60 * 1000;
  const nextStepAt = delayMs > 0 ? new Date(Date.now() + delayMs).toISOString() : null;

  await supabase.from('sequence_enrollments').update({ current_step: nextStepIndex, next_step_at: nextStepAt }).eq('id', enrollment.id);

  if (delayMs > 0) {
    messageQueue.enqueue('sequence_step', { enrollmentId: enrollment.id, stepId: nextStepId, sequenceId: enrollment.sequence_id, leadId: enrollment.lead_id }, { priority: 7, maxAttempts: 3, delayMs });
  } else {
    await executeSequenceStep(enrollment.id, nextStepId);
  }
}

async function advanceToNextStep(enrollment: { id: string; sequence_id: string; lead_id: string }, currentStep: SequenceStep, allSteps: SequenceStep[]): Promise<void> {
  const nextStep = allSteps.filter(s => s.order > currentStep.order).sort((a, b) => a.order - b.order)[0];
  if (!nextStep) {
    await completeEnrollment(enrollment.id);
    return;
  }
  await goToStep(enrollment, nextStep.id, allSteps);
}

async function completeEnrollment(enrollmentId: string): Promise<void> {
  await supabase.from('sequence_enrollments').update({ status: 'completed', completed_at: new Date().toISOString(), next_step_at: null }).eq('id', enrollmentId);
  logger.info('Completed enrollment', { enrollmentId });
}

export async function handleLeadReply(leadId: string): Promise<void> {
  const { data: waitingEnrollments } = await supabase
    .from('sequence_enrollments')
    .select('*, sequences(*)')
    .eq('lead_id', leadId)
    .eq('status', 'active')
    .eq('waiting_for', 'reply');

  if (!waitingEnrollments?.length) return;

  for (const enrollment of waitingEnrollments) {
    const steps = enrollment.sequences.steps as SequenceStep[];
    const currentStep = steps[enrollment.current_step ?? 0];
    if (!currentStep) continue;

    await supabase.from('sequence_enrollments').update({ waiting_for: null, wait_until: null }).eq('id', enrollment.id);
    await advanceToNextStep(enrollment, currentStep, steps);
  }
}
