'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Filter, MoreVertical, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { leadsApi, statusesApi } from '@/lib/api';
import { formatRelativeTime, getInitials } from '@/lib/utils';
import Link from 'next/link';

type Lead = {
  id: string;
  tg_user_id: string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  notes: string | null;
  last_message_at: string | null;
  created_at: string;
  lead_statuses: { id: string; name: string; color: string } | null;
  campaigns?: { id: string; name: string } | null;
};

type Status = {
  id: string;
  name: string;
  color: string;
};

export default function LeadsPage() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);

  const { data: leadsData, isLoading } = useQuery({
    queryKey: ['leads', searchQuery, selectedStatus],
    queryFn: () => {
      const params: Record<string, string> = { page_size: '50' };
      if (searchQuery) params.search = searchQuery;
      if (selectedStatus) params.status_ids = selectedStatus;
      return leadsApi.list(params);
    },
  });

  const { data: statuses } = useQuery({
    queryKey: ['statuses'],
    queryFn: () => statusesApi.list() as Promise<Status[]>,
  });

  const { data: stats } = useQuery({
    queryKey: ['lead-stats'],
    queryFn: () => leadsApi.stats(),
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ leadId, statusId }: { leadId: string; statusId: string }) =>
      leadsApi.updateStatus(leadId, statusId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['lead-stats'] });
    },
  });

  const leads = leadsData?.items as Lead[] | undefined;

  const getLeadName = (lead: Lead) => {
    if (lead.first_name) {
      return lead.last_name ? `${lead.first_name} ${lead.last_name}` : lead.first_name;
    }
    return lead.username || lead.tg_user_id;
  };

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Leads</h1>
        <p className="text-muted-foreground">
          Manage and track all your leads
        </p>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid gap-4 md:grid-cols-4 mb-6">
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Total Leads</p>
              <p className="text-2xl font-bold">{stats.total}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">New Today</p>
              <p className="text-2xl font-bold text-green-600">{stats.new_today}</p>
            </CardContent>
          </Card>
          {(stats.by_status as Array<{ name: string; color: string; count: number }>)
            ?.slice(0, 2)
            .map((status) => (
              <Card key={status.name}>
                <CardContent className="pt-6">
                  <p className="text-sm text-muted-foreground">{status.name}</p>
                  <p className="text-2xl font-bold" style={{ color: status.color }}>
                    {status.count}
                  </p>
                </CardContent>
              </Card>
            ))}
        </div>
      )}

      {/* Filters */}
      <div className="mb-6 flex gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search leads..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <select
          value={selectedStatus || ''}
          onChange={(e) => setSelectedStatus(e.target.value || null)}
          className="border rounded-md px-3 py-2 text-sm"
        >
          <option value="">All Statuses</option>
          {statuses?.map((status) => (
            <option key={status.id} value={status.id}>
              {status.name}
            </option>
          ))}
        </select>
      </div>

      {/* Leads Table */}
      <Card>
        <CardContent className="p-0">
          <table className="w-full">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="p-4 text-left font-medium">Lead</th>
                <th className="p-4 text-left font-medium">Status</th>
                <th className="p-4 text-left font-medium">Source</th>
                <th className="p-4 text-left font-medium">Last Message</th>
                <th className="p-4 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-muted-foreground">
                    Loading...
                  </td>
                </tr>
              ) : leads?.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-muted-foreground">
                    No leads found
                  </td>
                </tr>
              ) : (
                leads?.map((lead) => (
                  <tr key={lead.id} className="hover:bg-muted/50">
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <Avatar>
                          <AvatarFallback className="bg-telegram text-white">
                            {getInitials(getLeadName(lead))}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium">{getLeadName(lead)}</p>
                          {lead.username && (
                            <p className="text-sm text-muted-foreground">@{lead.username}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="p-4">
                      <select
                        value={lead.lead_statuses?.id || ''}
                        onChange={(e) =>
                          updateStatusMutation.mutate({
                            leadId: lead.id,
                            statusId: e.target.value,
                          })
                        }
                        className="text-sm border rounded px-2 py-1"
                        style={{
                          borderColor: lead.lead_statuses?.color,
                          color: lead.lead_statuses?.color,
                        }}
                      >
                        {statuses?.map((status) => (
                          <option key={status.id} value={status.id}>
                            {status.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="p-4">
                      {lead.campaigns ? (
                        <Badge variant="outline">{lead.campaigns.name}</Badge>
                      ) : (
                        <span className="text-muted-foreground">Direct</span>
                      )}
                    </td>
                    <td className="p-4 text-muted-foreground">
                      {lead.last_message_at
                        ? formatRelativeTime(lead.last_message_at)
                        : '-'}
                    </td>
                    <td className="p-4 text-right">
                      <Link href={`/crm?lead=${lead.id}`}>
                        <Button size="sm" variant="ghost">
                          <MessageSquare className="h-4 w-4" />
                        </Button>
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Pagination info */}
      {leadsData && (
        <div className="mt-4 text-sm text-muted-foreground">
          Showing {leads?.length} of {leadsData.total} leads
        </div>
      )}
    </div>
  );
}
