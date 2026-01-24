-- ==========================================
-- Enable Extensions
-- ==========================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==========================================
-- TG Accounts Table
-- ==========================================
CREATE TABLE public.tg_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone VARCHAR(20) NOT NULL UNIQUE,
  username VARCHAR(255),
  first_name VARCHAR(255),
  last_name VARCHAR(255),
  status VARCHAR(20) NOT NULL DEFAULT 'auth_required'
    CHECK (status IN ('active', 'inactive', 'banned', 'auth_required')),
  session_string TEXT,
  proxy_config JSONB,
  daily_message_limit INTEGER NOT NULL DEFAULT 50,
  messages_sent_today INTEGER NOT NULL DEFAULT 0,
  last_active_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tg_accounts_status ON public.tg_accounts(status);
CREATE INDEX idx_tg_accounts_phone ON public.tg_accounts(phone);

-- ==========================================
-- Lead Statuses Table
-- ==========================================
CREATE TABLE public.lead_statuses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  color VARCHAR(7) NOT NULL DEFAULT '#6B7280',
  "order" INTEGER NOT NULL DEFAULT 0,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_final BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert default statuses
INSERT INTO public.lead_statuses (name, color, "order", is_default) VALUES
  ('New', '#3B82F6', 0, TRUE),
  ('Contacted', '#F59E0B', 1, FALSE),
  ('Interested', '#10B981', 2, FALSE),
  ('Qualified', '#8B5CF6', 3, FALSE),
  ('Closed', '#6B7280', 4, FALSE);

-- ==========================================
-- Message Templates Table
-- ==========================================
CREATE TABLE public.message_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  variables TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==========================================
-- TG Groups Table
-- ==========================================
CREATE TABLE public.tg_groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tg_id VARCHAR(50) NOT NULL UNIQUE,
  username VARCHAR(255),
  title VARCHAR(500) NOT NULL,
  description TEXT,
  member_count INTEGER,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  is_restricted BOOLEAN NOT NULL DEFAULT FALSE,
  category VARCHAR(100),
  tags TEXT[] NOT NULL DEFAULT '{}',
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tg_groups_tg_id ON public.tg_groups(tg_id);
CREATE INDEX idx_tg_groups_category ON public.tg_groups(category);
CREATE INDEX idx_tg_groups_tags ON public.tg_groups USING GIN(tags);

-- ==========================================
-- Campaigns Table
-- ==========================================
CREATE TABLE public.campaigns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'paused', 'completed', 'archived')),
  message_template_id UUID REFERENCES public.message_templates(id) ON DELETE SET NULL,
  schedule_config JSONB NOT NULL DEFAULT '{
    "type": "immediate",
    "timezone": "UTC",
    "min_delay_seconds": 60,
    "max_delay_seconds": 180
  }',
  group_filter JSONB,
  assigned_accounts UUID[] NOT NULL DEFAULT '{}',
  stats JSONB NOT NULL DEFAULT '{
    "total_groups": 0,
    "messages_sent": 0,
    "messages_failed": 0,
    "responses_received": 0
  }',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_campaigns_status ON public.campaigns(status);

-- ==========================================
-- Campaign Groups Junction Table
-- ==========================================
CREATE TABLE public.campaign_groups (
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES public.tg_groups(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  sent_at TIMESTAMPTZ,
  error_message TEXT,
  PRIMARY KEY (campaign_id, group_id)
);

CREATE INDEX idx_campaign_groups_status ON public.campaign_groups(status);

-- ==========================================
-- Sequences Table
-- ==========================================
CREATE TABLE public.sequences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'archived')),
  trigger JSONB NOT NULL,
  steps JSONB[] NOT NULL DEFAULT '{}',
  assigned_accounts UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sequences_status ON public.sequences(status);

-- ==========================================
-- Leads Table
-- ==========================================
CREATE TABLE public.leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tg_user_id VARCHAR(50) NOT NULL UNIQUE,
  username VARCHAR(255),
  first_name VARCHAR(255),
  last_name VARCHAR(255),
  phone VARCHAR(20),
  status_id UUID NOT NULL REFERENCES public.lead_statuses(id) ON DELETE RESTRICT,
  source_campaign_id UUID REFERENCES public.campaigns(id) ON DELETE SET NULL,
  source_group_id UUID REFERENCES public.tg_groups(id) ON DELETE SET NULL,
  source_message_id VARCHAR(50),
  assigned_account_id UUID REFERENCES public.tg_accounts(id) ON DELETE SET NULL,
  notes TEXT,
  custom_fields JSONB NOT NULL DEFAULT '{}',
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_leads_tg_user_id ON public.leads(tg_user_id);
CREATE INDEX idx_leads_status_id ON public.leads(status_id);
CREATE INDEX idx_leads_source_campaign ON public.leads(source_campaign_id);
CREATE INDEX idx_leads_assigned_account ON public.leads(assigned_account_id);
CREATE INDEX idx_leads_last_message ON public.leads(last_message_at DESC);

-- ==========================================
-- Messages Table
-- ==========================================
CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.tg_accounts(id) ON DELETE CASCADE,
  tg_message_id VARCHAR(50),
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  type VARCHAR(20) NOT NULL
    CHECK (type IN ('text', 'video', 'video_note', 'voice', 'photo', 'document', 'sticker')),
  content TEXT,
  media_url TEXT,
  media_metadata JSONB,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'failed')),
  sequence_id UUID REFERENCES public.sequences(id) ON DELETE SET NULL,
  sequence_step_id VARCHAR(50),
  replied_to_message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_messages_lead_id ON public.messages(lead_id);
CREATE INDEX idx_messages_account_id ON public.messages(account_id);
CREATE INDEX idx_messages_created_at ON public.messages(created_at DESC);
CREATE INDEX idx_messages_tg_message_id ON public.messages(tg_message_id);

-- ==========================================
-- Sequence Enrollments Table
-- ==========================================
CREATE TABLE public.sequence_enrollments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sequence_id UUID NOT NULL REFERENCES public.sequences(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  current_step INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'cancelled', 'paused')),
  next_step_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE(sequence_id, lead_id)
);

CREATE INDEX idx_sequence_enrollments_status ON public.sequence_enrollments(status);
CREATE INDEX idx_sequence_enrollments_next_step ON public.sequence_enrollments(next_step_at);

-- ==========================================
-- Updated At Trigger Function
-- ==========================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply triggers
CREATE TRIGGER update_tg_accounts_updated_at
  BEFORE UPDATE ON public.tg_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_message_templates_updated_at
  BEFORE UPDATE ON public.message_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tg_groups_updated_at
  BEFORE UPDATE ON public.tg_groups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_campaigns_updated_at
  BEFORE UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sequences_updated_at
  BEFORE UPDATE ON public.sequences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_leads_updated_at
  BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ==========================================
-- Enable Row Level Security
-- ==========================================
ALTER TABLE public.tg_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_statuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tg_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sequence_enrollments ENABLE ROW LEVEL SECURITY;

-- Service role bypass (for backend)
CREATE POLICY "Service role full access" ON public.tg_accounts
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON public.lead_statuses
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON public.message_templates
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON public.tg_groups
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON public.campaigns
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON public.campaign_groups
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON public.sequences
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON public.leads
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON public.messages
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON public.sequence_enrollments
  FOR ALL USING (auth.role() = 'service_role');
