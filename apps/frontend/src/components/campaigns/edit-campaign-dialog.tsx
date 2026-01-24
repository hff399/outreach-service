'use client';

import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, X } from 'lucide-react';
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

type Campaign = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  message_template_id: string | null;
  schedule_config: {
    type: string;
    min_delay_seconds?: number;
    max_delay_seconds?: number;
    randomize_delay?: boolean;
    account_rotation?: string;
  };
  assigned_accounts: string[];
  group_filter?: {
    include_group_ids?: string[];
  } | null;
};

type EditCampaignDialogProps = {
  campaign: Campaign | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type Template = { id: string; name: string; content: string };
type Group = { id: string; title: string; username: string | null; member_count: number | null; category: string | null };
type Account = { id: string; phone: string; username: string | null; first_name: string | null; is_connected: boolean };

export function EditCampaignDialog({ campaign, open, onOpenChange }: EditCampaignDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [templateId, setTemplateId] = useState<string>('');
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  // Simplified scheduling
  const [distributionPreset, setDistributionPreset] = useState<'fast' | 'normal' | 'slow' | 'custom'>('normal');
  const [minDelayMinutes, setMinDelayMinutes] = useState('3');
  const [maxDelayMinutes, setMaxDelayMinutes] = useState('8');
  const [accountRotation, setAccountRotation] = useState<'round_robin' | 'random' | 'least_used'>('round_robin');

  // Determine preset from delay values
  const getPresetFromDelays = (minSec: number, maxSec: number): 'fast' | 'normal' | 'slow' | 'custom' => {
    if (minSec === 30 && maxSec === 90) return 'fast';
    if (minSec === 180 && maxSec === 480) return 'normal';
    if (minSec === 600 && maxSec === 1200) return 'slow';
    return 'custom';
  };

  // Load campaign data when opened
  useEffect(() => {
    if (campaign) {
      setName(campaign.name);
      setDescription(campaign.description || '');
      setTemplateId(campaign.message_template_id || '');
      setSelectedAccounts(campaign.assigned_accounts || []);
      setSelectedGroups(campaign.group_filter?.include_group_ids || []);

      const sc = campaign.schedule_config;
      const minSec = sc.min_delay_seconds || 180;
      const maxSec = sc.max_delay_seconds || 480;
      setDistributionPreset(getPresetFromDelays(minSec, maxSec));
      setMinDelayMinutes(String(Math.round(minSec / 60)));
      setMaxDelayMinutes(String(Math.round(maxSec / 60)));
      setAccountRotation((sc.account_rotation as typeof accountRotation) || 'round_robin');
    }
  }, [campaign]);

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

  const { data: campaignGroups } = useQuery({
    queryKey: ['campaign-groups', campaign?.id],
    queryFn: () => campaign ? campaignsApi.getGroups(campaign.id) as Promise<Array<{ group_id: string }>> : Promise.resolve([]),
    enabled: !!campaign,
  });

  // Load existing campaign groups
  useEffect(() => {
    if (campaignGroups && campaignGroups.length > 0) {
      setSelectedGroups(campaignGroups.map(g => g.group_id));
    }
  }, [campaignGroups]);

  const groups = groupsData?.items || [];
  const availableAccounts = accounts || [];

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!campaign) return;

      // Calculate delay in seconds based on preset or custom values
      let minDelaySec: number;
      let maxDelaySec: number;

      switch (distributionPreset) {
        case 'fast':
          minDelaySec = 30;
          maxDelaySec = 90;
          break;
        case 'normal':
          minDelaySec = 180;
          maxDelaySec = 480;
          break;
        case 'slow':
          minDelaySec = 600;
          maxDelaySec = 1200;
          break;
        case 'custom':
        default:
          minDelaySec = (parseInt(minDelayMinutes) || 3) * 60;
          maxDelaySec = (parseInt(maxDelayMinutes) || 8) * 60;
      }

      // Update campaign
      await campaignsApi.update(campaign.id, {
        name,
        description: description || undefined,
        message_template_id: templateId && templateId !== 'none' ? templateId : undefined,
        schedule_config: {
          type: 'immediate',
          min_delay_seconds: minDelaySec,
          max_delay_seconds: maxDelaySec,
          randomize_delay: true,
          account_rotation: accountRotation,
        },
        assigned_accounts: selectedAccounts,
      });

      // Update groups if changed
      if (selectedGroups.length > 0) {
        await campaignsApi.addGroups(campaign.id, selectedGroups);
      }

      return campaign;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      queryClient.invalidateQueries({ queryKey: ['campaign-groups', campaign?.id] });
      onOpenChange(false);
      toast({ title: 'Campaign updated', description: 'Changes saved successfully' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

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

  const canSave = name && selectedAccounts.length > 0;

  if (!campaign) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Campaign</DialogTitle>
          <DialogDescription>
            Modify campaign settings and scheduling
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="basic" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="basic">Basic</TabsTrigger>
            <TabsTrigger value="message">Message</TabsTrigger>
            <TabsTrigger value="groups">Groups ({selectedGroups.length})</TabsTrigger>
            <TabsTrigger value="schedule">Schedule</TabsTrigger>
          </TabsList>

          <TabsContent value="basic" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="name">Campaign Name *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Sending Accounts *</Label>
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
                    {selectedAccounts.includes(account.id) && <X className="ml-1 h-3 w-3" />}
                  </Badge>
                ))}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="message" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label>Message Template</Label>
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a template" />
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

            {templateId && templateId !== 'none' && (
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm font-medium mb-2">Template Preview:</p>
                <p className="text-sm whitespace-pre-wrap">
                  {templates?.find((t) => t.id === templateId)?.content}
                </p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="groups" className="space-y-4 mt-4">
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
                  No groups available
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setSelectedGroups(groups.map((g) => g.id))}>
                Select All
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setSelectedGroups([])}>
                Clear
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
