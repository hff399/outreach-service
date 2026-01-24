import type { Message, Lead, TgAccount } from './entities.js';
export type WsEventType = 'connection:established' | 'connection:error' | 'account:status_changed' | 'account:auth_required' | 'account:auth_code_needed' | 'account:auth_2fa_needed' | 'account:connected' | 'account:disconnected' | 'message:new' | 'message:incoming' | 'message:sent' | 'message:delivered' | 'message:read' | 'message:failed' | 'lead:new' | 'lead:updated' | 'lead:typing' | 'campaign:started' | 'campaign:paused' | 'campaign:completed' | 'campaign:message_sent' | 'campaign:error';
export type WsMessage<T = unknown> = {
    type: WsEventType;
    payload: T;
    timestamp: string;
};
export type WsClientMessage = {
    type: 'subscribe';
    channels: string[];
} | {
    type: 'unsubscribe';
    channels: string[];
} | {
    type: 'ping';
} | {
    type: 'auth:send_code';
    account_id: string;
    code: string;
} | {
    type: 'auth:send_2fa';
    account_id: string;
    password: string;
} | {
    type: 'typing:start';
    lead_id: string;
    account_id: string;
} | {
    type: 'typing:stop';
    lead_id: string;
    account_id: string;
};
export type ConnectionEstablishedPayload = {
    client_id: string;
    server_time: string;
};
export type AccountStatusPayload = {
    account_id: string;
    status: TgAccount['status'];
    is_connected: boolean;
};
export type AuthCodeNeededPayload = {
    account_id: string;
    phone: string;
    phone_code_hash: string;
};
export type Auth2FANeededPayload = {
    account_id: string;
    phone: string;
    hint?: string;
};
export type NewMessagePayload = {
    message: Message;
    lead: Lead;
};
export type MessageStatusPayload = {
    message_id: string;
    status: Message['status'];
    timestamp: string;
};
export type LeadTypingPayload = {
    lead_id: string;
    is_typing: boolean;
};
export type CampaignProgressPayload = {
    campaign_id: string;
    total_groups: number;
    messages_sent: number;
    messages_failed: number;
    current_group?: string;
};
//# sourceMappingURL=websocket.d.ts.map