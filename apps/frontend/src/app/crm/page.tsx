'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Send,
  Paperclip,
  Mic,
  Video,
  Search,
  Image,
  FileText,
  X,
  Loader2,
  Phone,
  Calendar,
  MessageSquare,
  ExternalLink,
  User,
  Clock,
  ChevronLeft,
  Info,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { MessageBubble } from '@/components/crm/message-bubble';
import { VoiceRecorder } from '@/components/crm/voice-recorder';
import { VideoRecorder } from '@/components/crm/video-recorder';
import { leadsApi, messagesApi, statusesApi, uploadsApi } from '@/lib/api';
import { wsClient } from '@/lib/websocket';
import { cn, formatRelativeTime, formatDate, getInitials } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

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
  source_type?: string | null;
  source_id?: string | null;
  custom_fields?: Record<string, unknown>;
  lead_statuses: { id: string; name: string; color: string } | null;
  tg_accounts: { id: string; phone: string; username?: string } | null;
  campaigns?: { id: string; name: string } | null;
  tg_groups?: { id: string; title: string; username?: string } | null;
};

type Message = {
  id: string;
  direction: 'incoming' | 'outgoing';
  type: 'text' | 'photo' | 'video' | 'video_note' | 'voice' | 'document' | 'sticker';
  content: string | null;
  media_url: string | null;
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
  created_at: string;
};

type Status = {
  id: string;
  name: string;
  color: string;
};

type RecordingMode = 'none' | 'voice' | 'video';

