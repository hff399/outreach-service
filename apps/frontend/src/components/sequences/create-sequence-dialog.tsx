'use client';

import { useState } from 'react';
import { generateId } from '@/lib/utils';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Loader2,
  Plus,
  X,
  GripVertical,
  MessageSquare,
  Video,
  Mic,
  Image,
  FileText,
  CircleDot,
  Bell,
  Tag,
  UserCheck,
  Webhook,
  Clock,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { sequencesApi, accountsApi, statusesApi } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

type CreateSequenceDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type StepType = 'message' | 'status_change' | 'reminder' | 'tag' | 'assign' | 'webhook' | 'wait';
type MessageType = 'text' | 'video' | 'video_note' | 'voice' | 'photo' | 'document';
type TriggerType = 'any' | 'new_message' | 'keyword' | 'regex' | 'no_reply' | 'no_response' | 'status_change';

type TriggerCondition = {
  field: 'status' | 'tag' | 'has_messages' | 'last_message_direction' | 'custom_field';
  operator: 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'is_empty' | 'is_not_empty';
  value?: string;
  custom_field_key?: string;
};

type Step = {
  id: string;
  type: StepType;
  delay_minutes: number;
  // Message fields
  message_type?: MessageType;
  content?: string;
  // Status change fields
  status_id?: string;
  // Reminder fields
  reminder?: {
    title: string;
    due_minutes: number;
    priority: 'low' | 'medium' | 'high';
  };
  // Tag fields
  tags_to_add?: string[];
  tags_to_remove?: string[];
  // Assign fields
  assign_to_account_id?: string;
  // Webhook fields
  webhook_url?: string;
  webhook_method?: 'GET' | 'POST';
  // Wait fields
  wait_condition?: {
    type: 'reply' | 'no_reply' | 'time';
    timeout_minutes?: number;
  };
};

type Account = { id: string; phone: string; username: string | null; first_name: string | null; is_connected: boolean };
type LeadStatus = { id: string; name: string; color: string };

const stepTypeIcons: Record<StepType, React.ReactNode> = {
  message: <MessageSquare className="h-4 w-4" />,
  status_change: <CircleDot className="h-4 w-4" />,
  reminder: <Bell className="h-4 w-4" />,
  tag: <Tag className="h-4 w-4" />,
  assign: <UserCheck className="h-4 w-4" />,
  webhook: <Webhook className="h-4 w-4" />,
  wait: <Clock className="h-4 w-4" />,
};

const stepTypeLabels: Record<StepType, string> = {
  message: 'Send Message',
  status_change: 'Change Status',
  reminder: 'Create Reminder',
  tag: 'Add/Remove Tags',
  assign: 'Assign to Account',
  webhook: 'Call Webhook',
  wait: 'Wait for Condition',
};

const messageTypeIcons: Record<MessageType, React.ReactNode> = {
  text: <MessageSquare className="h-4 w-4" />,
  video: <Video className="h-4 w-4" />,
  video_note: <Video className="h-4 w-4" />,
  voice: <Mic className="h-4 w-4" />,
  photo: <Image className="h-4 w-4" />,
  document: <FileText className="h-4 w-4" />,
};

const messageTypeLabels: Record<MessageType, string> = {
  text: 'Text Message',
  video: 'Video',
  video_note: 'Video Circle',
  voice: 'Voice Message',
  photo: 'Photo',
  document: 'Document',
};

