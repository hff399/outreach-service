'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { statusesApi } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

type Status = {
  id: string;
  name: string;
  color: string;
  order: number;
  is_default: boolean;
  is_final: boolean;
};

export default function SettingsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showAddStatus, setShowAddStatus] = useState(false);
  const [newStatus, setNewStatus] = useState({ name: '', color: '#3B82F6' });

  const { data: statuses, isLoading } = useQuery({
    queryKey: ['statuses'],
    queryFn: () => statusesApi.list() as Promise<Status[]>,
  });

  const createMutation = useMutation({
    mutationFn: (data: { name: string; color: string }) => statusesApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['statuses'] });
      setShowAddStatus(false);
      setNewStatus({ name: '', color: '#3B82F6' });
      toast({ title: 'Status created' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Status> }) =>
      statusesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['statuses'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => statusesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['statuses'] });
      toast({ title: 'Status deleted' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground">
          Configure your outreach service
        </p>
      </div>

      {/* Lead Statuses */}
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Lead Statuses</CardTitle>
              <CardDescription>
                Customize the stages of your lead pipeline
              </CardDescription>
            </div>
            <Button size="sm" onClick={() => setShowAddStatus(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Status
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {showAddStatus && (
            <div className="flex gap-4 mb-4 p-4 border rounded-lg bg-muted/50">
              <Input
                placeholder="Status name"
                value={newStatus.name}
                onChange={(e) => setNewStatus({ ...newStatus, name: e.target.value })}
                className="flex-1"
              />
              <input
                type="color"
                value={newStatus.color}
                onChange={(e) => setNewStatus({ ...newStatus, color: e.target.value })}
                className="w-12 h-10 rounded border cursor-pointer"
              />
              <Button
                onClick={() => createMutation.mutate(newStatus)}
                disabled={!newStatus.name || createMutation.isPending}
              >
                Add
              </Button>
              <Button variant="outline" onClick={() => setShowAddStatus(false)}>
                Cancel
              </Button>
            </div>
          )}

          {isLoading ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : (
            <div className="space-y-2">
              {statuses?.map((status) => (
                <div
                  key={status.id}
                  className="flex items-center gap-4 p-3 border rounded-lg"
                >
                  <GripVertical className="h-4 w-4 text-muted-foreground cursor-move" />
                  <div
                    className="w-4 h-4 rounded-full"
                    style={{ backgroundColor: status.color }}
                  />
                  <span className="flex-1 font-medium">{status.name}</span>
                  {status.is_default && (
                    <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                      Default
                    </span>
                  )}
                  {status.is_final && (
                    <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                      Final
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => deleteMutation.mutate(status.id)}
                    disabled={status.is_default}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* General Settings */}
      <Card>
        <CardHeader>
          <CardTitle>General Settings</CardTitle>
          <CardDescription>
            Application-wide configuration
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium">Default Daily Message Limit</label>
            <Input type="number" defaultValue={50} className="max-w-xs mt-1" />
            <p className="text-xs text-muted-foreground mt-1">
              Maximum messages per account per day
            </p>
          </div>

          <div>
            <label className="text-sm font-medium">Minimum Delay Between Messages (seconds)</label>
            <Input type="number" defaultValue={60} className="max-w-xs mt-1" />
          </div>

          <div>
            <label className="text-sm font-medium">Maximum Delay Between Messages (seconds)</label>
            <Input type="number" defaultValue={180} className="max-w-xs mt-1" />
          </div>

          <Button className="mt-4">Save Settings</Button>
        </CardContent>
      </Card>
    </div>
  );
}
