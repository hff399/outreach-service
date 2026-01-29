import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';
import { tgManager } from '../index.js';
import type { Sequence, SequenceEnrollment, Lead } from '@outreach/shared/types/entities.js';

const logger = createLogger('SequenceExecutor');

type SequenceStep = {
  id: string;
  order: number;
  type: 'message' | 'status_change' | 'reminder' | 'wait' | 'branch' | 'tag' | 'assign' | 'webhook';
  delay_minutes?: number;
  // Message fields
  message_type?: 'text' | 'video' | 'video_note' | 'voice' | 'photo' | 'document';
  content?: string;
  // Status change fields
  status_id?: string;
  // Reminder fields
  reminder?: {
    title: string;
    due_minutes: number;
    priority?: 'low' | 'medium' | 'high';
  };
  // Wait fields
  wait_condition?: {
    type: 'reply' | 'no_reply' | 'time';
    timeout_minutes?: number;
  };
  // Tag fields
  tags_to_add?: string[];
  tags_to_remove?: string[];
  // Assign fields
  assign_to_account_id?: string;
  // Webhook fields
  webhook_url?: string;
  webhook_method?: 'GET' | 'POST';
  // Branch fields
  branches?: Array<{
    condition: {
      type: string;
      value?: string;
    };
    next_step_id: string;
  }>;
  default_next_step_id?: string;
};

export async function executeSequenceStep(
  enrollmentId: string,
  stepId: string
): Promise<void> {
  // Get enrollment with sequence
  const { data: enrollment } = await supabase
    .from('sequence_enrollments')
    .select('*, sequences(*), leads(*)')
    .eq('id', enrollmentId)
    .single();

  if (!enrollment || enrollment.status !== 'active') {
    logger.warn(`Enrollment ${enrollmentId} not found or not active`);
    return;
  }

  const sequence = enrollment.sequences as Sequence;
  const lead = enrollment.leads as Lead;
  const steps = sequence.steps as SequenceStep[];
  const step = steps.find(s => s.id === stepId);

  if (!step) {
    logger.error(`Step ${stepId} not found in sequence ${sequence.id}`);
    return;
  }

  logger.info(`Executing step ${step.type} for lead ${lead.id} in sequence ${sequence.name}`);

  try {
    // Execute based on step type
    switch (step.type) {
      case 'message':
        await executeMessageStep(enrollment as SequenceEnrollment, lead, step);
        break;
      case 'status_change':
        await executeStatusChangeStep(lead, step);
        break;
      case 'reminder':
        await executeReminderStep(lead, step);
        break;
      case 'tag':
        await executeTagStep(lead, step);
        break;
      case 'assign':
        await executeAssignStep(lead, step);
        break;
      case 'webhook':
        await executeWebhookStep(lead, step, sequence);
        break;
      case 'wait':
        await executeWaitStep(enrollment as SequenceEnrollment, step);
        return; // Don't advance to next step yet
      case 'branch':
        await executeBranchStep(enrollment as SequenceEnrollment, lead, step, steps);
        return; // Branch handles its own next step
    }

    // Advance to next step
    await advanceToNextStep(enrollment as SequenceEnrollment, step, steps);
  } catch (error) {
    logger.error(`Failed to execute step ${stepId}`, error);

    // Update enrollment with error
    await supabase
      .from('sequence_enrollments')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
      })
      .eq('id', enrollmentId);
  }
}

async function executeMessageStep(
  enrollment: SequenceEnrollment,
  lead: Lead,
  step: SequenceStep
): Promise<void> {
  const accountId = enrollment.account_id || lead.assigned_account_id;
  if (!accountId) {
    throw new Error('No account assigned for sending message');
  }

  if (!tgManager.isConnected(accountId)) {
    throw new Error(`Account ${accountId} is not connected`);
  }

  // Get access_hash from lead's custom_fields
  const accessHash = (lead.custom_fields as Record<string, string> | null)?.tg_access_hash;

  const content = step.content || '';

  // Replace placeholders
  const processedContent = content
    .replace(/\{first_name\}/g, lead.first_name || '')
    .replace(/\{last_name\}/g, lead.last_name || '')
    .replace(/\{username\}/g, lead.username || '')
    .replace(/\{full_name\}/g, `${lead.first_name || ''} ${lead.last_name || ''}`.trim());

  // Send typing status before sending message
  try {
    await tgManager.sendTypingStatus(accountId, lead.tg_user_id, accessHash);
    // Wait 1-3 seconds to simulate typing
    const typingDelay = 1000 + Math.random() * 2000;
    await new Promise(resolve => setTimeout(resolve, typingDelay));
  } catch {
    // Ignore typing status errors
  }

  if (step.message_type === 'text') {
    const result = await tgManager.sendMessage(accountId, lead.tg_user_id, processedContent, accessHash);
    if (result) {
      await saveOutgoingMessage(lead.id, accountId, 'text', processedContent, result.id.toString());
    }
  } else if (step.message_type && step.content) {
    // Media message
    const isVideoNote = step.message_type === 'video_note';
    const isVoice = step.message_type === 'voice';
    const result = await tgManager.sendMedia(
      accountId,
      lead.tg_user_id,
      step.content, // URL or path to media
      undefined,
      isVideoNote,
      isVoice,
      accessHash
    );
    if (result) {
      await saveOutgoingMessage(lead.id, accountId, step.message_type, '', result.id.toString(), step.content);
    }
  }

  // Mark messages as read in Telegram after sending
  try {
    await tgManager.markAsRead(accountId, lead.tg_user_id, accessHash);
  } catch {
    // Ignore errors - not critical
  }
}