export function CreateSequenceDialog({ open, onOpenChange }: CreateSequenceDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [triggerType, setTriggerType] = useState<TriggerType>('any');
  const [keywords, setKeywords] = useState('');
  const [regexPattern, setRegexPattern] = useState('');
  const [timeoutMinutes, setTimeoutMinutes] = useState(60);
  const [triggerConditions, setTriggerConditions] = useState<TriggerCondition[]>([]);
  const [steps, setSteps] = useState<Step[]>([
    { id: generateId(), type: 'message', message_type: 'text', content: '', delay_minutes: 0 },
  ]);
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');

  const { data: accounts } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountsApi.list() as Promise<Account[]>,
  });

  const { data: statuses } = useQuery({
    queryKey: ['statuses'],
    queryFn: () => statusesApi.list() as Promise<LeadStatus[]>,
  });

  // Show all accounts with active/auth_required status - sequences work when account is connected
  const availableAccounts = accounts || [];

  const createMutation = useMutation({
    mutationFn: () => {
      const trigger: {
        type: TriggerType;
        keywords?: string[];
        regex_pattern?: string;
        timeout_minutes?: number;
        conditions?: TriggerCondition[];
      } = {
        type: triggerType,
      };

      if (triggerType === 'keyword' && keywords) {
        trigger.keywords = keywords.split(',').map((k) => k.trim()).filter(Boolean);
      }
      if (triggerType === 'regex' && regexPattern) {
        trigger.regex_pattern = regexPattern;
      }
      if ((triggerType === 'no_reply' || triggerType === 'no_response') && timeoutMinutes) {
        trigger.timeout_minutes = timeoutMinutes;
      }
      if (triggerConditions.length > 0) {
        trigger.conditions = triggerConditions;
      }

      return sequencesApi.create({
        name,
        description: description || undefined,
        trigger,
        steps: steps.map((step, index) => {
          const baseStep: Record<string, unknown> = {
            order: index,
            type: step.type,
            delay_minutes: step.delay_minutes,
          };

          switch (step.type) {
            case 'message':
              baseStep.message_type = step.message_type;
              baseStep.content = step.content;
              break;
            case 'status_change':
              baseStep.status_id = step.status_id;
              break;
            case 'reminder':
              baseStep.reminder = step.reminder;
              break;
            case 'tag':
              baseStep.tags_to_add = step.tags_to_add;
              baseStep.tags_to_remove = step.tags_to_remove;
              break;
            case 'assign':
              baseStep.assign_to_account_id = step.assign_to_account_id;
              break;
            case 'webhook':
              baseStep.webhook_url = step.webhook_url;
              baseStep.webhook_method = step.webhook_method;
              break;
            case 'wait':
              baseStep.wait_condition = step.wait_condition;
              break;
          }

          return baseStep;
        }),
        assigned_accounts: selectedAccounts,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sequences'] });
      onOpenChange(false);
      resetForm();
      toast({ title: 'Sequence created', description: 'Auto-responder is now active' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const resetForm = () => {
    setName('');
    setDescription('');
    setTriggerType('any');
    setKeywords('');
    setRegexPattern('');
    setTimeoutMinutes(60);
    setTriggerConditions([]);
    setSteps([{ id: generateId(), type: 'message', message_type: 'text', content: '', delay_minutes: 0 }]);
    setSelectedAccounts([]);
  };

  const addTriggerCondition = () => {
    setTriggerConditions([
      ...triggerConditions,
      { field: 'status', operator: 'equals', value: '' },
    ]);
  };

  const updateTriggerCondition = (index: number, updates: Partial<TriggerCondition>) => {
    setTriggerConditions(
      triggerConditions.map((c, i) => (i === index ? { ...c, ...updates } : c))
    );
  };

  const removeTriggerCondition = (index: number) => {
    setTriggerConditions(triggerConditions.filter((_, i) => i !== index));
  };

  const addStep = (type: StepType = 'message') => {
    const newStep: Step = {
      id: generateId(),
      type,
      delay_minutes: 1,
    };

    switch (type) {
      case 'message':
        newStep.message_type = 'text';
        newStep.content = '';
        break;
      case 'status_change':
        newStep.status_id = statuses?.[0]?.id;
        break;
      case 'reminder':
        newStep.reminder = { title: '', due_minutes: 60, priority: 'medium' };
        break;
      case 'tag':
        newStep.tags_to_add = [];
        newStep.tags_to_remove = [];
        break;
      case 'assign':
        newStep.assign_to_account_id = availableAccounts?.[0]?.id;
        break;
      case 'webhook':
        newStep.webhook_url = '';
        newStep.webhook_method = 'POST';
        break;
      case 'wait':
        newStep.wait_condition = { type: 'reply', timeout_minutes: 60 };
        break;
    }

    setSteps([...steps, newStep]);
  };

  const removeStep = (id: string) => {
    if (steps.length > 1) {
      setSteps(steps.filter((s) => s.id !== id));
    }
  };

  const updateStep = (id: string, updates: Partial<Step>) => {
    setSteps(steps.map((s) => (s.id === id ? { ...s, ...updates } : s)));
  };

  const toggleAccount = (accountId: string) => {
    setSelectedAccounts((prev) =>
      prev.includes(accountId) ? prev.filter((id) => id !== accountId) : [...prev, accountId]
    );
  };

  const addTagToStep = (stepId: string, tag: string, field: 'tags_to_add' | 'tags_to_remove') => {
    const step = steps.find((s) => s.id === stepId);
    if (!step || !tag.trim()) return;

    const currentTags = step[field] || [];
    if (!currentTags.includes(tag.trim())) {
      updateStep(stepId, { [field]: [...currentTags, tag.trim()] });
    }
    setNewTag('');
  };

  const removeTagFromStep = (stepId: string, tag: string, field: 'tags_to_add' | 'tags_to_remove') => {
    const step = steps.find((s) => s.id === stepId);
    if (!step) return;

    const currentTags = step[field] || [];
    updateStep(stepId, { [field]: currentTags.filter((t) => t !== tag) });
  };

  const isStepValid = (step: Step): boolean => {
    switch (step.type) {
      case 'message':
        return !!step.content;
      case 'status_change':
        return !!step.status_id;
      case 'reminder':
        return !!step.reminder?.title && !!step.reminder?.due_minutes;
      case 'tag':
        return (step.tags_to_add?.length || 0) > 0 || (step.tags_to_remove?.length || 0) > 0;
      case 'assign':
        return !!step.assign_to_account_id;
      case 'webhook':
        return !!step.webhook_url;
      case 'wait':
        return !!step.wait_condition?.type;
      default:
        return false;
    }
  };

  const canCreate = name && steps.every(isStepValid) && selectedAccounts.length > 0;

  const renderStepConfig = (step: Step) => {
    switch (step.type) {
      case 'message':
        return (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Message Type</Label>
              <Select
                value={step.message_type}
                onValueChange={(v) => updateStep(step.id, { message_type: v as MessageType })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(messageTypeLabels).map(([type, label]) => (
                    <SelectItem key={type} value={type}>
                      <div className="flex items-center gap-2">
                        {messageTypeIcons[type as MessageType]}
                        {label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">
                {step.message_type === 'text' ? 'Message Content' : 'Media URL/Path'}
              </Label>
              {step.message_type === 'text' ? (
                <Textarea
                  placeholder="Enter your message..."
                  value={step.content || ''}
                  onChange={(e) => updateStep(step.id, { content: e.target.value })}
                  className="min-h-[80px]"
                />
              ) : (
                <Input
                  placeholder={`Enter ${step.message_type} URL or file path...`}
                  value={step.content || ''}
                  onChange={(e) => updateStep(step.id, { content: e.target.value })}
                />
              )}
            </div>
          </div>
        );

      case 'status_change':
        return (
          <div>
            <Label className="text-xs">Change status to</Label>
            <Select
              value={step.status_id}
              onValueChange={(v) => updateStep(step.id, { status_id: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                {statuses?.map((status) => (
                  <SelectItem key={status.id} value={status.id}>
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: status.color }}
                      />
                      {status.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );

      case 'reminder':
        return (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Reminder Title</Label>
              <Input
                placeholder="e.g., Follow up with lead"
                value={step.reminder?.title || ''}
                onChange={(e) =>
                  updateStep(step.id, {
                    reminder: { ...step.reminder!, title: e.target.value },
                  })
                }
              />
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <Label className="text-xs">Due in (minutes)</Label>
                <Input
                  type="number"
                  min="1"
                  value={step.reminder?.due_minutes || 60}
                  onChange={(e) =>
                    updateStep(step.id, {
                      reminder: { ...step.reminder!, due_minutes: parseInt(e.target.value) || 60 },
                    })
                  }
                />
              </div>
              <div className="flex-1">
                <Label className="text-xs">Priority</Label>
                <Select
                  value={step.reminder?.priority || 'medium'}
                  onValueChange={(v) =>
                    updateStep(step.id, {
                      reminder: { ...step.reminder!, priority: v as 'low' | 'medium' | 'high' },
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        );

      case 'tag':
        return (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Tags to Add</Label>
              <div className="flex gap-2 mt-1">
                <Input
                  placeholder="Enter tag..."
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addTagToStep(step.id, newTag, 'tags_to_add');
                    }
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => addTagToStep(step.id, newTag, 'tags_to_add')}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex flex-wrap gap-1 mt-2">
                {step.tags_to_add?.map((tag) => (
                  <Badge key={tag} variant="default" className="gap-1">
                    {tag}
                    <X
                      className="h-3 w-3 cursor-pointer"
                      onClick={() => removeTagFromStep(step.id, tag, 'tags_to_add')}
                    />
                  </Badge>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-xs">Tags to Remove</Label>
              <div className="flex gap-2 mt-1">
                <Input
                  placeholder="Enter tag..."
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addTagToStep(step.id, (e.target as HTMLInputElement).value, 'tags_to_remove');
                      (e.target as HTMLInputElement).value = '';
                    }
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={(e) => {
                    const input = (e.target as HTMLElement).parentElement?.querySelector('input');
                    if (input) {
                      addTagToStep(step.id, input.value, 'tags_to_remove');
                      input.value = '';
                    }
                  }}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex flex-wrap gap-1 mt-2">
                {step.tags_to_remove?.map((tag) => (
                  <Badge key={tag} variant="destructive" className="gap-1">
                    {tag}
                    <X
                      className="h-3 w-3 cursor-pointer"
                      onClick={() => removeTagFromStep(step.id, tag, 'tags_to_remove')}
                    />
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        );

      case 'assign':
        return (
          <div>
            <Label className="text-xs">Assign to Account</Label>
            <Select
              value={step.assign_to_account_id}
              onValueChange={(v) => updateStep(step.id, { assign_to_account_id: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select account" />
              </SelectTrigger>
              <SelectContent>
                {availableAccounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.first_name || account.username || account.phone}
                    {!account.is_connected && ' (offline)'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );

      case 'webhook':
        return (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Webhook URL</Label>
              <Input
                type="url"
                placeholder="https://example.com/webhook"
                value={step.webhook_url || ''}
                onChange={(e) => updateStep(step.id, { webhook_url: e.target.value })}
              />
            </div>
            <div>
              <Label className="text-xs">Method</Label>
              <Select
                value={step.webhook_method || 'POST'}
                onValueChange={(v) => updateStep(step.id, { webhook_method: v as 'GET' | 'POST' })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="POST">POST</SelectItem>
                  <SelectItem value="GET">GET</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        );

      case 'wait':
        return (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Wait Condition</Label>
              <Select
                value={step.wait_condition?.type || 'reply'}
                onValueChange={(v) =>
                  updateStep(step.id, {
                    wait_condition: { ...step.wait_condition!, type: v as 'reply' | 'no_reply' | 'time' },
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="reply">Wait for reply</SelectItem>
                  <SelectItem value="no_reply">Wait for no reply (timeout)</SelectItem>
                  <SelectItem value="time">Wait for specific time</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Timeout (minutes)</Label>
              <Input
                type="number"
                min="1"
                value={step.wait_condition?.timeout_minutes || 60}
                onChange={(e) =>
                  updateStep(step.id, {
                    wait_condition: {
                      ...step.wait_condition!,
                      timeout_minutes: parseInt(e.target.value) || 60,
                    },
                  })
                }
              />
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Auto-Responder Sequence</DialogTitle>
          <DialogDescription>
            Set up automatic responses and automations when leads message your accounts
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          {/* Basic Info */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Sequence Name *</Label>
              <Input
                id="name"
                placeholder="e.g., Designer Welcome Sequence"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="What does this sequence do?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>

          {/* Trigger */}
          <div className="space-y-4">
            <Label className="text-base font-semibold">Trigger Conditions</Label>

            <div className="space-y-2">
              <Label>When to trigger</Label>
              <Select value={triggerType} onValueChange={(v) => setTriggerType(v as TriggerType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any incoming message</SelectItem>
                  <SelectItem value="new_message">First message from new lead</SelectItem>
                  <SelectItem value="keyword">Contains keywords</SelectItem>
                  <SelectItem value="regex">Matches regex pattern</SelectItem>
                  <SelectItem value="no_response">No response from us (follow-up)</SelectItem>
                  <SelectItem value="no_reply">Lead hasn't replied</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {triggerType === 'keyword' && (
              <div className="space-y-2">
                <Label htmlFor="keywords">Keywords (comma-separated)</Label>
                <Input
                  id="keywords"
                  placeholder="designer, portfolio, rate, price"
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Triggers when message contains any of these words
                </p>
              </div>
            )}

            {triggerType === 'regex' && (
              <div className="space-y-2">
                <Label htmlFor="regex">Regex Pattern</Label>
                <Input
                  id="regex"
                  placeholder="^(hi|hello|hey)"
                  value={regexPattern}
                  onChange={(e) => setRegexPattern(e.target.value)}
                />
              </div>
            )}

            {(triggerType === 'no_response' || triggerType === 'no_reply') && (
              <div className="space-y-2">
                <Label htmlFor="timeout">Timeout (minutes)</Label>
                <Input
                  id="timeout"
                  type="number"
                  min="1"
                  value={timeoutMinutes}
                  onChange={(e) => setTimeoutMinutes(parseInt(e.target.value) || 60)}
                />
                <p className="text-xs text-muted-foreground">
                  {triggerType === 'no_response'
                    ? 'Trigger follow-up if we haven\'t responded within this time'
                    : 'Trigger if lead hasn\'t replied within this time'}
                </p>
              </div>
            )}

            {/* Additional Conditions */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm">Additional Conditions (optional)</Label>
                <Button type="button" variant="outline" size="sm" onClick={addTriggerCondition}>
                  <Plus className="h-3 w-3 mr-1" /> Add
                </Button>
              </div>

              {triggerConditions.map((condition, index) => (
                <div key={index} className="flex gap-2 items-start p-2 border rounded-md bg-muted/30">
                  <Select
                    value={condition.field}
                    onValueChange={(v) => updateTriggerCondition(index, { field: v as TriggerCondition['field'] })}
                  >
                    <SelectTrigger className="w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="status">Status</SelectItem>
                      <SelectItem value="tag">Has tag</SelectItem>
                      <SelectItem value="has_messages">Has messages</SelectItem>
                      <SelectItem value="last_message_direction">Last message</SelectItem>
                    </SelectContent>
                  </Select>

                  <Select
                    value={condition.operator}
                    onValueChange={(v) => updateTriggerCondition(index, { operator: v as TriggerCondition['operator'] })}
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="equals">equals</SelectItem>
                      <SelectItem value="not_equals">not equals</SelectItem>
                      <SelectItem value="contains">contains</SelectItem>
                      <SelectItem value="is_empty">is empty</SelectItem>
                      <SelectItem value="is_not_empty">is not empty</SelectItem>
                    </SelectContent>
                  </Select>

                  {condition.field === 'status' && (
                    <Select
                      value={condition.value || ''}
                      onValueChange={(v) => updateTriggerCondition(index, { value: v })}
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="Select status" />
                      </SelectTrigger>
                      <SelectContent>
                        {statuses?.map((status) => (
                          <SelectItem key={status.id} value={status.id}>
                            {status.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}

                  {condition.field === 'last_message_direction' && (
                    <Select
                      value={condition.value || ''}
                      onValueChange={(v) => updateTriggerCondition(index, { value: v })}
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="Direction" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="incoming">Incoming (from lead)</SelectItem>
                        <SelectItem value="outgoing">Outgoing (from us)</SelectItem>
                      </SelectContent>
                    </Select>
                  )}

                  {(condition.field === 'tag' || condition.field === 'has_messages') && (
                    <Input
                      className="flex-1"
                      placeholder={condition.field === 'tag' ? 'Tag name' : 'Value'}
                      value={condition.value || ''}
                      onChange={(e) => updateTriggerCondition(index, { value: e.target.value })}
                    />
                  )}

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeTriggerCondition(index)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}

              {triggerConditions.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Add conditions to filter which leads this sequence applies to
                </p>
              )}
            </div>
          </div>

          {/* Accounts */}
          <div className="space-y-2">
            <Label>Apply to Accounts *</Label>
            <p className="text-xs text-muted-foreground mb-2">
              This sequence will respond to messages on these accounts
            </p>
            <div className="flex flex-wrap gap-2">
              {availableAccounts.map((account) => (
                <Badge
                  key={account.id}
                  variant={selectedAccounts.includes(account.id) ? 'default' : 'outline'}
                  className={`cursor-pointer ${account.is_connected ? 'border-green-500' : 'opacity-70'}`}
                  onClick={() => toggleAccount(account.id)}
                >
                  <span className={`w-2 h-2 rounded-full mr-1.5 ${account.is_connected ? 'bg-green-500' : 'bg-gray-400'}`} />
                  {account.first_name || account.username || account.phone}
                  {selectedAccounts.includes(account.id) && <X className="ml-1 h-3 w-3" />}
                </Badge>
              ))}
              {availableAccounts.length === 0 && (
                <p className="text-sm text-muted-foreground">No accounts available</p>
              )}
            </div>
          </div>

          {/* Steps */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label className="text-base font-semibold">Sequence Steps</Label>
              <Select onValueChange={(v) => addStep(v as StepType)}>
                <SelectTrigger className="w-[180px]">
                  <Plus className="mr-2 h-4 w-4" />
                  Add Step
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(stepTypeLabels).map(([type, label]) => (
                    <SelectItem key={type} value={type}>
                      <div className="flex items-center gap-2">
                        {stepTypeIcons[type as StepType]}
                        {label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-3">
              {steps.map((step, index) => (
                <Card key={step.id}>
                  <CardContent className="pt-4">
                    <div className="flex gap-3">
                      <div className="flex flex-col items-center gap-2">
                        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground text-sm font-medium">
                          {index + 1}
                        </div>
                        <GripVertical className="h-4 w-4 text-muted-foreground" />
                      </div>

                      <div className="flex-1 space-y-3">
                        <div className="flex gap-3 items-start">
                          <div className="flex-1">
                            <Label className="text-xs">Step Type</Label>
                            <Select
                              value={step.type}
                              onValueChange={(v) => {
                                const newType = v as StepType;
                                const updates: Partial<Step> = { type: newType };

                                // Reset type-specific fields
                                switch (newType) {
                                  case 'message':
                                    updates.message_type = 'text';
                                    updates.content = '';
                                    break;
                                  case 'status_change':
                                    updates.status_id = statuses?.[0]?.id;
                                    break;
                                  case 'reminder':
                                    updates.reminder = { title: '', due_minutes: 60, priority: 'medium' };
                                    break;
                                  case 'tag':
                                    updates.tags_to_add = [];
                                    updates.tags_to_remove = [];
                                    break;
                                  case 'assign':
                                    updates.assign_to_account_id = availableAccounts?.[0]?.id;
                                    break;
                                  case 'webhook':
                                    updates.webhook_url = '';
                                    updates.webhook_method = 'POST';
                                    break;
                                  case 'wait':
                                    updates.wait_condition = { type: 'reply', timeout_minutes: 60 };
                                    break;
                                }

                                updateStep(step.id, updates);
                              }}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {Object.entries(stepTypeLabels).map(([type, label]) => (
                                  <SelectItem key={type} value={type}>
                                    <div className="flex items-center gap-2">
                                      {stepTypeIcons[type as StepType]}
                                      {label}
                                    </div>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="w-32">
                            <Label className="text-xs">Delay (min)</Label>
                            <Input
                              type="number"
                              min="0"
                              value={step.delay_minutes}
                              onChange={(e) =>
                                updateStep(step.id, { delay_minutes: parseInt(e.target.value) || 0 })
                              }
                            />
                          </div>

                          {steps.length > 1 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="mt-5"
                              onClick={() => removeStep(step.id)}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          )}
                        </div>

                        {renderStepConfig(step)}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="mt-6">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!canCreate || createMutation.isPending}
          >
            {createMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Plus className="mr-2 h-4 w-4" />
                Create Sequence
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
