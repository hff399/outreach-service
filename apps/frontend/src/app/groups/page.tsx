'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Upload, Trash2, Search, Filter, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ImportGroupsDialog } from '@/components/groups/import-groups-dialog';
import { groupsApi } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

type Group = {
  id: string;
  tg_id: string;
  username: string | null;
  title: string;
  description: string | null;
  member_count: number | null;
  category: string | null;
  tags: string[];
};

export default function GroupsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [showImportDialog, setShowImportDialog] = useState(false);

  const { data: groupsData, isLoading } = useQuery({
    queryKey: ['groups', searchQuery, selectedCategory],
    queryFn: () => {
      const params: Record<string, string> = { page_size: '100' };
      if (searchQuery) params.search = searchQuery;
      if (selectedCategory) params.category = selectedCategory;
      return groupsApi.list(params);
    },
  });

  const { data: categories } = useQuery({
    queryKey: ['group-categories'],
    queryFn: () => groupsApi.categories() as Promise<string[]>,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => groupsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      toast({ title: 'Group deleted' });
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: string[]) => groupsApi.bulkDelete(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      setSelectedGroups(new Set());
      toast({ title: 'Groups deleted' });
    },
  });

  const groups = groupsData?.items as Group[] | undefined;

  const toggleGroupSelection = (id: string) => {
    const newSelection = new Set(selectedGroups);
    if (newSelection.has(id)) {
      newSelection.delete(id);
    } else {
      newSelection.add(id);
    }
    setSelectedGroups(newSelection);
  };

  const toggleSelectAll = () => {
    if (selectedGroups.size === groups?.length) {
      setSelectedGroups(new Set());
    } else {
      setSelectedGroups(new Set(groups?.map((g) => g.id)));
    }
  };

  const formatMemberCount = (count: number | null) => {
    if (!count) return '-';
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
    if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
    return count.toString();
  };

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Groups</h1>
          <p className="text-muted-foreground">
            Manage Telegram groups for campaigns
          </p>
        </div>
        <Button onClick={() => setShowImportDialog(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Import Groups
        </Button>
      </div>

      {/* Filters */}
      <div className="mb-6 flex gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search groups..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <select
          value={selectedCategory || ''}
          onChange={(e) => setSelectedCategory(e.target.value || null)}
          className="border rounded-md px-3 py-2 text-sm"
        >
          <option value="">All Categories</option>
          {categories?.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
        {selectedGroups.size > 0 && (
          <Button
            variant="destructive"
            onClick={() => bulkDeleteMutation.mutate(Array.from(selectedGroups))}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete ({selectedGroups.size})
          </Button>
        )}
      </div>

      {/* Groups Table */}
      <Card>
        <CardContent className="p-0">
          <table className="w-full">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="p-4 text-left">
                  <input
                    type="checkbox"
                    checked={selectedGroups.size === groups?.length && groups?.length > 0}
                    onChange={toggleSelectAll}
                    className="rounded"
                  />
                </th>
                <th className="p-4 text-left font-medium">Group</th>
                <th className="p-4 text-left font-medium">Members</th>
                <th className="p-4 text-left font-medium">Category</th>
                <th className="p-4 text-left font-medium">Tags</th>
                <th className="p-4 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-muted-foreground">
                    Loading...
                  </td>
                </tr>
              ) : groups?.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-muted-foreground">
                    No groups found
                  </td>
                </tr>
              ) : (
                groups?.map((group) => (
                  <tr key={group.id} className="hover:bg-muted/50">
                    <td className="p-4">
                      <input
                        type="checkbox"
                        checked={selectedGroups.has(group.id)}
                        onChange={() => toggleGroupSelection(group.id)}
                        className="rounded"
                      />
                    </td>
                    <td className="p-4">
                      <div>
                        <p className="font-medium">{group.title}</p>
                        {group.username && (
                          <p className="text-sm text-muted-foreground">@{group.username}</p>
                        )}
                      </div>
                    </td>
                    <td className="p-4">
                      <span className="font-medium">{formatMemberCount(group.member_count)}</span>
                    </td>
                    <td className="p-4">
                      {group.category ? (
                        <Badge variant="outline">{group.category}</Badge>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="p-4">
                      <div className="flex gap-1 flex-wrap">
                        {group.tags.slice(0, 3).map((tag) => (
                          <Badge key={tag} variant="secondary" className="text-xs">
                            {tag}
                          </Badge>
                        ))}
                        {group.tags.length > 3 && (
                          <Badge variant="secondary" className="text-xs">
                            +{group.tags.length - 3}
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="p-4 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => deleteMutation.mutate(group.id)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Pagination info */}
      {groupsData && (
        <div className="mt-4 text-sm text-muted-foreground">
          Showing {groups?.length} of {groupsData.total} groups
        </div>
      )}

      {/* Empty state */}
      {!isLoading && groups?.length === 0 && !searchQuery && !selectedCategory && (
        <Card className="mt-8">
          <CardContent className="py-12 text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
              <Users className="h-6 w-6 text-muted-foreground" />
            </div>
            <h3 className="font-semibold mb-1">No groups yet</h3>
            <p className="text-muted-foreground mb-4">
              Import Telegram groups to use in your campaigns
            </p>
            <Button onClick={() => setShowImportDialog(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Import Groups
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Import Dialog */}
      <ImportGroupsDialog open={showImportDialog} onOpenChange={setShowImportDialog} />
    </div>
  );
}
