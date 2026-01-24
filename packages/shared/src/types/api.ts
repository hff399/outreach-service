import type {
  TgAccount,
  Campaign,
  TgGroup,
  Sequence,
  Lead,
  LeadStatus,
  Message,
  MessageTemplate,
  ProxyConfig,
  ScheduleConfig,
  GroupFilter,
  SequenceTrigger,
  SequenceStep,
} from './entities.js';

// ==========================================
// API Response Types
// ==========================================

export type ApiResponse<T> = {
  success: true;
  data: T;
} | {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export type PaginatedResponse<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

// ==========================================
// Account API Types
// ==========================================

export type CreateAccountRequest = {
  phone: string;
  proxy_config?: ProxyConfig;
  daily_message_limit?: number;
};

export type UpdateAccountRequest = {
  proxy_config?: ProxyConfig;
  daily_message_limit?: number;
  status?: 'active' | 'inactive';
};

export type AccountAuthRequest = {
  account_id: string;
  code?: string;
  password?: string; // 2FA password
};

export type AccountHealthResponse = {
  accounts: Array<{
    id: string;
    phone: string;
    status: TgAccount['status'];
    is_connected: boolean;
    last_active_at: string | null;
  }>;
};

// ==========================================
// Campaign API Types
// ==========================================

export type CreateCampaignRequest = {
  name: string;
  description?: string;
  message_template_id?: string;
  schedule_config: ScheduleConfig;
  group_filter?: GroupFilter;
  assigned_accounts?: string[];
};

export type UpdateCampaignRequest = Partial<CreateCampaignRequest> & {
  status?: Campaign['status'];
};

// ==========================================
// Group API Types
// ==========================================

export type ImportGroupsRequest = {
  groups: Array<{
    tg_id: string;
    username?: string;
    title: string;
    category?: string;
    tags?: string[];
  }>;
};

export type UpdateGroupRequest = {
  category?: string;
  tags?: string[];
};

// ==========================================
// Sequence API Types
// ==========================================

export type CreateSequenceRequest = {
  name: string;
  description?: string;
  trigger: SequenceTrigger;
  steps: Omit<SequenceStep, 'id'>[];
  assigned_accounts?: string[];
};

export type UpdateSequenceRequest = Partial<CreateSequenceRequest> & {
  status?: Sequence['status'];
};

// ==========================================
// Lead API Types
// ==========================================

export type CreateLeadRequest = {
  tg_user_id: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  status_id?: string;
  source_campaign_id?: string;
  source_group_id?: string;
  assigned_account_id?: string;
  notes?: string;
  custom_fields?: Record<string, unknown>;
};

export type UpdateLeadRequest = Partial<Omit<CreateLeadRequest, 'tg_user_id'>>;

export type LeadFilters = {
  status_ids?: string[];
  campaign_ids?: string[];
  account_ids?: string[];
  search?: string;
  date_from?: string;
  date_to?: string;
};

// ==========================================
// Message API Types
// ==========================================

export type SendMessageRequest = {
  lead_id: string;
  account_id: string;
  type: Message['type'];
  content?: string;
  media_url?: string;
  reply_to_message_id?: string;
};

export type GetMessagesRequest = {
  lead_id: string;
  limit?: number;
  before_id?: string;
};

// ==========================================
// Template API Types
// ==========================================

export type CreateTemplateRequest = {
  name: string;
  content: string;
};

export type UpdateTemplateRequest = Partial<CreateTemplateRequest>;

// ==========================================
// Lead Status API Types
// ==========================================

export type CreateLeadStatusRequest = {
  name: string;
  color: string;
  order?: number;
  is_default?: boolean;
  is_final?: boolean;
};

export type UpdateLeadStatusRequest = Partial<CreateLeadStatusRequest>;
