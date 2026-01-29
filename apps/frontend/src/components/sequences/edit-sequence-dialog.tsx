'use client';

import { useState, useEffect } from 'react';
import { generateId } from '@/lib/utils';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, X, MessageSquare, Video, Mic, Image, FileText, Tag, UserCheck } from 'lucide-react';
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

type MessageType = 'text' | 'video' | 'video_note' | 'voice' | 'photo' | 'document';
type TriggerType = 'any' | 'new_message' | 'keyword' | 'regex' | 'no_reply' | 'no_response';
type StepType = 'message' | 'status_change' | 'tag';

type Step = {
  id: string;
  type: StepType;
  delay_minutes: number;
  // Message fields
  message_type?: MessageType;
  content?: string;
  // Status change fields
  status_id?: string;
  // Tag fields
  tags_to_add?: string[];
};

type Status = { id: string; name: string; color: string };

type Sequence = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  trigger: {
    type: TriggerType;
    keywords?: string[];
    regex_pattern?: string;
    timeout_minutes?: number;
  };
  steps: Array<{
    id: string;
    type?: string;
    delay_minutes?: number;
    message_type?: MessageType;
    content?: string;
    status_id?: string;
    tags_to_add?: string[];
  }>;
  assigned_accounts: string[];
};

type Account = { id: string; phone: string; username: string | null; first_name: string | null; is_connected: boolean };