export default function CRMPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [messageText, setMessageText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
  const [showUnresponded, setShowUnresponded] = useState(false);
  const [recordingMode, setRecordingMode] = useState<RecordingMode>('none');
  const [isUploading, setIsUploading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastTypingRef = useRef<number>(0);

  // Fetch leads with real-time refresh
  const { data: leadsData, isLoading: leadsLoading, refetch: refetchLeads } = useQuery({
    queryKey: ['leads', searchQuery, selectedStatus, showUnresponded],
    queryFn: () => {
      const params: Record<string, string> = { page_size: '100' };
      if (searchQuery) params.search = searchQuery;
      if (selectedStatus) params.status_ids = selectedStatus;
      if (showUnresponded) params.needs_response = 'true';
      return leadsApi.list(params);
    },
    refetchInterval: 3000,
  });

  // Fetch statuses
  const { data: statuses } = useQuery({
    queryKey: ['statuses'],
    queryFn: () => statusesApi.list() as Promise<Status[]>,
  });

  // Fetch lead stats
  const { data: stats } = useQuery({
    queryKey: ['lead-stats'],
    queryFn: () => leadsApi.stats(),
    refetchInterval: 5000,
  });

  // Fetch messages for selected lead
  const { data: messages, refetch: refetchMessages } = useQuery({
    queryKey: ['messages', selectedLead?.id],
    queryFn: () => messagesApi.getForLead(selectedLead!.id) as Promise<Message[]>,
    enabled: !!selectedLead,
    refetchInterval: 2000,
  });

  // Mark messages as read when lead is selected
  useEffect(() => {
    if (selectedLead) {
      messagesApi.markAllRead(selectedLead.id).catch(() => {});
    }
  }, [selectedLead]);

  // Throttled typing indicator
  const sendTypingStatus = useCallback((leadId: string) => {
    const now = Date.now();
    if (now - lastTypingRef.current > 3000) {
      lastTypingRef.current = now;
      messagesApi.sendTyping(leadId).catch(() => {});
    }
  }, []);

  // Send message mutation
  const sendMutation = useMutation({
    mutationFn: (data: {
      lead_id: string;
      account_id: string;
      type: string;
      content?: string;
      media_url?: string;
    }) => messagesApi.send(data),
    onSuccess: () => {
      refetchMessages();
      setMessageText('');
    },
    onError: (error: Error) => {
      toast({
        title: 'Failed to send message',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Update lead status
  const updateStatusMutation = useMutation({
    mutationFn: ({ leadId, statusId }: { leadId: string; statusId: string }) =>
      leadsApi.updateStatus(leadId, statusId),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['lead-stats'] });
      if (selectedLead) {
        setSelectedLead({ ...selectedLead, lead_statuses: (data as Lead).lead_statuses });
      }
    },
  });

  // WebSocket connection for real-time updates
  useEffect(() => {
    wsClient.connect().catch(console.error);

    const unsubscribeIncoming = wsClient.on('message:incoming', () => {
      refetchLeads();
      if (selectedLead) {
        refetchMessages();
      }
    });

    const unsubscribeSent = wsClient.on('message:sent', () => {
      if (selectedLead) {
        refetchMessages();
      }
    });

    return () => {
      unsubscribeIncoming();
      unsubscribeSent();
    };
  }, [refetchLeads, refetchMessages, selectedLead]);

  // Subscribe to lead channel when selected
  useEffect(() => {
    if (selectedLead) {
      wsClient.subscribe([`lead:${selectedLead.id}`]);
      return () => {
        wsClient.unsubscribe([`lead:${selectedLead.id}`]);
      };
    }
  }, [selectedLead]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = useCallback(() => {
    if (!messageText.trim() || !selectedLead) return;

    const accountId = selectedLead.tg_accounts?.id;
    if (!accountId) {
      toast({
        title: 'No account assigned',
        description: 'This lead has no Telegram account assigned',
        variant: 'destructive',
      });
      return;
    }

    sendMutation.mutate({
      lead_id: selectedLead.id,
      account_id: accountId,
      type: 'text',
      content: messageText,
    });
  }, [messageText, selectedLead, sendMutation, toast]);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !selectedLead) return;

    const accountId = selectedLead.tg_accounts?.id;
    if (!accountId) return;

    try {
      setIsUploading(true);
      const upload = await uploadsApi.uploadMedia(file);

      sendMutation.mutate({
        lead_id: selectedLead.id,
        account_id: accountId,
        type: upload.type,
        media_url: upload.url,
        content: file.name,
      });
    } catch (error) {
      toast({
        title: 'Upload failed',
        description: (error as Error).message,
        variant: 'destructive',
      });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleVoiceRecorded = async (blob: Blob) => {
    if (!selectedLead) return;

    const accountId = selectedLead.tg_accounts?.id;
    if (!accountId) return;

    try {
      setIsUploading(true);
      const upload = await uploadsApi.uploadMedia(blob);

      sendMutation.mutate({
        lead_id: selectedLead.id,
        account_id: accountId,
        type: 'voice',
        media_url: upload.url,
      });

      setRecordingMode('none');
    } catch (error) {
      toast({
        title: 'Upload failed',
        description: (error as Error).message,
        variant: 'destructive',
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleVideoRecorded = async (blob: Blob) => {
    if (!selectedLead) return;

    const accountId = selectedLead.tg_accounts?.id;
    if (!accountId) return;

    try {
      setIsUploading(true);
      const upload = await uploadsApi.uploadMedia(blob, true);

      sendMutation.mutate({
        lead_id: selectedLead.id,
        account_id: accountId,
        type: 'video_note',
        media_url: upload.url,
      });

      setRecordingMode('none');
    } catch (error) {
      toast({
        title: 'Upload failed',
        description: (error as Error).message,
        variant: 'destructive',
      });
    } finally {
      setIsUploading(false);
    }
  };

  const leads = leadsData?.items as Lead[] | undefined;

  const getLeadName = (lead: Lead) => {
    if (lead.first_name) {
      return lead.last_name ? `${lead.first_name} ${lead.last_name}` : lead.first_name;
    }
    return lead.username || `User ${lead.tg_user_id}`;
  };

  const handleSelectLead = (lead: Lead) => {
    setSelectedLead(lead);
  };

  // Lead info panel content
  const LeadInfoContent = ({ lead }: { lead: Lead }) => (
    <div className="space-y-6 p-4">
      {/* Status */}
      <div>
        <label className="text-sm font-medium text-muted-foreground mb-2 block">Status</label>
        <select
          value={lead.lead_statuses?.id || ''}
          onChange={(e) =>
            updateStatusMutation.mutate({
              leadId: lead.id,
              statusId: e.target.value,
            })
          }
          className="w-full border rounded-md px-3 py-2"
          style={{ borderColor: lead.lead_statuses?.color }}
        >
          {statuses?.map((status) => (
            <option key={status.id} value={status.id}>
              {status.name}
            </option>
          ))}
        </select>
      </div>

      {/* Contact Info */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Contact Info</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3 text-sm">
            <User className="h-4 w-4 text-muted-foreground" />
            <span>TG ID: {lead.tg_user_id}</span>
          </div>
          {lead.username && (
            <div className="flex items-center gap-3 text-sm">
              <ExternalLink className="h-4 w-4 text-muted-foreground" />
              <a
                href={`https://t.me/${lead.username}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-telegram hover:underline"
              >
                @{lead.username}
              </a>
            </div>
          )}
          {lead.phone && (
            <div className="flex items-center gap-3 text-sm">
              <Phone className="h-4 w-4 text-muted-foreground" />
              <span>{lead.phone}</span>
            </div>
          )}
          <div className="flex items-center gap-3 text-sm">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span>Created: {formatDate(lead.created_at)}</span>
          </div>
        </CardContent>
      </Card>

      {/* Source */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Source</CardTitle>
        </CardHeader>
        <CardContent>
          {lead.campaigns ? (
            <div className="flex items-center gap-2">
              <Badge variant="outline">Campaign</Badge>
              <span className="text-sm">{lead.campaigns.name}</span>
            </div>
          ) : lead.tg_groups ? (
            <div className="flex items-center gap-2">
              <Badge variant="outline">Group</Badge>
              <span className="text-sm">{lead.tg_groups.title}</span>
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">Direct message</span>
          )}
        </CardContent>
      </Card>

      {/* Assigned Account */}
      {lead.tg_accounts && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Assigned Account</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="text-xs">
                  {lead.tg_accounts.username?.[0]?.toUpperCase() || 'A'}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className="text-sm font-medium">
                  {lead.tg_accounts.username || lead.tg_accounts.phone}
                </p>
                <p className="text-xs text-muted-foreground">{lead.tg_accounts.phone}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );

  return (
    <div className="flex h-screen">
      {/* Leads List - narrower when chat is open */}
      <div
        className={cn(
          'flex flex-col overflow-hidden border-r transition-all duration-200',
          selectedLead ? 'w-80' : 'flex-1'
        )}
      >
        {/* Header */}
        <div className="p-4 border-b">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className="text-xl font-bold">CRM</h1>
              <p className="text-xs text-muted-foreground">
                {stats?.total || 0} leads
              </p>
            </div>
          </div>

          {/* Status filters */}
          <div className="flex gap-1 mb-3 overflow-x-auto pb-1">
            <Badge
              variant={selectedStatus === null && !showUnresponded ? 'default' : 'outline'}
              className="cursor-pointer whitespace-nowrap text-xs"
              onClick={() => { setSelectedStatus(null); setShowUnresponded(false); }}
            >
              All
            </Badge>
            <Badge
              variant={showUnresponded ? 'default' : 'outline'}
              className="cursor-pointer whitespace-nowrap text-xs"
              style={{
                backgroundColor: showUnresponded ? '#ef4444' : 'transparent',
                borderColor: '#ef4444',
                color: showUnresponded ? 'white' : '#ef4444',
              }}
              onClick={() => { setShowUnresponded(!showUnresponded); setSelectedStatus(null); }}
            >
              Unresponded {stats?.unresponded ? `(${stats.unresponded})` : ''}
            </Badge>
            {statuses?.map((status) => (
              <Badge
                key={status.id}
                variant={selectedStatus === status.id ? 'default' : 'outline'}
                className="cursor-pointer whitespace-nowrap text-xs"
                style={{
                  backgroundColor: selectedStatus === status.id ? status.color : 'transparent',
                  borderColor: status.color,
                  color: selectedStatus === status.id ? 'white' : status.color,
                }}
                onClick={() => setSelectedStatus(selectedStatus === status.id ? null : status.id)}
              >
                {status.name}
              </Badge>
            ))}
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-9"
            />
          </div>
        </div>

        {/* Leads List */}
        <ScrollArea className="flex-1">
          <div className="divide-y">
            {leadsLoading ? (
              <div className="p-8 text-center text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                Loading...
              </div>
            ) : leads?.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                <MessageSquare className="h-10 w-10 mx-auto mb-3 opacity-50" />
                <p className="text-sm">No leads yet</p>
              </div>
            ) : (
              leads?.map((lead) => (
                <div
                  key={lead.id}
                  onClick={() => handleSelectLead(lead)}
                  className={cn(
                    'p-3 cursor-pointer hover:bg-muted/50 transition-colors',
                    selectedLead?.id === lead.id && 'bg-muted'
                  )}
                >
                  <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10">
                      <AvatarFallback className="bg-telegram text-white">
                        {getInitials(getLeadName(lead))}
                      </AvatarFallback>
                    </Avatar>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-sm truncate">{getLeadName(lead)}</p>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {lead.lead_statuses && (
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: lead.lead_statuses.color }}
                          />
                        )}
                        {lead.last_message_at && (
                          <span>{formatRelativeTime(lead.last_message_at)}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Chat Panel */}
      {selectedLead ? (
        <div className="flex-1 flex flex-col min-w-0">
          {/* Chat Header */}
          <div className="h-14 border-b flex items-center justify-between px-4 shrink-0">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden"
                onClick={() => setSelectedLead(null)}
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <Avatar className="h-9 w-9">
                <AvatarFallback className="bg-telegram text-white">
                  {getInitials(getLeadName(selectedLead))}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className="font-medium text-sm">{getLeadName(selectedLead)}</p>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  {selectedLead.lead_statuses && (
                    <>
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: selectedLead.lead_statuses.color }}
                      />
                      {selectedLead.lead_statuses.name}
                    </>
                  )}
                  {selectedLead.username && (
                    <span className="ml-2">@{selectedLead.username}</span>
                  )}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Status quick change */}
              <select
                value={selectedLead.lead_statuses?.id || ''}
                onChange={(e) =>
                  updateStatusMutation.mutate({
                    leadId: selectedLead.id,
                    statusId: e.target.value,
                  })
                }
                className="text-xs border rounded px-2 py-1"
              >
                {statuses?.map((status) => (
                  <option key={status.id} value={status.id}>
                    {status.name}
                  </option>
                ))}
              </select>

              {/* Lead info sheet */}
              <Sheet>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon">
                    <Info className="h-4 w-4" />
                  </Button>
                </SheetTrigger>
                <SheetContent>
                  <SheetHeader>
                    <SheetTitle>Lead Details</SheetTitle>
                  </SheetHeader>
                  <LeadInfoContent lead={selectedLead} />
                </SheetContent>
              </Sheet>

              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSelectedLead(null)}
                className="hidden md:flex"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Messages */}
          <ScrollArea className="flex-1 p-4">
            <div className="space-y-3 max-w-3xl mx-auto">
              {messages?.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))}
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>

          {/* Message Input */}
          <div className="border-t p-3 shrink-0">
            <div className="max-w-3xl mx-auto">
              {recordingMode === 'voice' ? (
                <VoiceRecorder
                  onRecorded={handleVoiceRecorded}
                  onCancel={() => setRecordingMode('none')}
                  isUploading={isUploading}
                />
              ) : (
                <div className="flex items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,video/*,audio/*,.pdf,.doc,.docx"
                    onChange={handleFileSelect}
                    className="hidden"
                  />

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" disabled={isUploading}>
                        {isUploading ? (
                          <Loader2 className="h-5 w-5 animate-spin" />
                        ) : (
                          <Paperclip className="h-5 w-5" />
                        )}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem
                        onClick={() => {
                          if (fileInputRef.current) {
                            fileInputRef.current.accept = 'image/*';
                            fileInputRef.current.click();
                          }
                        }}
                      >
                        <Image className="h-4 w-4 mr-2" />
                        Photo
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          if (fileInputRef.current) {
                            fileInputRef.current.accept = 'video/*';
                            fileInputRef.current.click();
                          }
                        }}
                      >
                        <Video className="h-4 w-4 mr-2" />
                        Video
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          if (fileInputRef.current) {
                            fileInputRef.current.accept = '.pdf,.doc,.docx';
                            fileInputRef.current.click();
                          }
                        }}
                      >
                        <FileText className="h-4 w-4 mr-2" />
                        Document
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <Input
                    placeholder="Type a message..."
                    value={messageText}
                    onChange={(e) => {
                      setMessageText(e.target.value);
                      if (selectedLead && e.target.value.length > 0) {
                        sendTypingStatus(selectedLead.id);
                      }
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
                    className="flex-1"
                    disabled={isUploading}
                  />

                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setRecordingMode('voice')}
                    disabled={isUploading}
                  >
                    <Mic className="h-5 w-5" />
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setRecordingMode('video')}
                    disabled={isUploading}
                  >
                    <Video className="h-5 w-5" />
                  </Button>

                  <Button
                    variant="telegram"
                    size="icon"
                    onClick={handleSendMessage}
                    disabled={!messageText.trim() || sendMutation.isPending || isUploading}
                  >
                    <Send className="h-5 w-5" />
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Video Recorder Dialog */}
          <VideoRecorder
            open={recordingMode === 'video'}
            onOpenChange={(open) => !open && setRecordingMode('none')}
            onRecorded={handleVideoRecorded}
            isUploading={isUploading}
          />
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-center">
            <MessageSquare className="h-16 w-16 mx-auto mb-4 opacity-30" />
            <p className="text-lg font-medium">Select a conversation</p>
            <p className="text-sm">Choose a lead from the list to start chatting</p>
          </div>
        </div>
      )}
    </div>
  );
}
