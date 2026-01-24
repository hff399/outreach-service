'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Play, Pause, Trash2, Settings, Users, Zap, MessageSquare, Video, Mic, Image } from 'lucide-react';
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
import { CreateSequenceDialog } from '@/components/sequences/create-sequence-dialog';
import { EditSequenceDialog } from '@/components/sequences/edit-sequence-dialog';
import { sequencesApi } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

type MessageType = 'text' | 'video' | 'video_note' | 'voice' | 'photo' | 'document';

type Sequence = {
  id: string;
  name: string;
  description: string | null;
  status: 'active' | 'paused' | 'archived';
  trigger: {
    type: 'new_message' | 'keyword' | 'regex' | 'any' | 'no_reply' | 'no_response';
    keywords?: string[];
    regex_pattern?: string;
    timeout_minutes?: number;
  };
  steps: Array<{
    id: string;
    type: 'message';
    message_type?: MessageType;
    content?: string;
    delay_minutes: number;
  }>;
  assigned_accounts: string[];
  stats?: {
    active_enrollments: number;
    completed_enrollments: number;
  };
  created_at: string;
};

const stepTypeIcons: Record<MessageType, React.ReactNode> = {
  text: <MessageSquare className="h-3 w-3" />,
  video: <Video className="h-3 w-3" />,
  video_note: <Video className="h-3 w-3" />,
  voice: <Mic className="h-3 w-3" />,
  photo: <Image className="h-3 w-3" />,
  document: <MessageSquare className="h-3 w-3" />,
};

export default function SequencesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editSequence, setEditSequence] = useState<Sequence | null>(null);
  const [deleteSequence, setDeleteSequence] = useState<Sequence | null>(null);

  const { data: sequences, isLoading } = useQuery({
    queryKey: ['sequences'],
    queryFn: () => sequencesApi.list() as Promise<Sequence[]>,
  });

  const activateMutation = useMutation({
    mutationFn: (id: string) => sequencesApi.activate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sequences'] });
      toast({ title: 'Sequence activated', description: 'Auto-responder is now active' });
    },
  });

  const pauseMutation = useMutation({
    mutationFn: (id: string) => sequencesApi.pause(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sequences'] });
      toast({ title: 'Sequence paused' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => sequencesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sequences'] });
      setDeleteSequence(null);
      toast({ title: 'Sequence deleted' });
    },
  });

  const getStatusBadge = (status: Sequence['status']) => {
    switch (status) {
      case 'active':
        return <Badge variant="success">Active</Badge>;
      case 'paused':
        return <Badge variant="warning">Paused</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getTriggerBadge = (trigger: Sequence['trigger']) => {
    switch (trigger.type) {
      case 'any':
        return <Badge variant="outline" className="text-xs">Any message</Badge>;
      case 'keyword':
        return <Badge variant="outline" className="text-xs">Keywords: {trigger.keywords?.slice(0, 3).join(', ')}{(trigger.keywords?.length || 0) > 3 ? '...' : ''}</Badge>;
      case 'regex':
        return <Badge variant="outline" className="text-xs">Regex pattern</Badge>;
      case 'new_message':
        return <Badge variant="outline" className="text-xs">First message</Badge>;
      default:
        return null;
    }
  };

  const formatDuration = (steps: Sequence['steps']) => {
    const totalMinutes = steps.reduce((sum, step) => sum + step.delay_minutes, 0);
    if (totalMinutes === 0) return 'Instant';
    if (totalMinutes < 60) return `${totalMinutes}m`;
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  const activeSequences = sequences?.filter((s) => s.status === 'active').length || 0;

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Auto-Responders</h1>
          <p className="text-muted-foreground">
            {activeSequences > 0 ? `${activeSequences} active sequence${activeSequences > 1 ? 's' : ''}` : 'Set up automatic message sequences for incoming leads'}
          </p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Sequence
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader className="pb-3">
                <div className="h-6 bg-muted rounded w-1/3" />
              </CardHeader>
              <CardContent>
                <div className="h-16 bg-muted rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {sequences?.map((sequence) => (
            <Card key={sequence.id} className={sequence.status === 'active' ? 'border-green-500/30' : ''}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-xl">{sequence.name}</CardTitle>
                      {getStatusBadge(sequence.status)}
                    </div>
                    {sequence.description && (
                      <CardDescription className="mt-1">{sequence.description}</CardDescription>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {sequence.status === 'active' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => pauseMutation.mutate(sequence.id)}
                        disabled={pauseMutation.isPending}
                      >
                        <Pause className="mr-2 h-4 w-4" />
                        Pause
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => activateMutation.mutate(sequence.id)}
                        disabled={activateMutation.isPending}
                      >
                        <Play className="mr-2 h-4 w-4" />
                        Activate
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setEditSequence(sequence)}>
                      <Settings className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDeleteSequence(sequence)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {/* Trigger */}
                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4 text-yellow-500" />
                    <span className="text-sm text-muted-foreground">Trigger:</span>
                    {getTriggerBadge(sequence.trigger)}
                  </div>

                  {/* Steps visualization */}
                  <div>
                    <p className="text-sm text-muted-foreground mb-2">
                      {sequence.steps.length} step{sequence.steps.length !== 1 ? 's' : ''} · Total duration: {formatDuration(sequence.steps)}
                    </p>
                    <div className="flex items-center gap-1 flex-wrap">
                      {sequence.steps.map((step, index) => (
                        <div key={step.id} className="flex items-center">
                          <div className="flex items-center gap-1 px-2 py-1 bg-muted rounded text-xs">
                            {stepTypeIcons[step.message_type || 'text']}
                            <span className="capitalize">{(step.message_type || 'text').replace('_', ' ')}</span>
                          </div>
                          {index < sequence.steps.length - 1 && (
                            <div className="mx-1 text-muted-foreground text-xs">
                              → {step.delay_minutes > 0 ? `${step.delay_minutes}m` : ''}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="flex items-center gap-6 pt-2 border-t">
                    <div className="flex items-center gap-2 text-sm">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{sequence.stats?.active_enrollments || 0}</span>
                      <span className="text-muted-foreground">active</span>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {sequence.stats?.completed_enrollments || 0} completed
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {sequence.assigned_accounts.length} account{sequence.assigned_accounts.length !== 1 ? 's' : ''}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}

          {sequences?.length === 0 && (
            <Card>
              <CardContent className="py-12 text-center">
                <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
                  <Zap className="h-6 w-6 text-muted-foreground" />
                </div>
                <h3 className="font-semibold mb-1">No sequences yet</h3>
                <p className="text-muted-foreground mb-4">
                  Create your first auto-responder to automatically reply to incoming messages
                </p>
                <Button onClick={() => setShowCreateDialog(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Create Sequence
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Create Sequence Dialog */}
      <CreateSequenceDialog open={showCreateDialog} onOpenChange={setShowCreateDialog} />

      {/* Edit Sequence Dialog */}
      <EditSequenceDialog
        sequence={editSequence}
        open={!!editSequence}
        onOpenChange={(open) => !open && setEditSequence(null)}
      />

      {/* Delete Confirmation */}
      <Dialog open={!!deleteSequence} onOpenChange={(open) => !open && setDeleteSequence(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Sequence</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{deleteSequence?.name}"?
              {deleteSequence?.stats?.active_enrollments ? ` This will cancel ${deleteSequence.stats.active_enrollments} active enrollment(s).` : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteSequence(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteSequence && deleteMutation.mutate(deleteSequence.id)}
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
