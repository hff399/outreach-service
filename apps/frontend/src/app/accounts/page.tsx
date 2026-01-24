'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw, Power, Trash2, Wifi, WifiOff, Shield, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { AuthDialog } from '@/components/accounts/auth-dialog';
import { accountsApi } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

type Account = {
  id: string;
  phone: string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  status: 'active' | 'inactive' | 'banned' | 'auth_required';
  is_connected: boolean;
  daily_message_limit: number;
  messages_sent_today: number;
  last_active_at: string | null;
};

type ProxyConfig = {
  type: 'socks5' | 'http' | 'mtproto';
  host: string;
  port: number;
  username?: string;
  password?: string;
};

export default function AccountsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // State for dialogs
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [authAccount, setAuthAccount] = useState<Account | null>(null);
  const [deleteAccount, setDeleteAccount] = useState<Account | null>(null);

  // Form state
  const [newPhone, setNewPhone] = useState('');
  const [dailyLimit, setDailyLimit] = useState('50');
  const [useProxy, setUseProxy] = useState(false);
  const [proxy, setProxy] = useState<ProxyConfig>({
    type: 'socks5',
    host: '',
    port: 1080,
  });

  const { data: accounts, isLoading, refetch } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountsApi.list() as Promise<Account[]>,
    refetchInterval: 30000, // Refresh every 30s for health status
  });

  const createMutation = useMutation({
    mutationFn: () =>
      accountsApi.create({
        phone: newPhone,
        daily_message_limit: parseInt(dailyLimit) || 50,
        proxy_config: useProxy ? proxy : undefined,
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      setShowAddDialog(false);
      resetForm();
      // Automatically open auth dialog for new account
      setAuthAccount(data as Account);
      toast({ title: 'Account added', description: 'Please complete authentication' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const reconnectMutation = useMutation({
    mutationFn: (id: string) => accountsApi.reconnect(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      toast({ title: 'Reconnected', description: 'Account is now connected' });
    },
    onError: (error: Error) => {
      toast({ title: 'Connection failed', description: error.message, variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => accountsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      setDeleteAccount(null);
      toast({ title: 'Deleted', description: 'Account removed successfully' });
    },
  });

  const resetForm = () => {
    setNewPhone('');
    setDailyLimit('50');
    setUseProxy(false);
    setProxy({ type: 'socks5', host: '', port: 1080 });
  };

  const getStatusBadge = (account: Account) => {
    if (account.status === 'banned') {
      return (
        <Badge variant="destructive" className="gap-1">
          <AlertTriangle className="h-3 w-3" />
          Banned
        </Badge>
      );
    }
    if (account.status === 'auth_required') {
      return (
        <Badge variant="secondary" className="gap-1">
          <Shield className="h-3 w-3" />
          Auth Required
        </Badge>
      );
    }
    if (account.is_connected) {
      return (
        <Badge variant="success" className="gap-1">
          <Wifi className="h-3 w-3" />
          Connected
        </Badge>
      );
    }
    return (
      <Badge variant="warning" className="gap-1">
        <WifiOff className="h-3 w-3" />
        Disconnected
      </Badge>
    );
  };

  const formatLastActive = (date: string | null) => {
    if (!date) return 'Never';
    const d = new Date(date);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  const connectedCount = accounts?.filter((a) => a.is_connected).length || 0;
  const totalCount = accounts?.length || 0;

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Telegram Accounts</h1>
          <p className="text-muted-foreground">
            {connectedCount}/{totalCount} accounts connected
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button onClick={() => setShowAddDialog(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Account
          </Button>
        </div>
      </div>

      {/* Accounts Grid */}
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader className="pb-3">
                <div className="h-6 bg-muted rounded w-1/2" />
                <div className="h-4 bg-muted rounded w-1/3 mt-2" />
              </CardHeader>
              <CardContent>
                <div className="h-4 bg-muted rounded w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {accounts?.map((account) => (
            <Card key={account.id} className={account.is_connected ? 'border-green-500/30' : ''}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-lg flex items-center gap-2">
                      {account.first_name || account.username || 'Unknown'}
                      {account.last_name && ` ${account.last_name}`}
                    </CardTitle>
                    <CardDescription className="flex flex-col">
                      <span>{account.phone}</span>
                      {account.username && <span className="text-xs">@{account.username}</span>}
                    </CardDescription>
                  </div>
                  {getStatusBadge(account)}
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {/* Message stats */}
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Messages today</span>
                    <span className="font-medium">
                      {account.messages_sent_today}/{account.daily_message_limit}
                    </span>
                  </div>

                  {/* Progress bar */}
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{
                        width: `${Math.min((account.messages_sent_today / account.daily_message_limit) * 100, 100)}%`,
                      }}
                    />
                  </div>

                  {/* Last active */}
                  <p className="text-xs text-muted-foreground">
                    Last active: {formatLastActive(account.last_active_at)}
                  </p>

                  {/* Actions */}
                  <div className="flex gap-2 pt-2">
                    {account.status === 'auth_required' ? (
                      <Button
                        size="sm"
                        className="flex-1"
                        onClick={() => setAuthAccount(account)}
                      >
                        <Power className="mr-2 h-4 w-4" />
                        Authenticate
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        onClick={() => reconnectMutation.mutate(account.id)}
                        disabled={reconnectMutation.isPending || account.is_connected}
                      >
                        <RefreshCw className={`mr-2 h-4 w-4 ${reconnectMutation.isPending ? 'animate-spin' : ''}`} />
                        {account.is_connected ? 'Connected' : 'Reconnect'}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDeleteAccount(account)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}

          {/* Empty state */}
          {accounts?.length === 0 && (
            <Card className="col-span-full">
              <CardContent className="py-12 text-center">
                <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
                  <Plus className="h-6 w-6 text-muted-foreground" />
                </div>
                <h3 className="font-semibold mb-1">No accounts yet</h3>
                <p className="text-muted-foreground mb-4">
                  Add your first Telegram account to start sending messages
                </p>
                <Button onClick={() => setShowAddDialog(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Account
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Add Account Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Telegram Account</DialogTitle>
            <DialogDescription>
              Enter the phone number in international format (e.g., +79991234567)
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number</Label>
              <Input
                id="phone"
                type="tel"
                placeholder="+7 999 123 4567"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="limit">Daily Message Limit</Label>
              <Input
                id="limit"
                type="number"
                min="1"
                max="500"
                placeholder="50"
                value={dailyLimit}
                onChange={(e) => setDailyLimit(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Maximum messages this account can send per day (1-500)
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="useProxy"
                checked={useProxy}
                onChange={(e) => setUseProxy(e.target.checked)}
                className="rounded"
              />
              <Label htmlFor="useProxy" className="cursor-pointer">Use proxy</Label>
            </div>
            {useProxy && (
              <div className="space-y-3 p-4 border rounded-lg">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Type</Label>
                    <select
                      className="w-full h-10 px-3 rounded-md border bg-background"
                      value={proxy.type}
                      onChange={(e) => setProxy({ ...proxy, type: e.target.value as ProxyConfig['type'] })}
                    >
                      <option value="socks5">SOCKS5</option>
                      <option value="http">HTTP</option>
                      <option value="mtproto">MTProto</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label>Port</Label>
                    <Input
                      type="number"
                      value={proxy.port}
                      onChange={(e) => setProxy({ ...proxy, port: parseInt(e.target.value) })}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Host</Label>
                  <Input
                    placeholder="proxy.example.com"
                    value={proxy.host}
                    onChange={(e) => setProxy({ ...proxy, host: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Username (optional)</Label>
                    <Input
                      value={proxy.username || ''}
                      onChange={(e) => setProxy({ ...proxy, username: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Password (optional)</Label>
                    <Input
                      type="password"
                      value={proxy.password || ''}
                      onChange={(e) => setProxy({ ...proxy, password: e.target.value })}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || !newPhone}
            >
              {createMutation.isPending ? 'Adding...' : 'Add Account'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Auth Dialog */}
      <AuthDialog
        account={authAccount}
        open={!!authAccount}
        onOpenChange={(open) => !open && setAuthAccount(null)}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteAccount} onOpenChange={(open) => !open && setDeleteAccount(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Account</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove {deleteAccount?.phone}? This will disconnect the account
              and remove all associated data. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteAccount(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteAccount && deleteMutation.mutate(deleteAccount.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete Account'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
