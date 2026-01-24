export type TgAccountStatus = 'active' | 'inactive' | 'banned' | 'auth_required';
export type TgAccount = {
    id: string;
    phone: string;
    username: string | null;
    first_name: string | null;
    last_name: string | null;
    status: TgAccountStatus;
    session_string: string | null;
    proxy_config: ProxyConfig | null;
    daily_message_limit: number;
    messages_sent_today: number;
    last_active_at: string | null;
    created_at: string;
    updated_at: string;
};
export type ProxyConfig = {
    type: 'socks5' | 'http' | 'mtproto';
    host: string;
    port: number;
    username?: string;
    password?: string;
};
export type CampaignStatus = 'draft' | 'active' | 'paused' | 'completed' | 'archived';
export type Campaign = {
    id: string;
    name: string;
    description: string | null;
    status: CampaignStatus;
    message_template_id: string | null;
    schedule_config: ScheduleConfig;
    group_filter: GroupFilter | null;
    assigned_accounts: string[];
    stats: CampaignStats;
    created_at: string;
    updated_at: string;
};
export type ScheduleConfig = {
    type: 'immediate';
    min_delay_seconds: number;
    max_delay_seconds: number;
    randomize_delay?: boolean;
    account_rotation?: 'round_robin' | 'random' | 'least_used';
};
export type GroupFilter = {
    include_group_ids?: string[];
    exclude_group_ids?: string[];
    min_members?: number;
    max_members?: number;
    keywords?: string[];
    categories?: string[];
};
export type CampaignStats = {
    total_groups: number;
    messages_sent: number;
    messages_failed: number;
    responses_received: number;
};
export type TgGroup = {
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
export type SequenceStatus = 'active' | 'paused' | 'archived';
export type SequenceStepType = 'message' | 'status_change' | 'reminder' | 'wait' | 'branch' | 'tag' | 'assign' | 'webhook';
export type MessageContentType = 'text' | 'video' | 'video_note' | 'voice' | 'photo' | 'document';
export type SequenceTriggerType = 'new_message' | 'keyword' | 'regex' | 'any';
export type Sequence = {
    id: string;
    name: string;
    description: string | null;
    status: SequenceStatus;
    trigger: SequenceTrigger;
    steps: SequenceStep[];
    assigned_accounts: string[];
    exit_conditions?: ExitCondition[];
    created_at: string;
    updated_at: string;
};
export type SequenceTrigger = {
    type: SequenceTriggerType;
    keywords?: string[];
    regex_pattern?: string;
    source_campaign_ids?: string[];
};
export type SequenceStep = {
    id: string;
    order: number;
    type: SequenceStepType;
    delay_minutes: number;
    conditions?: StepCondition[];
    message_type?: MessageContentType;
    content?: string;
    status_id?: string;
    reminder?: {
        title: string;
        due_minutes: number;
        priority?: 'low' | 'medium' | 'high';
    };
    wait_condition?: {
        type: 'reply' | 'no_reply' | 'time';
        timeout_minutes?: number;
    };
    branches?: {
        condition: StepCondition;
        next_step_id: string;
    }[];
    default_next_step_id?: string;
    tags_to_add?: string[];
    tags_to_remove?: string[];
    assign_to_account_id?: string;
    webhook_url?: string;
    webhook_method?: 'GET' | 'POST';
};
export type StepCondition = {
    type: 'no_reply' | 'replied' | 'keyword_match' | 'status_is' | 'has_tag';
    value?: string;
    timeout_minutes?: number;
};
export type ExitCondition = {
    type: 'replied' | 'status_changed' | 'unsubscribed' | 'manual';
};
export type Lead = {
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
    custom_fields: Record<string, unknown>;
    last_message_at: string | null;
    created_at: string;
    updated_at: string;
};
export type LeadStatus = {
    id: string;
    name: string;
    color: string;
    order: number;
    is_default: boolean;
    is_final: boolean;
    created_at: string;
};
export type MessageDirection = 'incoming' | 'outgoing';
export type MessageType = 'text' | 'video' | 'video_note' | 'voice' | 'photo' | 'document' | 'sticker';
export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
export type Message = {
    id: string;
    lead_id: string;
    account_id: string;
    tg_message_id: string | null;
    direction: MessageDirection;
    type: MessageType;
    content: string | null;
    media_url: string | null;
    media_metadata: MediaMetadata | null;
    status: MessageStatus;
    sequence_id: string | null;
    sequence_step_id: string | null;
    replied_to_message_id: string | null;
    sent_at: string | null;
    delivered_at: string | null;
    read_at: string | null;
    created_at: string;
};
export type MediaMetadata = {
    file_name?: string;
    file_size?: number;
    mime_type?: string;
    duration?: number;
    width?: number;
    height?: number;
    thumbnail_url?: string;
};
export type MessageTemplate = {
    id: string;
    name: string;
    content: string;
    variables: string[];
    created_at: string;
    updated_at: string;
};
//# sourceMappingURL=entities.d.ts.map