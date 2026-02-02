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

  // Parse CSV line handling quoted values with commas inside
  const parseCSVLine = (line: string, delimiter: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          // Escaped quote
          current += '"';
          i++;
        } else {
          // Toggle quote mode
          inQuotes = !inQuotes;
        }
      } else if (char === delimiter && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };

  // Normalize header name for matching
  const normalizeHeader = (h: string): string => {
    return h.toLowerCase()
      .replace(/^@/, '')           // Remove leading @
      .replace(/[_\-\s]+/g, '')    // Remove separators
      .replace(/^["']|["']$/g, ''); // Remove quotes
  };

  const handleImportCSV = () => {
    try {
      // Remove BOM if present and normalize line endings
      let content = csvContent.trim();
      if (content.charCodeAt(0) === 0xFEFF) {
        content = content.slice(1);
      }
      content = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

      const lines = content.split('\n').filter(line => line.trim());
      if (lines.length < 1) {
        toast({ title: 'Error', description: 'CSV is empty', variant: 'destructive' });
        return;
      }

      // Auto-detect delimiter: comma or semicolon
      const firstLine = lines[0];
      const commaCount = (firstLine.match(/,/g) || []).length;
      const semicolonCount = (firstLine.match(/;/g) || []).length;
      const delimiter = semicolonCount > commaCount ? ';' : ',';

      const rawHeaders = parseCSVLine(lines[0], delimiter);
      const headers = rawHeaders.map(normalizeHeader);

      // Header variations mapping
      const usernameVariants = ['username', 'handle', 'link', 'user', 'tgusername', 'telegramusername', 'юзернейм', 'ссылка'];
      const titleVariants = ['title', 'name', 'group', 'groupname', 'название', 'имя', 'группа'];
      const membersVariants = ['members', 'membercount', 'count', 'участники', 'количество'];
      const categoryVariants = ['category', 'cat', 'type', 'категория', 'тип'];

      // Check if first line looks like headers
      const headerKeywords = [...usernameVariants, ...titleVariants, ...membersVariants, ...categoryVariants];
      const hasHeaders = headers.some(h => headerKeywords.includes(h));

      // Find column indexes with flexible matching
      const findIndex = (variants: string[]): number => {
        for (const variant of variants) {
          const idx = headers.indexOf(variant);
          if (idx !== -1) return idx;
        }
        return -1;
      };

      const usernameIdx = findIndex(usernameVariants);
      const titleIdx = findIndex(titleVariants);
      const membersIdx = findIndex(membersVariants);
      const categoryIdx = findIndex(categoryVariants);

      // If no headers detected, assume format: title, username, category
      const dataLines = hasHeaders ? lines.slice(1) : lines;

      const groups: GroupInput[] = dataLines.map((line) => {
        const values = parseCSVLine(line, delimiter);

        let username: string;
        let title: string;
        let category: string | undefined;
        let memberCount: number | undefined;

        if (hasHeaders && usernameIdx !== -1) {
          // Use header positions
          username = (values[usernameIdx] || '').replace(/^@/, '').replace(/^https?:\/\/t\.me\//i, '');
          title = titleIdx !== -1 ? (values[titleIdx] || username) : username;
          category = categoryIdx !== -1 ? values[categoryIdx] : undefined;
          memberCount = membersIdx !== -1 ? parseInt(values[membersIdx]) || undefined : undefined;
        } else {
          // Auto-detect format based on column count
          if (values.length >= 3) {
            // Assume: title, username, category
            title = values[0];
            username = (values[1] || '').replace(/^@/, '').replace(/^https?:\/\/t\.me\//i, '');
            category = values[2];
          } else if (values.length === 2) {
            // Could be: title, username OR username, title
            // Heuristic: if first value starts with @ or looks like a username, treat it as username
            const first = values[0] || '';
            const second = values[1] || '';
            if (first.startsWith('@') || first.match(/^[a-z0-9_]+$/i)) {
              username = first.replace(/^@/, '').replace(/^https?:\/\/t\.me\//i, '');
              title = second || username;
            } else {
              title = first;
              username = second.replace(/^@/, '').replace(/^https?:\/\/t\.me\//i, '');
            }
          } else {
            // Single column - treat as username
            username = (values[0] || '').replace(/^@/, '').replace(/^https?:\/\/t\.me\//i, '');
            title = username;
          }
        }

        // Clean up empty strings
        username = username.trim();
        title = (title || username).trim();
        category = category?.trim() || undefined;

        return {
          tg_id: username,
          username,
          title: title || username,
          member_count: memberCount,
          category: category || undefined,
        };
      }).filter((g) => g.username && g.username.length > 0);

      if (groups.length === 0) {
        toast({ title: 'Error', description: 'No valid groups found in CSV. Check format: username required.', variant: 'destructive' });
        return;
      }

      // Deduplicate by username (tg_id) - keep last occurrence (overwrites earlier)
      const uniqueGroups = Array.from(
        new Map(groups.map(g => [g.username.toLowerCase(), g])).values()
      );

      if (uniqueGroups.length < groups.length) {
        toast({
          title: 'Note',
          description: `Removed ${groups.length - uniqueGroups.length} duplicate entries`,
        });
      }

      importMutation.mutate(uniqueGroups);
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
                placeholder="title,username,category
Wildberries | Селлеры,@wildberries_business,селлеры
WB Ozon | Чат селлеров,@ozonhelpchat,селлеры

Or just usernames:
@wildberries_business
@ozonhelpchat"
                value={csvContent}
                onChange={(e) => setCsvContent(e.target.value)}
                className="min-h-[200px] font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Supports: CSV with headers, without headers, semicolon delimiter (;), quoted values, t.me links.
                Headers: username/handle/link, title/name/group, category, members.
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
