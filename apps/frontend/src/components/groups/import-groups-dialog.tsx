'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Upload, Plus, X } from 'lucide-react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { groupsApi } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

type ImportGroupsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type GroupInput = {
  tg_id: string;
  username: string;
  title: string;
  member_count?: number;
  category?: string;
};

export function ImportGroupsDialog({ open, onOpenChange }: ImportGroupsDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [manualGroups, setManualGroups] = useState<GroupInput[]>([
    { tg_id: '', username: '', title: '' },
  ]);
  const [csvContent, setCsvContent] = useState('');
  const [bulkUsernames, setBulkUsernames] = useState('');

  const importMutation = useMutation({
    mutationFn: (groups: GroupInput[]) => groupsApi.import(groups),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      onOpenChange(false);
      resetForm();
      toast({
        title: 'Groups imported',
        description: `Successfully imported ${(data as { imported: number }).imported} groups`,
      });
    },
    onError: (error: Error) => {
      toast({ title: 'Import failed', description: error.message, variant: 'destructive' });
    },
  });

  const resetForm = () => {
    setManualGroups([{ tg_id: '', username: '', title: '' }]);
    setCsvContent('');
    setBulkUsernames('');
  };

  const addManualGroup = () => {
    setManualGroups([...manualGroups, { tg_id: '', username: '', title: '' }]);
  };

  const removeManualGroup = (index: number) => {
    if (manualGroups.length > 1) {
      setManualGroups(manualGroups.filter((_, i) => i !== index));
    }
  };

  const updateManualGroup = (index: number, field: keyof GroupInput, value: string | number) => {
    setManualGroups(
      manualGroups.map((g, i) => (i === index ? { ...g, [field]: value } : g))
    );
  };

  const handleImportManual = () => {
    const validGroups = manualGroups.filter((g) => g.username || g.tg_id);
    if (validGroups.length === 0) {
      toast({ title: 'Error', description: 'Add at least one group', variant: 'destructive' });
      return;
    }

    // Generate tg_id from username if not provided
    const groupsWithIds = validGroups.map((g) => ({
      ...g,
      tg_id: g.tg_id || g.username,
      title: g.title || g.username,
    }));

    importMutation.mutate(groupsWithIds);
  };

  const handleImportBulk = () => {
    const usernames = bulkUsernames
      .split('\n')
      .map((line) => line.trim().replace('@', ''))
      .filter(Boolean);

    if (usernames.length === 0) {
      toast({ title: 'Error', description: 'Enter at least one username', variant: 'destructive' });
      return;
    }

    const groups: GroupInput[] = usernames.map((username) => ({
      tg_id: username,
      username,
      title: username,
    }));

    importMutation.mutate(groups);
  };

  const handleImportCSV = () => {
    try {
      const lines = csvContent.trim().split('\n').filter(line => line.trim());
      if (lines.length < 1) {
        toast({ title: 'Error', description: 'CSV is empty', variant: 'destructive' });
        return;
      }

      const headers = lines[0].toLowerCase().split(',').map((h) => h.trim());

      // Check if first line looks like headers or data
      const hasHeaders = headers.some(h =>
        ['username', 'handle', 'title', 'name', 'category', 'members'].includes(h)
      );

      // Find column indexes - support multiple naming variations
      const usernameIdx = Math.max(
        headers.indexOf('username'),
        headers.indexOf('handle'),
        headers.indexOf('link')
      );
      const titleIdx = Math.max(
        headers.indexOf('title'),
        headers.indexOf('name'),
        headers.indexOf('group')
      );
      const membersIdx = Math.max(
        headers.indexOf('members'),
        headers.indexOf('member_count'),
        headers.indexOf('count')
      );
      const categoryIdx = headers.indexOf('category');

      // If no headers detected, assume format: title, username, category
      const dataLines = hasHeaders ? lines.slice(1) : lines;

      const groups: GroupInput[] = dataLines.map((line) => {
        const values = line.split(',').map((v) => v.trim());

        let username: string;
        let title: string;
        let category: string | undefined;
        let memberCount: number | undefined;

        if (hasHeaders && usernameIdx !== -1) {
          // Use header positions
          username = values[usernameIdx]?.replace('@', '') || '';
          title = titleIdx !== -1 ? values[titleIdx] : username;
          category = categoryIdx !== -1 ? values[categoryIdx] : undefined;
          memberCount = membersIdx !== -1 ? parseInt(values[membersIdx]) || undefined : undefined;
        } else {
          // Auto-detect format: title, username, category (3 cols) or username only (1 col)
          if (values.length >= 3) {
            title = values[0];
            username = values[1]?.replace('@', '') || '';
            category = values[2];
          } else if (values.length === 2) {
            title = values[0];
            username = values[1]?.replace('@', '') || '';
          } else {
            username = values[0]?.replace('@', '') || '';
            title = username;
          }
        }

        return {
          tg_id: username,
          username,
          title: title || username,
          member_count: memberCount,
          category: category || undefined,
        };
      }).filter((g) => g.username);

      if (groups.length === 0) {
        toast({ title: 'Error', description: 'No valid groups found in CSV', variant: 'destructive' });
        return;
      }

      importMutation.mutate(groups);
    } catch (err) {
      toast({ title: 'Error', description: 'Failed to parse CSV: ' + (err as Error).message, variant: 'destructive' });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import Groups</DialogTitle>
          <DialogDescription>
            Add Telegram groups to use in your campaigns
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="bulk" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="bulk">Bulk Usernames</TabsTrigger>
            <TabsTrigger value="manual">Manual Entry</TabsTrigger>
            <TabsTrigger value="csv">CSV Import</TabsTrigger>
          </TabsList>

          <TabsContent value="bulk" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label>Group Usernames (one per line)</Label>
              <Textarea
                placeholder="@designerscommunity
@freelance_designers
marketingpros
..."
                value={bulkUsernames}
                onChange={(e) => setBulkUsernames(e.target.value)}
                className="min-h-[200px] font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Enter group usernames, one per line. The @ symbol is optional.
              </p>
            </div>
            <Button
              onClick={handleImportBulk}
              disabled={importMutation.isPending || !bulkUsernames.trim()}
              className="w-full"
            >
              {importMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Import Groups
                </>
              )}
            </Button>
          </TabsContent>

          <TabsContent value="manual" className="space-y-4 mt-4">
            <div className="space-y-3 max-h-[300px] overflow-y-auto">
              {manualGroups.map((group, index) => (
                <div key={index} className="flex gap-2 items-start">
                  <div className="flex-1 grid grid-cols-3 gap-2">
                    <Input
                      placeholder="@username"
                      value={group.username}
                      onChange={(e) => updateManualGroup(index, 'username', e.target.value)}
                    />
                    <Input
                      placeholder="Title"
                      value={group.title}
                      onChange={(e) => updateManualGroup(index, 'title', e.target.value)}
                    />
                    <Input
                      placeholder="Category"
                      value={group.category || ''}
                      onChange={(e) => updateManualGroup(index, 'category', e.target.value)}
                    />
                  </div>
                  {manualGroups.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeManualGroup(index)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" onClick={addManualGroup} className="w-full">
              <Plus className="mr-2 h-4 w-4" />
              Add Another Group
            </Button>
            <Button
              onClick={handleImportManual}
              disabled={importMutation.isPending}
              className="w-full"
            >
              {importMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Import Groups
                </>
              )}
            </Button>
          </TabsContent>

          <TabsContent value="csv" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label>CSV Content</Label>
              <Textarea
                placeholder="Group Title,@username,category
Wildberries | Селлеры,@wildberries_business,селлеры
WB Ozon | Чат селлеров,@ozonhelpchat,селлеры"
                value={csvContent}
                onChange={(e) => setCsvContent(e.target.value)}
                className="min-h-[200px] font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Supports formats: title,username,category or username,title,members,category. Headers optional.
              </p>
            </div>
            <Button
              onClick={handleImportCSV}
              disabled={importMutation.isPending || !csvContent.trim()}
              className="w-full"
            >
              {importMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Import CSV
                </>
              )}
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
