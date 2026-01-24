export type Json = string | number | boolean | null | {
    [key: string]: Json | undefined;
} | Json[];
export type Database = {
    public: {
        Tables: {
            tg_accounts: {
                Row: {
                    id: string;
                    phone: string;
                    username: string | null;
                    first_name: string | null;
                    last_name: string | null;
                    status: 'active' | 'inactive' | 'banned' | 'auth_required';
                    session_string: string | null;
                    proxy_config: Json | null;
                    daily_message_limit: number;
                    messages_sent_today: number;
                    last_active_at: string | null;
                    created_at: string;
                    updated_at: string;
                };
                Insert: {
                    id?: string;
                    phone: string;
                    username?: string | null;
                    first_name?: string | null;
                    last_name?: string | null;
                    status?: 'active' | 'inactive' | 'banned' | 'auth_required';
                    session_string?: string | null;
                    proxy_config?: Json | null;
                    daily_message_limit?: number;
                    messages_sent_today?: number;
                    last_active_at?: string | null;
                    created_at?: string;
                    updated_at?: string;
                };
                Update: {
                    id?: string;
                    phone?: string;
                    username?: string | null;
                    first_name?: string | null;
                    last_name?: string | null;
                    status?: 'active' | 'inactive' | 'banned' | 'auth_required';
                    session_string?: string | null;
                    proxy_config?: Json | null;
                    daily_message_limit?: number;
                    messages_sent_today?: number;
                    last_active_at?: string | null;
                    created_at?: string;
                    updated_at?: string;
                };
            };
            campaigns: {
                Row: {
                    id: string;
                    name: string;
                    description: string | null;
                    status: 'draft' | 'active' | 'paused' | 'completed' | 'archived';
                    message_template_id: string | null;
                    schedule_config: Json;
                    group_filter: Json | null;
                    assigned_accounts: string[];
                    stats: Json;
                    created_at: string;
                    updated_at: string;
                };
                Insert: {
                    id?: string;
                    name: string;
                    description?: string | null;
                    status?: 'draft' | 'active' | 'paused' | 'completed' | 'archived';
                    message_template_id?: string | null;
                    schedule_config: Json;
                    group_filter?: Json | null;
                    assigned_accounts?: string[];
                    stats?: Json;
                    created_at?: string;
                    updated_at?: string;
                };
                Update: {
                    id?: string;
                    name?: string;
                    description?: string | null;
                    status?: 'draft' | 'active' | 'paused' | 'completed' | 'archived';
                    message_template_id?: string | null;
                    schedule_config?: Json;
                    group_filter?: Json | null;
                    assigned_accounts?: string[];
                    stats?: Json;
                    created_at?: string;
                    updated_at?: string;
                };
            };
            tg_groups: {
                Row: {
                    id: string;
                    tg_id: string;
                    username: string | null;
                    title: string;
                    description: string | null;
                    member_count: number | null;
                    is_verified: boolean;
                    is_restricted: boolean;
                    category: string | null;
                    tags: string[];
                    last_synced_at: string | null;
                    created_at: string;
                    updated_at: string;
                };
                Insert: {
                    id?: string;
                    tg_id: string;
                    username?: string | null;
                    title: string;
                    description?: string | null;
                    member_count?: number | null;
                    is_verified?: boolean;
                    is_restricted?: boolean;
                    category?: string | null;
                    tags?: string[];
                    last_synced_at?: string | null;
                    created_at?: string;
                    updated_at?: string;
                };
                Update: {
                    id?: string;
                    tg_id?: string;
                    username?: string | null;
                    title?: string;
                    description?: string | null;
                    member_count?: number | null;
                    is_verified?: boolean;
                    is_restricted?: boolean;
                    category?: string | null;
                    tags?: string[];
                    last_synced_at?: string | null;
                    created_at?: string;
                    updated_at?: string;
                };
            };
            sequences: {
                Row: {
                    id: string;
                    name: string;
                    description: string | null;
                    status: 'active' | 'paused' | 'archived';
                    trigger: Json;
                    steps: Json[];
                    assigned_accounts: string[];
                    created_at: string;
                    updated_at: string;
                };
                Insert: {
                    id?: string;
                    name: string;
                    description?: string | null;
                    status?: 'active' | 'paused' | 'archived';
                    trigger: Json;
                    steps: Json[];
                    assigned_accounts?: string[];
                    created_at?: string;
                    updated_at?: string;
                };
                Update: {
                    id?: string;
                    name?: string;
                    description?: string | null;
                    status?: 'active' | 'paused' | 'archived';
                    trigger?: Json;
                    steps?: Json[];
                    assigned_accounts?: string[];
                    created_at?: string;
                    updated_at?: string;
                };
            };
            leads: {
                Row: {
                    id: string;
                    tg_user_id: string;
                    username: string | null;
                    first_name: string | null;
                    last_name: string | null;
                    phone: string | null;
                    status_id: string;
                    source_campaign_id: string | null;
                    source_group_id: string | null;
                    source_message_id: string | null;
                    assigned_account_id: string | null;
                    notes: string | null;
                    custom_fields: Json;
                    last_message_at: string | null;
                    created_at: string;
                    updated_at: string;
                };
                Insert: {
                    id?: string;
                    tg_user_id: string;
                    username?: string | null;
                    first_name?: string | null;
                    last_name?: string | null;
                    phone?: string | null;
                    status_id: string;
                    source_campaign_id?: string | null;
                    source_group_id?: string | null;
                    source_message_id?: string | null;
                    assigned_account_id?: string | null;
                    notes?: string | null;
                    custom_fields?: Json;
                    last_message_at?: string | null;
                    created_at?: string;
                    updated_at?: string;
                };
                Update: {
                    id?: string;
                    tg_user_id?: string;
                    username?: string | null;
                    first_name?: string | null;
                    last_name?: string | null;
                    phone?: string | null;
                    status_id?: string;
                    source_campaign_id?: string | null;
                    source_group_id?: string | null;
                    source_message_id?: string | null;
                    assigned_account_id?: string | null;
                    notes?: string | null;
                    custom_fields?: Json;
                    last_message_at?: string | null;
                    created_at?: string;
                    updated_at?: string;
                };
            };
            lead_statuses: {
                Row: {
                    id: string;
                    name: string;
                    color: string;
                    order: number;
                    is_default: boolean;
                    is_final: boolean;
                    created_at: string;
                };
                Insert: {
                    id?: string;
                    name: string;
                    color: string;
                    order?: number;
                    is_default?: boolean;
                    is_final?: boolean;
                    created_at?: string;
                };
                Update: {
                    id?: string;
                    name?: string;
                    color?: string;
                    order?: number;
                    is_default?: boolean;
                    is_final?: boolean;
                    created_at?: string;
                };
            };
            messages: {
                Row: {
                    id: string;
                    lead_id: string;
                    account_id: string;
                    tg_message_id: string | null;
                    direction: 'incoming' | 'outgoing';
                    type: 'text' | 'video' | 'video_note' | 'voice' | 'photo' | 'document' | 'sticker';
                    content: string | null;
                    media_url: string | null;
                    media_metadata: Json | null;
                    status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
                    sequence_id: string | null;
                    sequence_step_id: string | null;
                    replied_to_message_id: string | null;
                    sent_at: string | null;
                    delivered_at: string | null;
                    read_at: string | null;
                    created_at: string;
                };
                Insert: {
                    id?: string;
                    lead_id: string;
                    account_id: string;
                    tg_message_id?: string | null;
                    direction: 'incoming' | 'outgoing';
                    type: 'text' | 'video' | 'video_note' | 'voice' | 'photo' | 'document' | 'sticker';
                    content?: string | null;
                    media_url?: string | null;
                    media_metadata?: Json | null;
                    status?: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
                    sequence_id?: string | null;
                    sequence_step_id?: string | null;
                    replied_to_message_id?: string | null;
                    sent_at?: string | null;
                    delivered_at?: string | null;
                    read_at?: string | null;
                    created_at?: string;
                };
                Update: {
                    id?: string;
                    lead_id?: string;
                    account_id?: string;
                    tg_message_id?: string | null;
                    direction?: 'incoming' | 'outgoing';
                    type?: 'text' | 'video' | 'video_note' | 'voice' | 'photo' | 'document' | 'sticker';
                    content?: string | null;
                    media_url?: string | null;
                    media_metadata?: Json | null;
                    status?: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
                    sequence_id?: string | null;
                    sequence_step_id?: string | null;
                    replied_to_message_id?: string | null;
                    sent_at?: string | null;
                    delivered_at?: string | null;
                    read_at?: string | null;
                    created_at?: string;
                };
            };
            message_templates: {
                Row: {
                    id: string;
                    name: string;
                    content: string;
                    variables: string[];
                    created_at: string;
                    updated_at: string;
                };
                Insert: {
                    id?: string;
                    name: string;
                    content: string;
                    variables?: string[];
                    created_at?: string;
                    updated_at?: string;
                };
                Update: {
                    id?: string;
                    name?: string;
                    content?: string;
                    variables?: string[];
                    created_at?: string;
                    updated_at?: string;
                };
            };
            campaign_groups: {
                Row: {
                    campaign_id: string;
                    group_id: string;
                    status: 'pending' | 'sent' | 'failed' | 'skipped';
                    sent_at: string | null;
                    error_message: string | null;
                };
                Insert: {
                    campaign_id: string;
                    group_id: string;
                    status?: 'pending' | 'sent' | 'failed' | 'skipped';
                    sent_at?: string | null;
                    error_message?: string | null;
                };
                Update: {
                    campaign_id?: string;
                    group_id?: string;
                    status?: 'pending' | 'sent' | 'failed' | 'skipped';
                    sent_at?: string | null;
                    error_message?: string | null;
                };
            };
            sequence_enrollments: {
                Row: {
                    id: string;
                    sequence_id: string;
                    lead_id: string;
                    current_step: number;
                    status: 'active' | 'completed' | 'cancelled' | 'paused';
                    next_step_at: string | null;
                    started_at: string;
                    completed_at: string | null;
                };
                Insert: {
                    id?: string;
                    sequence_id: string;
                    lead_id: string;
                    current_step?: number;
                    status?: 'active' | 'completed' | 'cancelled' | 'paused';
                    next_step_at?: string | null;
                    started_at?: string;
                    completed_at?: string | null;
                };
                Update: {
                    id?: string;
                    sequence_id?: string;
                    lead_id?: string;
                    current_step?: number;
                    status?: 'active' | 'completed' | 'cancelled' | 'paused';
                    next_step_at?: string | null;
                    started_at?: string;
                    completed_at?: string | null;
                };
            };
        };
        Views: {};
        Functions: {};
        Enums: {};
    };
};
//# sourceMappingURL=supabase.d.ts.map