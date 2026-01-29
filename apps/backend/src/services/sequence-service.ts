import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';
import { TgAccountManager } from './tg-account-manager.js';
import { WebSocketHub } from './websocket-hub.js';
import type { Sequence, SequenceStep, Lead, Message } from '@outreach/shared/types/entities.js';

const logger = createLogger('SequenceService');

export class SequenceService {
  constructor(
    private tgManager: TgAccountManager,
    private wsHub: WebSocketHub
  ) {}

  async processIncomingMessage(
    accountId: string,
    senderId: string,
    messageText: string,
    sourceCampaignId?: string
  ): Promise<void> {
    // Check if lead exists
    let { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('tg_user_id', senderId)
      .single();

    if (!lead) {
      // Create new lead
      const { data: defaultStatus } = await supabase
        .from('lead_statuses')
        .select('id')
        .eq('is_default', true)
        .single();

      const { data: newLead } = await supabase
        .from('leads')
        .insert({
          tg_user_id: senderId,
          status_id: defaultStatus?.id,
          source_campaign_id: sourceCampaignId,
          assigned_account_id: accountId,
        })
        .select()
        .single();

      lead = newLead;

      if (lead) {
        this.wsHub.broadcast('lead:new', { lead });
      }
    }

    if (!lead) {
      logger.error(`Failed to create/find lead for ${senderId}`);
      return;
    }

    // Save incoming message
    const { data: savedMessage } = await supabase
      .from('messages')
      .insert({
        lead_id: lead.id,
        account_id: accountId,
        direction: 'incoming',
        type: 'text',
        content: messageText,
        status: 'delivered',
      })
      .select()
      .single();

    // Emit new message event
    if (savedMessage) {
      this.wsHub.emitNewMessage(lead.id, savedMessage, lead);
    }

    // Update lead last message time
    await supabase
      .from('leads')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', lead.id);

    // Check for matching sequences
    await this.checkAndEnrollSequence(lead as Lead, messageText, accountId);
  }

  private async checkAndEnrollSequence(
    lead: Lead,
    messageText: string,
    accountId: string
  ): Promise<void> {
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
      if (this.matchesTrigger(seq, messageText, lead)) {
        await this.enrollLead(lead, seq);
        break; // Only enroll in first matching sequence
      }
    }
  }

  private matchesTrigger(sequence: Sequence, messageText: string, lead: Lead): boolean {
    const trigger = sequence.trigger;

    switch (trigger.type) {
      case 'any':
        return true;

      case 'new_message':
        // Only trigger for first message from lead
        return true; // Simplified - would check message count

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

  private async enrollLead(lead: Lead, sequence: Sequence): Promise<void> {
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

    logger.info(`Enrolled lead ${lead.id} in sequence ${sequence.name}`);
  }

  async processScheduledSteps(): Promise<void> {
    // Get enrollments ready to execute
    const { data: enrollments } = await supabase
      .from('sequence_enrollments')
      .select('*, sequences(*), leads(*)')
      .eq('status', 'active')
      .lte('next_step_at', new Date().toISOString());

    if (!enrollments?.length) return;

    for (const enrollment of enrollments) {
      const sequence = enrollment.sequences as unknown as Sequence;
      const lead = enrollment.leads as unknown as Lead;

      if (!sequence || !lead) continue;

      const currentStep = sequence.steps[enrollment.current_step] as SequenceStep | undefined;
      if (!currentStep) {
        // Sequence completed
        await supabase
          .from('sequence_enrollments')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
          })
          .eq('id', enrollment.id);
        continue;
      }

      try {
        await this.executeStep(lead, currentStep, sequence.id);

        // Move to next step
        const nextStep = sequence.steps[enrollment.current_step + 1] as SequenceStep | undefined;
        const nextStepAt = nextStep
          ? new Date(Date.now() + (nextStep.delay_minutes || 0) * 60 * 1000)
          : null;

        await supabase
          .from('sequence_enrollments')
          .update({
            current_step: enrollment.current_step + 1,
            next_step_at: nextStepAt?.toISOString(),
            status: nextStep ? 'active' : 'completed',
            completed_at: nextStep ? null : new Date().toISOString(),
          })
          .eq('id', enrollment.id);
      } catch (error) {
        logger.error(`Failed to execute step for enrollment ${enrollment.id}`, error);
      }
    }
  }

  private async executeStep(lead: Lead, step: SequenceStep, sequenceId: string): Promise<void> {
    logger.info(`Executing step ${step.id} (${step.type}) for lead ${lead.id}`);

    switch (step.type) {
      case 'message':
        await this.executeMessageStep(lead, step, sequenceId);
        break;

      case 'status_change':
        await this.executeStatusChangeStep(lead, step);
        break;

      case 'reminder':
        await this.executeReminderStep(lead, step);
        break;

      case 'tag':
        await this.executeTagStep(lead, step);
        break;

      case 'assign':
        await this.executeAssignStep(lead, step);
        break;

      case 'webhook':
        await this.executeWebhookStep(lead, step);
        break;

      case 'wait':
        // Wait steps are handled by the condition check
        break;

      case 'branch':
        // Branch steps are handled in processScheduledSteps
        break;

      default:
        logger.warn(`Unknown step type: ${step.type}`);
    }

    logger.info(`Completed step ${step.id} for lead ${lead.id}`);
  }