type EditSequenceDialogProps = {
  sequence: Sequence | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const messageTypeIcons: Record<MessageType, React.ReactNode> = {
  text: <MessageSquare className="h-4 w-4" />,
  video: <Video className="h-4 w-4" />,
  video_note: <Video className="h-4 w-4" />,
  voice: <Mic className="h-4 w-4" />,
  photo: <Image className="h-4 w-4" />,
  document: <FileText className="h-4 w-4" />,
};

export function EditSequenceDialog({ sequence, open, onOpenChange }: EditSequenceDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [triggerType, setTriggerType] = useState<TriggerType>('any');
  const [keywords, setKeywords] = useState('');
  const [regexPattern, setRegexPattern] = useState('');
  const [timeoutMinutes, setTimeoutMinutes] = useState(60);
  const [steps, setSteps] = useState<Step[]>([]);
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);

  const { data: accounts } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountsApi.list() as Promise<Account[]>,
    refetchOnMount: true,
    staleTime: 5000,
  });

  const { data: statuses } = useQuery({
    queryKey: ['statuses'],
    queryFn: () => statusesApi.list() as Promise<Status[]>,
  });

  const availableAccounts = accounts || [];
  const availableStatuses = statuses || [];

  // Load sequence data when dialog opens
  useEffect(() => {
    if (sequence && open) {
      setName(sequence.name);
      setDescription(sequence.description || '');
      setTriggerType(sequence.trigger.type);
      setKeywords(sequence.trigger.keywords?.join(', ') || '');
      setRegexPattern(sequence.trigger.regex_pattern || '');
      setTimeoutMinutes(sequence.trigger.timeout_minutes || 60);
      setSteps(sequence.steps.map(s => ({
        id: s.id || generateId(),
        type: (s.type || 'message') as StepType,
        delay_minutes: s.delay_minutes || 0,
        message_type: s.message_type || 'text',
        content: s.content || '',
        status_id: s.status_id,
        tags_to_add: s.tags_to_add,
      })));
      setSelectedAccounts(sequence.assigned_accounts || []);
    }
  }, [sequence, open]);

  const updateMutation = useMutation({
    mutationFn: () => {
      if (!sequence) throw new Error('No sequence to update');

      const trigger: {
        type: TriggerType;
        keywords?: string[];
        regex_pattern?: string;
        timeout_minutes?: number;
      } = { type: triggerType };

      if (triggerType === 'keyword' && keywords) {
        trigger.keywords = keywords.split(',').map(k => k.trim()).filter(Boolean);
      }
      if (triggerType === 'regex' && regexPattern) {
        trigger.regex_pattern = regexPattern;
      }
      if ((triggerType === 'no_reply' || triggerType === 'no_response') && timeoutMinutes) {
        trigger.timeout_minutes = timeoutMinutes;
      }

      return sequencesApi.update(sequence.id, {
        name,
        description: description || undefined,
        trigger,
        steps: steps.map((step, index) => ({
          id: step.id,
          order: index,
          type: step.type,
          delay_minutes: step.delay_minutes,
          ...(step.type === 'message' && {
            message_type: step.message_type,
            content: step.content,
          }),
          ...(step.type === 'status_change' && {
            status_id: step.status_id,
          }),
          ...(step.type === 'tag' && {
            tags_to_add: step.tags_to_add,
          }),
        })),
        assigned_accounts: selectedAccounts,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sequences'] });
      onOpenChange(false);
      toast({ title: 'Sequence updated' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const toggleAccount = (accountId: string) => {
    setSelectedAccounts(prev =>
      prev.includes(accountId) ? prev.filter(id => id !== accountId) : [...prev, accountId]
    );
  };

  const addStep = (stepType: StepType = 'message') => {
    const baseStep = {
      id: generateId(),
      type: stepType,
      delay_minutes: 0,
    };

    if (stepType === 'message') {
      setSteps([...steps, { ...baseStep, message_type: 'text' as MessageType, content: '' }]);
    } else if (stepType === 'status_change') {
      setSteps([...steps, { ...baseStep, status_id: availableStatuses[0]?.id }]);
    } else if (stepType === 'tag') {
      setSteps([...steps, { ...baseStep, tags_to_add: [] }]);
    }
  };

  const updateStep = (id: string, updates: Partial<Step>) => {
    setSteps(steps.map(s => s.id === id ? { ...s, ...updates } : s));
  };

  const removeStep = (id: string) => {
    if (steps.length > 1) {
      setSteps(steps.filter(s => s.id !== id));
    }
  };

  const canSave = name && selectedAccounts.length > 0 && steps.length > 0;

  if (!sequence) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Sequence</DialogTitle>
          <DialogDescription>
            Modify your auto-responder settings
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Basic Info */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g., Welcome Sequence"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="What does this sequence do?"
              />
            </div>
          </div>

          {/* Trigger */}
          <div className="space-y-4">
            <Label className="text-base font-semibold">Trigger</Label>
            <div className="space-y-2">
              <Label>When to trigger</Label>
              <Select value={triggerType} onValueChange={v => setTriggerType(v as TriggerType)}>
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
                <Label>Keywords (comma-separated)</Label>
                <Input
                  value={keywords}
                  onChange={e => setKeywords(e.target.value)}
                  placeholder="hello, hi, hey"
                />
              </div>
            )}

            {triggerType === 'regex' && (
              <div className="space-y-2">
                <Label>Regex Pattern</Label>
                <Input
                  value={regexPattern}
                  onChange={e => setRegexPattern(e.target.value)}
                  placeholder="^(hi|hello|hey)"
                />
              </div>
            )}

            {(triggerType === 'no_response' || triggerType === 'no_reply') && (
              <div className="space-y-2">
                <Label>Timeout (minutes)</Label>
                <Input
                  type="number"
                  min="1"
                  value={timeoutMinutes}
                  onChange={e => setTimeoutMinutes(parseInt(e.target.value) || 60)}
                />
              </div>
            )}
          </div>

          {/* Accounts */}
          <div className="space-y-2">
            <Label>Apply to Accounts *</Label>
            <div className="flex flex-wrap gap-2">
              {availableAccounts.map(account => (
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
            </div>
          </div>

          {/* Steps */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label className="text-base font-semibold">Steps</Label>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => addStep('message')}>
                  <MessageSquare className="h-4 w-4 mr-1" /> Message
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => addStep('status_change')}>
                  <UserCheck className="h-4 w-4 mr-1" /> Status
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => addStep('tag')}>
                  <Tag className="h-4 w-4 mr-1" /> Tag
                </Button>
              </div>
            </div>

            <div className="space-y-3">
              {steps.map((step, index) => (
                <Card key={step.id}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium flex items-center gap-2">
                        {step.type === 'message' && <MessageSquare className="h-4 w-4" />}
                        {step.type === 'status_change' && <UserCheck className="h-4 w-4" />}
                        {step.type === 'tag' && <Tag className="h-4 w-4" />}
                        Step {index + 1}: {step.type === 'message' ? 'Message' : step.type === 'status_change' ? 'Change Status' : 'Add Tag'}
                      </span>
                      {steps.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeStep(step.id)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>

                    {/* Message Step */}
                    {step.type === 'message' && (
                      <>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label className="text-xs">Message Type</Label>
                            <Select
                              value={step.message_type}
                              onValueChange={v => updateStep(step.id, { message_type: v as MessageType })}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="text">
                                  <span className="flex items-center gap-2">
                                    {messageTypeIcons.text} Text
                                  </span>
                                </SelectItem>
                                <SelectItem value="photo">
                                  <span className="flex items-center gap-2">
                                    {messageTypeIcons.photo} Photo
                                  </span>
                                </SelectItem>
                                <SelectItem value="video">
                                  <span className="flex items-center gap-2">
                                    {messageTypeIcons.video} Video
                                  </span>
                                </SelectItem>
                                <SelectItem value="voice">
                                  <span className="flex items-center gap-2">
                                    {messageTypeIcons.voice} Voice
                                  </span>
                                </SelectItem>
                                <SelectItem value="video_note">
                                  <span className="flex items-center gap-2">
                                    {messageTypeIcons.video_note} Video Circle
                                  </span>
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="space-y-1">
                            <Label className="text-xs">Delay (minutes)</Label>
                            <Input
                              type="number"
                              min="0"
                              value={step.delay_minutes}
                              onChange={e => updateStep(step.id, { delay_minutes: parseInt(e.target.value) || 0 })}
                            />
                          </div>
                        </div>

                        <div className="space-y-1">
                          <Label className="text-xs">
                            {step.message_type === 'text' ? 'Message Content' : 'Media URL'}
                          </Label>
                          {step.message_type === 'text' ? (
                            <Textarea
                              value={step.content}
                              onChange={e => updateStep(step.id, { content: e.target.value })}
                              placeholder="Type your message..."
                              className="min-h-[80px]"
                            />
                          ) : (
                            <Input
                              value={step.content}
                              onChange={e => updateStep(step.id, { content: e.target.value })}
                              placeholder="/uploads/media/file.mp4"
                            />
                          )}
                        </div>
                      </>
                    )}

                    {/* Status Change Step */}
                    {step.type === 'status_change' && (
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Change Status To</Label>
                          <Select
                            value={step.status_id}
                            onValueChange={v => updateStep(step.id, { status_id: v })}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select status" />
                            </SelectTrigger>
                            <SelectContent>
                              {availableStatuses.map(status => (
                                <SelectItem key={status.id} value={status.id}>
                                  {status.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1">
                          <Label className="text-xs">Delay (minutes)</Label>
                          <Input
                            type="number"
                            min="0"
                            value={step.delay_minutes}
                            onChange={e => updateStep(step.id, { delay_minutes: parseInt(e.target.value) || 0 })}
                          />
                        </div>
                      </div>
                    )}

                    {/* Tag Step */}
                    {step.type === 'tag' && (
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Tags to Add (comma-separated)</Label>
                          <Input
                            value={step.tags_to_add?.join(', ') || ''}
                            onChange={e => updateStep(step.id, {
                              tags_to_add: e.target.value.split(',').map(t => t.trim()).filter(Boolean)
                            })}
                            placeholder="vip, interested"
                          />
                        </div>

                        <div className="space-y-1">
                          <Label className="text-xs">Delay (minutes)</Label>
                          <Input
                            type="number"
                            min="0"
                            value={step.delay_minutes}
                            onChange={e => updateStep(step.id, { delay_minutes: parseInt(e.target.value) || 0 })}
                          />
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => updateMutation.mutate()} disabled={!canSave || updateMutation.isPending}>
            {updateMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              'Save Changes'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