async function executeStatusChangeStep(lead: Lead, step: SequenceStep): Promise<void> {
  if (!step.status_id) return;

  await supabase
    .from('leads')
    .update({ status_id: step.status_id })
    .eq('id', lead.id);

  logger.debug(`Changed status of lead ${lead.id} to ${step.status_id}`);
}

async function executeReminderStep(lead: Lead, step: SequenceStep): Promise<void> {
  if (!step.reminder) return;

  const dueAt = new Date(Date.now() + step.reminder.due_minutes * 60 * 1000).toISOString();

  await supabase.from('reminders').insert({
    lead_id: lead.id,
    title: step.reminder.title,
    due_at: dueAt,
    priority: step.reminder.priority || 'medium',
    status: 'pending',
  });

  logger.debug(`Created reminder for lead ${lead.id}: ${step.reminder.title}`);
}

async function executeTagStep(lead: Lead, step: SequenceStep): Promise<void> {
  // Add tags
  if (step.tags_to_add && step.tags_to_add.length > 0) {
    const tagsToInsert = step.tags_to_add.map(tag => ({
      lead_id: lead.id,
      tag,
    }));

    await supabase.from('lead_tags').upsert(tagsToInsert, {
      onConflict: 'lead_id,tag',
      ignoreDuplicates: true,
    });
  }

  // Remove tags
  if (step.tags_to_remove && step.tags_to_remove.length > 0) {
    await supabase
      .from('lead_tags')
      .delete()
      .eq('lead_id', lead.id)
      .in('tag', step.tags_to_remove);
  }

  logger.debug(`Updated tags for lead ${lead.id}`);
}

async function executeAssignStep(lead: Lead, step: SequenceStep): Promise<void> {
  if (!step.assign_to_account_id) return;

  await supabase
    .from('leads')
    .update({ assigned_account_id: step.assign_to_account_id })
    .eq('id', lead.id);

  logger.debug(`Assigned lead ${lead.id} to account ${step.assign_to_account_id}`);
}

async function executeWebhookStep(
  lead: Lead,
  step: SequenceStep,
  sequence: Sequence
): Promise<void> {
  if (!step.webhook_url) return;

  const payload = {
    event: 'sequence_step',
    sequence_id: sequence.id,
    sequence_name: sequence.name,
    lead: {
      id: lead.id,
      tg_user_id: lead.tg_user_id,
      username: lead.username,
      first_name: lead.first_name,
      last_name: lead.last_name,
    },
    timestamp: new Date().toISOString(),
  };

  const options: RequestInit = {
    method: step.webhook_method || 'POST',
    headers: { 'Content-Type': 'application/json' },
  };

  if (step.webhook_method !== 'GET') {
    options.body = JSON.stringify(payload);
  }

  await fetch(step.webhook_url, options);
  logger.debug(`Called webhook for lead ${lead.id}`);
}

async function executeWaitStep(
  enrollment: SequenceEnrollment,
  step: SequenceStep
): Promise<void> {
  if (!step.wait_condition) return;

  const timeoutMs = (step.wait_condition.timeout_minutes || 60) * 60 * 1000;
  const waitUntil = new Date(Date.now() + timeoutMs).toISOString();

  await supabase
    .from('sequence_enrollments')
    .update({
      waiting_for: step.wait_condition.type,
      wait_until: waitUntil,
      next_step_at: null, // Clear scheduled step
    })
    .eq('id', enrollment.id);

  logger.debug(`Set wait condition ${step.wait_condition.type} for enrollment ${enrollment.id}`);
}

