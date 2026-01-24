const API_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
};

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, headers = {} } = options;

  const fetchHeaders: Record<string, string> = { ...headers };

  // Only set Content-Type for requests with a body
  if (body !== undefined) {
    fetchHeaders['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${API_URL}${endpoint}`, {
    method,
    headers: fetchHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const data = await res.json();

  if (!data.success) {
    throw new ApiError(
      data.error?.code || 'UNKNOWN_ERROR',
      data.error?.message || 'An error occurred',
      data.error?.details
    );
  }

  return data.data;
}

// Accounts API
export const accountsApi = {
  list: () => request<unknown[]>('/api/accounts'),
  get: (id: string) => request<unknown>(`/api/accounts/${id}`),
  create: (data: unknown) => request<unknown>('/api/accounts', { method: 'POST', body: data }),
  update: (id: string, data: unknown) => request<unknown>(`/api/accounts/${id}`, { method: 'PATCH', body: data }),
  delete: (id: string) => request<null>(`/api/accounts/${id}`, { method: 'DELETE' }),
  startAuth: (id: string) => request<{ phoneCodeHash: string }>(`/api/accounts/${id}/auth/start`, { method: 'POST' }),
  completeAuth: (id: string, data: { code: string; phone_code_hash: string; password?: string }) =>
    request<{ authenticated: boolean }>(`/api/accounts/${id}/auth/complete`, { method: 'POST', body: data }),
  reconnect: (id: string) => request<{ connected: boolean }>(`/api/accounts/${id}/reconnect`, { method: 'POST' }),
  health: () => request<{ accounts: unknown[] }>('/api/accounts/health/all'),
};

// Campaigns API
export const campaignsApi = {
  list: (status?: string) => request<unknown[]>(`/api/campaigns${status ? `?status=${status}` : ''}`),
  get: (id: string) => request<unknown>(`/api/campaigns/${id}`),
  create: (data: unknown) => request<unknown>('/api/campaigns', { method: 'POST', body: data }),
  update: (id: string, data: unknown) => request<unknown>(`/api/campaigns/${id}`, { method: 'PATCH', body: data }),
  delete: (id: string) => request<null>(`/api/campaigns/${id}`, { method: 'DELETE' }),
  start: (id: string) => request<unknown>(`/api/campaigns/${id}/start`, { method: 'POST' }),
  pause: (id: string) => request<unknown>(`/api/campaigns/${id}/pause`, { method: 'POST' }),
  addGroups: (id: string, groupIds: string[]) =>
    request<{ added: number }>(`/api/campaigns/${id}/groups`, { method: 'POST', body: { group_ids: groupIds } }),
  getGroups: (id: string) => request<unknown[]>(`/api/campaigns/${id}/groups`),
};

// Sequences API
export const sequencesApi = {
  list: (status?: string) => request<unknown[]>(`/api/sequences${status ? `?status=${status}` : ''}`),
  get: (id: string) => request<unknown>(`/api/sequences/${id}`),
  create: (data: unknown) => request<unknown>('/api/sequences', { method: 'POST', body: data }),
  update: (id: string, data: unknown) => request<unknown>(`/api/sequences/${id}`, { method: 'PATCH', body: data }),
  delete: (id: string) => request<null>(`/api/sequences/${id}`, { method: 'DELETE' }),
  pause: (id: string) => request<unknown>(`/api/sequences/${id}/pause`, { method: 'POST' }),
  activate: (id: string) => request<unknown>(`/api/sequences/${id}/activate`, { method: 'POST' }),
  getEnrollments: (id: string) => request<unknown[]>(`/api/sequences/${id}/enrollments`),
};

// Leads API
export const leadsApi = {
  list: (params?: Record<string, string>) => {
    const query = params ? `?${new URLSearchParams(params)}` : '';
    return request<{ items: unknown[]; total: number; page: number; pageSize: number; totalPages: number }>(
      `/api/leads${query}`
    );
  },
  get: (id: string) => request<unknown>(`/api/leads/${id}`),
  create: (data: unknown) => request<unknown>('/api/leads', { method: 'POST', body: data }),
  update: (id: string, data: unknown) => request<unknown>(`/api/leads/${id}`, { method: 'PATCH', body: data }),
  updateStatus: (id: string, statusId: string) =>
    request<unknown>(`/api/leads/${id}/status`, { method: 'PATCH', body: { status_id: statusId } }),
  delete: (id: string) => request<null>(`/api/leads/${id}`, { method: 'DELETE' }),
  stats: () => request<{ total: number; new_today: number; unresponded: number; by_status: unknown[] }>('/api/leads/stats/overview'),
};

// Messages API
export const messagesApi = {
  getForLead: (leadId: string, params?: { limit?: number; before_id?: string }) => {
    const query = params ? `?${new URLSearchParams(params as Record<string, string>)}` : '';
    return request<unknown[]>(`/api/messages/lead/${leadId}${query}`);
  },
  send: (data: unknown) => request<unknown>('/api/messages/send', { method: 'POST', body: data }),
  markRead: (id: string) => request<unknown>(`/api/messages/${id}/read`, { method: 'POST' }),
  markAllRead: (leadId: string) => request<null>(`/api/messages/lead/${leadId}/read-all`, { method: 'POST' }),
  sendTyping: (leadId: string) => request<null>(`/api/messages/lead/${leadId}/typing`, { method: 'POST' }),
  unreadCount: () => request<{ unread: number }>('/api/messages/unread/count'),
};

// Groups API
export const groupsApi = {
  list: (params?: Record<string, string>) => {
    const query = params ? `?${new URLSearchParams(params)}` : '';
    return request<{ items: unknown[]; total: number; page: number; pageSize: number; totalPages: number }>(
      `/api/groups${query}`
    );
  },
  get: (id: string) => request<unknown>(`/api/groups/${id}`),
  import: (groups: unknown[]) => request<{ imported: number; groups: unknown[] }>('/api/groups/import', { method: 'POST', body: { groups } }),
  update: (id: string, data: unknown) => request<unknown>(`/api/groups/${id}`, { method: 'PATCH', body: data }),
  delete: (id: string) => request<null>(`/api/groups/${id}`, { method: 'DELETE' }),
  bulkDelete: (ids: string[]) => request<{ deleted: number }>('/api/groups/bulk-delete', { method: 'POST', body: { ids } }),
  bulkUpdate: (ids: string[], data: Record<string, unknown>) =>
    request<{ updated: number }>('/api/groups/bulk-update', { method: 'POST', body: { ids, ...data } }),
  categories: () => request<string[]>('/api/groups/meta/categories'),
};

// Templates API
export const templatesApi = {
  list: () => request<unknown[]>('/api/templates'),
  get: (id: string) => request<unknown>(`/api/templates/${id}`),
  create: (data: unknown) => request<unknown>('/api/templates', { method: 'POST', body: data }),
  update: (id: string, data: unknown) => request<unknown>(`/api/templates/${id}`, { method: 'PATCH', body: data }),
  delete: (id: string) => request<null>(`/api/templates/${id}`, { method: 'DELETE' }),
  preview: (id: string, variables: Record<string, string>) =>
    request<{ preview: string }>(`/api/templates/${id}/preview`, { method: 'POST', body: { variables } }),
};

// Statuses API
export const statusesApi = {
  list: () => request<unknown[]>('/api/statuses'),
  get: (id: string) => request<unknown>(`/api/statuses/${id}`),
  create: (data: unknown) => request<unknown>('/api/statuses', { method: 'POST', body: data }),
  update: (id: string, data: unknown) => request<unknown>(`/api/statuses/${id}`, { method: 'PATCH', body: data }),
  delete: (id: string) => request<null>(`/api/statuses/${id}`, { method: 'DELETE' }),
  reorder: (order: string[]) => request<null>('/api/statuses/reorder', { method: 'POST', body: { order } }),
};

// Uploads API
export type UploadResult = {
  id: string;
  filename: string;
  originalName: string;
  mimetype: string;
  type: 'photo' | 'video' | 'voice' | 'video_note' | 'document';
  path: string;
  url: string;
};

export const uploadsApi = {
  uploadMedia: async (file: File | Blob, isVideoNote = false): Promise<UploadResult> => {
    const formData = new FormData();
    formData.append('file', file);
    if (isVideoNote) {
      formData.append('video_note', 'true');
    }

    const res = await fetch(`${API_URL}/api/uploads/media`, {
      method: 'POST',
      body: formData,
    });

    const data = await res.json();

    if (!data.success) {
      throw new ApiError(
        data.error?.code || 'UPLOAD_ERROR',
        data.error?.message || 'Upload failed'
      );
    }

    return data.data;
  },

  getMediaUrl: (path: string) => `${API_URL}${path}`,
};
