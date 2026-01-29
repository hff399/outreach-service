'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, X } from 'lucide-react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { campaignsApi, templatesApi, groupsApi, accountsApi } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

type CreateCampaignDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type Template = { id: string; name: string; content: string };
type Group = { id: string; title: string; username: string | null; member_count: number | null; category: string | null };
type Account = { id: string; phone: string; username: string | null; first_name: string | null; is_connected: boolean };

export function CreateCampaignDialog({ open, onOpenChange }: CreateCampaignDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [templateId, setTemplateId] = useState<string>('');
  const [customMessage, setCustomMessage] = useState('');
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  // Simplified scheduling - distribution preset
  const [distributionPreset, setDistributionPreset] = useState<'fast' | 'normal' | 'slow' | 'custom'>('normal');
  const [minDelayMinutes, setMinDelayMinutes] = useState('3');
  const [maxDelayMinutes, setMaxDelayMinutes] = useState('8');
  const [accountRotation, setAccountRotation] = useState<'round_robin' | 'random' | 'least_used'>('round_robin');

  // Fetch data
  const { data: templates } = useQuery({
    queryKey: ['templates'],
    queryFn: () => templatesApi.list() as Promise<Template[]>,
  });

  const { data: groupsData } = useQuery({
    queryKey: ['groups'],
    queryFn: () => groupsApi.list() as Promise<{ items: Group[] }>,
  });

  const { data: accounts } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountsApi.list() as Promise<Account[]>,
  });

  const groups = groupsData?.items || [];
  // Show all accounts - campaign will use them when they're connected
  const availableAccounts = accounts || [];

  const createMutation = useMutation({
    mutationFn: async () => {
      // Calculate delay in seconds based on preset or custom values
      let minDelaySec: number;
      let maxDelaySec: number;

      switch (distributionPreset) {
        case 'fast':
          minDelaySec = 30;  // 30 seconds
          maxDelaySec = 90;  // 1.5 minutes
          break;
        case 'normal':
          minDelaySec = 180; // 3 minutes
          maxDelaySec = 480; // 8 minutes
          break;
        case 'slow':
          minDelaySec = 600;  // 10 minutes
          maxDelaySec = 1200; // 20 minutes
          break;
        case 'custom':
        default:
          minDelaySec = (parseInt(minDelayMinutes) || 3) * 60;
          maxDelaySec = (parseInt(maxDelayMinutes) || 8) * 60;
      }

      // Create campaign
      const hasTemplate = templateId && templateId !== 'custom' && templateId !== 'none';
      const campaign = await campaignsApi.create({
        name,
        description: description || undefined,
        message_template_id: hasTemplate ? templateId : undefined,
        custom_message: !hasTemplate && customMessage ? customMessage : undefined,
        schedule_config: {
          type: 'immediate',
          min_delay_seconds: minDelaySec,
          max_delay_seconds: maxDelaySec,
          randomize_delay: true,
          account_rotation: accountRotation,
        },
        assigned_accounts: selectedAccounts,
        group_filter: selectedGroups.length > 0 ? {
          include_group_ids: selectedGroups,
        } : undefined,
      }) as { id: string };

      // Add groups to campaign
      if (selectedGroups.length > 0) {
        await campaignsApi.addGroups(campaign.id, selectedGroups);
      }

      return campaign;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      onOpenChange(false);
      resetForm();
      toast({ title: 'Campaign created', description: 'Your campaign is ready to start' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const resetForm = () => {
    setName('');
    setDescription('');
    setTemplateId('');
    setCustomMessage('');
    setDistributionPreset('normal');
    setMinDelayMinutes('3');
    setMaxDelayMinutes('8');
    setAccountRotation('round_robin');
    setSelectedGroups([]);
    setSelectedAccounts([]);
  };

  const toggleGroup = (groupId: string) => {
    setSelectedGroups((prev) =>
      prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]
    );
  };

  const toggleAccount = (accountId: string) => {
    setSelectedAccounts((prev) =>
      prev.includes(accountId) ? prev.filter((id) => id !== accountId) : [...prev, accountId]
    );
  };

  // Validate: need name and at least one account
  const canCreate = name && selectedAccounts.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Campaign</DialogTitle>
          <DialogDescription>
            Set up a new outreach campaign to send messages to Telegram groups
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="basic" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="basic">Basic</TabsTrigger>
            <TabsTrigger value="message">Message</TabsTrigger>
            <TabsTrigger value="groups">Groups</TabsTrigger>
            <TabsTrigger value="schedule">Schedule</TabsTrigger>
          </TabsList>

          <TabsContent value="basic" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="name">Campaign Name *</Label>
              <Input
                id="name"
                placeholder="e.g., Designer Outreach Q1"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="What is this campaign about?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Sending Accounts *</Label>
              <p className="text-xs text-muted-foreground mb-2">
                Select which accounts will send messages (round-robin)
              </p>
              <div className="flex flex-wrap gap-2">
                {availableAccounts.map((account) => (
                  <Badge
                    key={account.id}
                    variant={selectedAccounts.includes(account.id) ? 'default' : 'outline'}
                    className={`cursor-pointer ${!account.is_connected ? 'opacity-70' : ''}`}
                    onClick={() => toggleAccount(account.id)}
                  >
                    {account.first_name || account.username || account.phone}
                    {!account.is_connected && <span className="ml-1 text-xs">(offline)</span>}
                    {selectedAccounts.includes(account.id) && (
                      <X className="ml-1 h-3 w-3" />
                    )}
                  </Badge>
                ))}
                {availableAccounts.length === 0 && (
                  <p className="text-sm text-muted-foreground">No accounts available</p>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="message" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label>Message Template</Label>
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a template (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No template</SelectItem>
                  {templates?.map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {(!templateId || templateId === 'custom') && (
              <div className="space-y-2">
                <Label htmlFor="customMessage">Message Content *</Label>
                <Textarea
                  id="customMessage"
                  placeholder="Write your message here... Use {{group_name}} for dynamic group name"
                  value={customMessage}
                  onChange={(e) => setCustomMessage(e.target.value)}
                  className="min-h-[150px]"
                />
                <p className="text-xs text-muted-foreground">
                  Available variables: {'{{group_name}}'}
                </p>
              </div>
            )}

            {templateId && templateId !== 'custom' && (
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm font-medium mb-2">Template Preview:</p>
                <p className="text-sm whitespace-pre-wrap">
                  {templates?.find((t) => t.id === templateId)?.content}
                </p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="groups" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label>Target Groups ({selectedGroups.length} selected)</Label>
              <p className="text-xs text-muted-foreground">
                Select groups to send messages to
              </p>
            </div>

            <div className="border rounded-lg max-h-[300px] overflow-y-auto">
              {groups.length > 0 ? (
                <div className="divide-y">
                  {groups.map((group) => (
                    <div
                      key={group.id}
                      className={`p-3 cursor-pointer hover:bg-muted/50 transition-colors ${
                        selectedGroups.includes(group.id) ? 'bg-primary/10' : ''
                      }`}
                      onClick={() => toggleGroup(group.id)}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">{group.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {group.username && `@${group.username} · `}
                            {group.member_count?.toLocaleString() || '?'} members
                            {group.category && ` · ${group.category}`}
                          </p>
                        </div>
                        {selectedGroups.includes(group.id) && (
                          <Badge variant="default">Selected</Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-8 text-center text-muted-foreground">
                  <p>No groups imported yet</p>
                  <p className="text-xs mt-1">Go to Groups page to import groups</p>
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSelectedGroups(groups.map((g) => g.id))}
              >
                Select All
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSelectedGroups([])}
              >
                Clear Selection
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="schedule" className="space-y-4 mt-4">
            {/* Distribution Speed */}
            <div className="space-y-2">
              <Label>Message Distribution</Label>
              <p className="text-xs text-muted-foreground mb-2">
                How fast should messages be sent to groups?
              </p>
              <Select value={distributionPreset} onValueChange={(v) => setDistributionPreset(v as typeof distributionPreset)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fast">Fast (30s - 1.5min between messages)</SelectItem>
                  <SelectItem value="normal">Normal (3-8 min between messages)</SelectItem>
                  <SelectItem value="slow">Slow (10-20 min between messages)</SelectItem>
                  <SelectItem value="custom">Custom delays</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Custom delay settings */}
            {distributionPreset === 'custom' && (
              <div className="space-y-2 p-4 border rounded-lg">
                <Label>Custom Delay Between Messages (minutes)</Label>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label className="text-xs">Minimum</Label>
                    <Input
                      type="number"
                      min="1"
                      value={minDelayMinutes}
                      onChange={(e) => setMinDelayMinutes(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Maximum</Label>
                    <Input
                      type="number"
                      min="1"
                      value={maxDelayMinutes}
                      onChange={(e) => setMaxDelayMinutes(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Estimated time */}
            {selectedGroups.length > 0 && (
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm font-medium">Estimated completion time</p>
                <p className="text-2xl font-bold mt-1">
                  {(() => {
                    const avgDelay = distributionPreset === 'fast' ? 1
                      : distributionPreset === 'normal' ? 5.5
                      : distributionPreset === 'slow' ? 15
                      : (parseInt(minDelayMinutes) + parseInt(maxDelayMinutes)) / 2;
                    const totalMinutes = selectedGroups.length * avgDelay;
                    if (totalMinutes < 60) return `~${Math.round(totalMinutes)} minutes`;
                    const hours = Math.floor(totalMinutes / 60);
                    const mins = Math.round(totalMinutes % 60);
                    return `~${hours}h ${mins}m`;
                  })()}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  for {selectedGroups.length} groups
                </p>
              </div>
            )}

            {/* Account Rotation */}
            <div className="space-y-2">
              <Label>Account Rotation Strategy</Label>
              <Select value={accountRotation} onValueChange={(v) => setAccountRotation(v as typeof accountRotation)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="round_robin">Round Robin (rotate evenly)</SelectItem>
                  <SelectItem value="random">Random (pick randomly)</SelectItem>
                  <SelectItem value="least_used">Least Used First</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Each account sends 1 message per group, rotated based on this strategy
              </p>
            </div>
          </TabsContent>
        </Tabs>

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
                Create Campaign
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
