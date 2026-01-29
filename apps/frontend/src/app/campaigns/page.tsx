'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Play, Pause, Trash2, Settings, BarChart, RefreshCw, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { CreateCampaignDialog } from '@/components/campaigns/create-campaign-dialog';
import { EditCampaignDialog } from '@/components/campaigns/edit-campaign-dialog';
import { campaignsApi } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

type Campaign = {
  id: string;
  name: string;
  description: string | null;
  status: 'draft' | 'active' | 'paused' | 'completed' | 'archived';
  stats: {
    total_groups: number;
    messages_sent: number;
    messages_failed: number;
    responses_received: number;
  };
  schedule_config: {
    type: string;
    min_delay_seconds: number;
    max_delay_seconds: number;
    randomize_delay?: boolean;
    account_rotation?: string;
  };
  assigned_accounts: string[];
  message_template_id: string | null;
  message_templates: { id: string; name: string } | null;
  group_filter?: { include_group_ids?: string[] } | null;
  created_at: string;
};

export default function CampaignsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editCampaign, setEditCampaign] = useState<Campaign | null>(null);
  const [deleteCampaign, setDeleteCampaign] = useState<Campaign | null>(null);

  const { data: campaigns, isLoading, refetch } = useQuery({
    queryKey: ['campaigns'],
    queryFn: () => campaignsApi.list() as Promise<Campaign[]>,
    refetchInterval: 10000, // Refresh every 10s for progress updates
  });

  const startMutation = useMutation({
    mutationFn: (id: string) => campaignsApi.start(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      toast({ title: 'Campaign started', description: 'Messages are being sent' });
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to start', description: error.message, variant: 'destructive' });
    },
  });

  const pauseMutation = useMutation({
    mutationFn: (id: string) => campaignsApi.pause(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      toast({ title: 'Campaign paused' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => campaignsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      setDeleteCampaign(null);
      toast({ title: 'Campaign deleted' });
    },
  });

  const restartMutation = useMutation({
    mutationFn: (id: string) => campaignsApi.restart(id),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      toast({ title: 'Campaign reset', description: data.message || 'All groups reset to pending' });
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to restart', description: error.message, variant: 'destructive' });
    },
  });

  const getStatusBadge = (status: Campaign['status']) => {
    switch (status) {
      case 'active':
        return <Badge variant="success" className="animate-pulse">Active</Badge>;
      case 'paused':
        return <Badge variant="warning">Paused</Badge>;
      case 'completed':
        return <Badge variant="secondary">Completed</Badge>;
      case 'draft':
        return <Badge variant="outline">Draft</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getProgress = (campaign: Campaign) => {
    const total = campaign.stats.total_groups;
    const sent = campaign.stats.messages_sent;
    if (total === 0) return 0;
    return Math.round((sent / total) * 100);
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const activeCampaigns = campaigns?.filter((c) => c.status === 'active').length || 0;

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Campaigns</h1>
          <p className="text-muted-foreground">
            {activeCampaigns > 0 ? `${activeCampaigns} active campaign${activeCampaigns > 1 ? 's' : ''}` : 'Create and manage outreach campaigns'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button onClick={() => setShowCreateDialog(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New Campaign
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader className="pb-3">
                <div className="h-6 bg-muted rounded w-1/3" />
                <div className="h-4 bg-muted rounded w-1/2 mt-2" />
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-4 gap-4">
                  {[1, 2, 3, 4].map((j) => (
                    <div key={j} className="h-12 bg-muted rounded" />
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {campaigns?.map((campaign) => (
            <Card key={campaign.id} className={campaign.status === 'active' ? 'border-green-500/30' : ''}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-xl">{campaign.name}</CardTitle>
                      {getStatusBadge(campaign.status)}
                    </div>
                    {campaign.description && (
                      <CardDescription className="mt-1">{campaign.description}</CardDescription>
                    )}
                    <p className="text-xs text-muted-foreground mt-2">
                      Created {formatDate(campaign.created_at)} · {campaign.assigned_accounts.length} account{campaign.assigned_accounts.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {campaign.status === 'active' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => pauseMutation.mutate(campaign.id)}
                        disabled={pauseMutation.isPending}
                      >
                        <Pause className="mr-2 h-4 w-4" />
                        Pause
                      </Button>
                    ) : campaign.status === 'completed' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => restartMutation.mutate(campaign.id)}
                        disabled={restartMutation.isPending}
                      >
                        <RotateCcw className="mr-2 h-4 w-4" />
                        Restart
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => startMutation.mutate(campaign.id)}
                        disabled={startMutation.isPending}
                      >
                        <Play className="mr-2 h-4 w-4" />
                        Start
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setEditCampaign(campaign)}>
                      <Settings className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDeleteCampaign(campaign)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {/* Progress bar for active/paused campaigns */}
                {(campaign.status === 'active' || campaign.status === 'paused') && campaign.stats.total_groups > 0 && (
                  <div className="mb-4">
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-muted-foreground">Progress</span>
                      <span className="font-medium">{getProgress(campaign)}%</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary transition-all duration-500"
                        style={{ width: `${getProgress(campaign)}%` }}
                      />
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Total Groups</p>
                    <p className="text-2xl font-semibold">{campaign.stats.total_groups}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Messages Sent</p>
                    <p className="text-2xl font-semibold text-green-600">
                      {campaign.stats.messages_sent}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Failed</p>
                    <p className="text-2xl font-semibold text-red-600">
                      {campaign.stats.messages_failed}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Responses</p>
                    <p className="text-2xl font-semibold text-blue-600">
                      {campaign.stats.responses_received}
                    </p>
                  </div>
                </div>

                {campaign.message_templates && (
                  <p className="mt-4 text-sm text-muted-foreground">
                    Template: {campaign.message_templates.name}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}

          {campaigns?.length === 0 && (
            <Card>
              <CardContent className="py-12 text-center">
                <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
                  <BarChart className="h-6 w-6 text-muted-foreground" />
                </div>
                <h3 className="font-semibold mb-1">No campaigns yet</h3>
                <p className="text-muted-foreground mb-4">
                  Create your first campaign to start sending messages to groups
                </p>
                <Button onClick={() => setShowCreateDialog(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Create Campaign
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Create Campaign Dialog */}
      <CreateCampaignDialog open={showCreateDialog} onOpenChange={setShowCreateDialog} />

      {/* Edit Campaign Dialog */}
      <EditCampaignDialog
        campaign={editCampaign}
        open={!!editCampaign}
        onOpenChange={(open) => !open && setEditCampaign(null)}
      />

      {/* Delete Confirmation */}
      <Dialog open={!!deleteCampaign} onOpenChange={(open) => !open && setDeleteCampaign(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Campaign</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{deleteCampaign?.name}"? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteCampaign(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteCampaign && deleteMutation.mutate(deleteCampaign.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