  private async executeMessageStep(lead: Lead, step: SequenceStep, sequenceId: string): Promise<void> {
    if (!lead.assigned_account_id) {
      throw new Error('Lead has no assigned account');
    }

    if (!step.content) {
      throw new Error('Message step has no content');
    }

    const messageType = step.message_type || 'text';

    // Save outgoing message
    const { data: message } = await supabase
      .from('messages')
      .insert({
        lead_id: lead.id,
        account_id: lead.assigned_account_id,
        direction: 'outgoing',
        type: messageType,
        content: messageType === 'text' ? step.content : null,
        media_url: messageType !== 'text' ? step.content : null,
        status: 'pending',
        sequence_id: sequenceId,
        sequence_step_id: step.id,
      })
      .select()
      .single();

    try {
      switch (messageType) {
        case 'text':
          await this.tgManager.sendMessage(
            lead.assigned_account_id,
            lead.tg_user_id,
            step.content
          );
          break;

        case 'video':
        case 'photo':
        case 'document':
          await this.tgManager.sendMedia(
            lead.assigned_account_id,
            lead.tg_user_id,
            step.content
          );
          break;

        case 'video_note':
          await this.tgManager.sendMedia(
            lead.assigned_account_id,
            lead.tg_user_id,
            step.content,
            undefined,
            true
          );
          break;

        case 'voice':
          await this.tgManager.sendMedia(
            lead.assigned_account_id,
            lead.tg_user_id,
            step.content,
            undefined,
            false,
            true
          );
          break;
      }

      // Update message status
      if (message) {
        await supabase
          .from('messages')
          .update({
            status: 'sent',
            sent_at: new Date().toISOString(),
          })
          .eq('id', message.id);

        this.wsHub.emitMessageSent(lead.id, message.id);
      }
    } catch (error) {
      if (message) {
        await supabase
          .from('messages')
          .update({ status: 'failed' })
          .eq('id', message.id);
      }
      throw error;
    }
  }

  private async executeStatusChangeStep(lead: Lead, step: SequenceStep): Promise<void> {
    if (!step.status_id) {
      throw new Error('Status change step has no status_id');
    }

    await supabase
      .from('leads')
      .update({ status_id: step.status_id })
      .eq('id', lead.id);

    // Broadcast status change
    this.wsHub.broadcast('lead:status_changed', {
      lead_id: lead.id,
      status_id: step.status_id,
    });

    logger.info(`Changed status of lead ${lead.id} to ${step.status_id}`);
  }

  private async executeReminderStep(lead: Lead, step: SequenceStep): Promise<void> {
    if (!step.reminder) {
      throw new Error('Reminder step has no reminder config');
    }

    const dueAt = new Date(Date.now() + step.reminder.due_minutes * 60 * 1000);

    await supabase.from('reminders').insert({
      lead_id: lead.id,
      title: step.reminder.title,
      due_at: dueAt.toISOString(),
      priority: step.reminder.priority || 'medium',
      status: 'pending',
    });

    logger.info(`Created reminder for lead ${lead.id}: ${step.reminder.title}`);
  }

  private async executeTagStep(lead: Lead, step: SequenceStep): Promise<void> {
    const currentTags = (lead.custom_fields?.tags as string[]) || [];
    let newTags = [...currentTags];

    if (step.tags_to_add?.length) {
      newTags = [...new Set([...newTags, ...step.tags_to_add])];
    }

    if (step.tags_to_remove?.length) {
      newTags = newTags.filter((tag) => !step.tags_to_remove?.includes(tag));
    }

    await supabase
      .from('leads')
      .update({
        custom_fields: {
          ...lead.custom_fields,
          tags: newTags,
        },
      })
      .eq('id', lead.id);

    logger.info(`Updated tags for lead ${lead.id}`);
  }

  private async executeAssignStep(lead: Lead, step: SequenceStep): Promise<void> {
    if (!step.assign_to_account_id) {
      throw new Error('Assign step has no assign_to_account_id');
    }

    await supabase
      .from('leads')
      .update({ assigned_account_id: step.assign_to_account_id })
      .eq('id', lead.id);

    logger.info(`Assigned lead ${lead.id} to account ${step.assign_to_account_id}`);
  }

  private async executeWebhookStep(lead: Lead, step: SequenceStep): Promise<void> {
    if (!step.webhook_url) {
      throw new Error('Webhook step has no webhook_url');
    }

    const method = step.webhook_method || 'POST';

    try {
      const response = await fetch(step.webhook_url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: method === 'POST' ? JSON.stringify({
          lead_id: lead.id,
          lead: {
            tg_user_id: lead.tg_user_id,
            username: lead.username,
            first_name: lead.first_name,
            last_name: lead.last_name,
          },
          timestamp: new Date().toISOString(),
        }) : undefined,
      });

      if (!response.ok) {
        logger.warn(`Webhook returned ${response.status} for lead ${lead.id}`);
      }
    } catch (error) {
      logger.error(`Webhook failed for lead ${lead.id}`, error);
      // Don't throw - webhook failures shouldn't stop the sequence
    }
  }

  async cancelEnrollment(leadId: string, sequenceId?: string): Promise<void> {
    let query = supabase
      .from('sequence_enrollments')
      .update({ status: 'cancelled' })
      .eq('lead_id', leadId)
      .eq('status', 'active');

    if (sequenceId) {
      query = query.eq('sequence_id', sequenceId);
    }

    await query;
  }
}
