async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Request failed')
  return data as T
}

export const api = {
  public: {
    bootstrap: (opts?: { full?: boolean }) =>
      request<import('../types/api.ts').PublicBootstrap>(
        opts?.full ? '/api/public/bootstrap?full=1' : '/api/public/bootstrap',
      ),
    contact: (body: { name: string; email: string; inquiryType: string; message: string }) =>
      request('/api/public/contact', { method: 'POST', body: JSON.stringify(body) }),
    customRequest: (formData: FormData) =>
      fetch('/api/public/custom-requests', { method: 'POST', body: formData, credentials: 'include' }).then(async (res) => {
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Request failed')
        return data
      }),
  },
  admin: {
    me: () =>
      request<{
        ok: boolean
        role: string
        email: string
        displayName: string | null
        isMainAdmin: boolean
        permissions: import('../types/api.ts').AdminPermissions
      }>('/api/admin/me'),
    login: (email: string, password: string) =>
      request<{
        ok: boolean
        role: string
        email: string
        displayName: string | null
        isMainAdmin: boolean
        permissions: import('../types/api.ts').AdminPermissions
      }>('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),
    logout: () => request('/api/admin/logout', { method: 'POST' }),
    stats: () => request<import('../types/api.ts').DashboardStats>('/api/admin/stats'),
    stands: {
      list: () => request<import('../types/api.ts').Stand[]>('/api/admin/stands'),
      create: (body: Record<string, unknown>) =>
        request('/api/admin/stands', { method: 'POST', body: JSON.stringify(body) }),
      update: (id: string, body: Record<string, unknown>) =>
        request(`/api/admin/stands/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
      delete: (id: string) => request(`/api/admin/stands/${id}`, { method: 'DELETE' }),
    },
    products: {
      list: () => request<import('../types/api.ts').Product[]>('/api/admin/products'),
      create: (body: Record<string, unknown>) =>
        request('/api/admin/products', { method: 'POST', body: JSON.stringify(body) }),
      update: (id: string, body: Record<string, unknown>) =>
        request(`/api/admin/products/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
      delete: (id: string) => request(`/api/admin/products/${id}`, { method: 'DELETE' }),
    },
    requests: {
      list: () => request<import('../types/api.ts').CustomRequest[]>('/api/admin/custom-requests'),
      updateStatus: (id: string, status: string) =>
        request(`/api/admin/custom-requests/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    },
    messages: {
      list: () => request<import('../types/api.ts').ContactMessage[]>('/api/admin/contact-messages'),
      updateStatus: (id: string, status: 'new' | 'read') =>
        request(`/api/admin/contact-messages/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
      delete: (id: string) => request(`/api/admin/contact-messages/${id}`, { method: 'DELETE' }),
    },
    schools: {
      list: () => request<import('../types/api.ts').School[]>('/api/admin/schools'),
      create: (body: Record<string, unknown>) =>
        request('/api/admin/schools', { method: 'POST', body: JSON.stringify(body) }),
      update: (id: string, body: Record<string, unknown>) =>
        request(`/api/admin/schools/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
      delete: (id: string) => request(`/api/admin/schools/${id}`, { method: 'DELETE' }),
    },
    content: {
      get: () => request<import('../types/api.ts').WebsiteContent>('/api/admin/content'),
      update: (body: Partial<import('../types/api.ts').WebsiteContent>) =>
        request('/api/admin/content', { method: 'PATCH', body: JSON.stringify(body) }),
    },
    settings: {
      changePassword: (currentPassword: string, newPassword: string) =>
        request('/api/admin/settings/password', {
          method: 'PATCH',
          body: JSON.stringify({ currentPassword, newPassword }),
        }),
      updateProfile: (displayName: string) =>
        request<{ ok: boolean; displayName: string | null }>('/api/admin/settings/profile', {
          method: 'PATCH',
          body: JSON.stringify({ displayName }),
        }),
    },
    users: {
      list: () => request<import('../types/api.ts').AdminUser[]>('/api/admin/users'),
      create: (
        email: string,
        password: string,
        permissions?: Partial<import('../types/api.ts').AdminPermissions>,
        displayName?: string,
      ) =>
        request<import('../types/api.ts').AdminUser>('/api/admin/users', {
          method: 'POST',
          body: JSON.stringify({ email, password, permissions, displayName }),
        }),
      updatePermissions: (
        id: string,
        permissions: Partial<import('../types/api.ts').AdminPermissions>,
      ) =>
        request<import('../types/api.ts').AdminUser>(`/api/admin/users/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ permissions }),
        }),
      delete: (id: string) => request(`/api/admin/users/${id}`, { method: 'DELETE' }),
    },
  },
}