async function executeBranchStep(
  enrollment: SequenceEnrollment,
  lead: Lead,
  step: SequenceStep,
  allSteps: SequenceStep[]
): Promise<void> {
  if (!step.branches) {
    // No branches, use default
    if (step.default_next_step_id) {
      await goToStep(enrollment, step.default_next_step_id, allSteps);
    }
    return;
  }

  // Evaluate branches
  for (const branch of step.branches) {
    const matches = await evaluateBranchCondition(lead, branch.condition);
    if (matches) {
      await goToStep(enrollment, branch.next_step_id, allSteps);
      return;
    }
  }

  // No branch matched, use default
  if (step.default_next_step_id) {
    await goToStep(enrollment, step.default_next_step_id, allSteps);
  } else {
    // Complete sequence
    await completeEnrollment(enrollment);
  }
}

async function evaluateBranchCondition(
  lead: Lead,
  condition: { type: string; value?: string }
): Promise<boolean> {
  switch (condition.type) {
    case 'replied': {
      // Check if lead has sent any messages recently
      const { data: messages } = await supabase
        .from('messages')
        .select('id')
        .eq('lead_id', lead.id)
        .eq('direction', 'incoming')
        .gte('sent_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .limit(1);
      return (messages?.length || 0) > 0;
    }
    case 'no_reply': {
      const { data: messages } = await supabase
        .from('messages')
        .select('id')
        .eq('lead_id', lead.id)
        .eq('direction', 'incoming')
        .gte('sent_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .limit(1);
      return (messages?.length || 0) === 0;
    }
    case 'status_is':
      return lead.status_id === condition.value;
    case 'has_tag': {
      const { data: tags } = await supabase
        .from('lead_tags')
        .select('tag')
        .eq('lead_id', lead.id)
        .eq('tag', condition.value || '')
        .limit(1);
      return (tags?.length || 0) > 0;
    }
    default:
      return true;
  }
}

async function goToStep(
  enrollment: SequenceEnrollment,
  nextStepId: string,
  allSteps: SequenceStep[]
): Promise<void> {
  const nextStep = allSteps.find(s => s.id === nextStepId);
  if (!nextStep) {
    await completeEnrollment(enrollment);
    return;
  }

  const delayMs = (nextStep.delay_minutes || 0) * 60 * 1000;
  const nextStepAt = delayMs > 0 ? new Date(Date.now() + delayMs).toISOString() : null;

  await supabase
    .from('sequence_enrollments')
    .update({
      current_step_id: nextStepId,
      next_step_at: nextStepAt,
    })
    .eq('id', enrollment.id);

  // Execute immediately if no delay
  if (!nextStepAt) {
    await executeSequenceStep(enrollment.id, nextStepId);
  }
}

async function advanceToNextStep(
  enrollment: SequenceEnrollment,
  currentStep: SequenceStep,
  allSteps: SequenceStep[]
): Promise<void> {
  // Find next step by order
  const nextStep = allSteps
    .filter(s => s.order > currentStep.order)
    .sort((a, b) => a.order - b.order)[0];

  if (!nextStep) {
    // Sequence completed
    await completeEnrollment(enrollment);
    return;
  }

  await goToStep(enrollment, nextStep.id, allSteps);
}

async function completeEnrollment(enrollment: SequenceEnrollment): Promise<void> {
  await supabase
    .from('sequence_enrollments')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      current_step_id: null,
      next_step_at: null,
    })
    .eq('id', enrollment.id);

  logger.info(`Completed sequence enrollment ${enrollment.id}`);
}

async function saveOutgoingMessage(
  leadId: string,
  accountId: string,
  type: string,
  content: string,
  tgMessageId: string,
  mediaUrl?: string
): Promise<void> {
  await supabase.from('messages').insert({
    lead_id: leadId,
    account_id: accountId,
    direction: 'outgoing',
    type,
    content,
    media_url: mediaUrl,
    status: 'sent',
    tg_message_id: tgMessageId,
    sent_at: new Date().toISOString(),
  });

  // Update lead's last_message_at
  await supabase
    .from('leads')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', leadId);
}

// Handle reply to check if waiting enrollment should proceed
export async function handleLeadReply(leadId: string): Promise<void> {
  const { data: waitingEnrollments } = await supabase
    .from('sequence_enrollments')
    .select('*, sequences(*)')
    .eq('lead_id', leadId)
    .eq('status', 'active')
    .eq('waiting_for', 'reply');

  if (!waitingEnrollments || waitingEnrollments.length === 0) return;

  for (const enrollment of waitingEnrollments) {
    const sequence = enrollment.sequences as Sequence;
    const steps = sequence.steps as SequenceStep[];
    const currentStep = steps.find(s => s.id === enrollment.current_step_id);

    if (!currentStep) continue;

    // Clear wait and advance
    await supabase
      .from('sequence_enrollments')
      .update({
        waiting_for: null,
        wait_until: null,
      })
      .eq('id', enrollment.id);

    await advanceToNextStep(enrollment as SequenceEnrollment, currentStep, steps);
  }
}
