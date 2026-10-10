async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const { headers: initHeaders, ...rest } = init ?? {}
  const res = await fetch(url, {
    credentials: 'include',
    ...rest,
    headers: { 'Content-Type': 'application/json', ...initHeaders },
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
  catalog: {
    public: () =>
      request<{
        designs: import('../types/catalog.ts').PublicCatalogDesign[]
        colors: import('../types/catalog.ts').CatalogColor[]
      }>('/api/public/catalog'),
    checkout: (body: {
      customerName: string
      customerEmail: string
      items: { designId: string; colorId: string; qty: number }[]
    }) =>
      request<{ url: string; orderId: string; sessionId: string }>('/api/public/checkout', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    designs: {
      list: () => request<import('../types/catalog.ts').Design[]>('/api/admin/designs'),
      get: (id: string) =>
        request<{ design: import('../types/catalog.ts').Design; preview: unknown }>(
          `/api/admin/designs/${id}`,
        ),
      create: (body: Record<string, unknown>) =>
        request<import('../types/catalog.ts').Design>('/api/admin/designs', {
          method: 'POST',
          body: JSON.stringify(body),
        }),
      update: (id: string, body: Record<string, unknown>) =>
        request<import('../types/catalog.ts').Design>(`/api/admin/designs/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        }),
      uploadStl: (file: File) => {
        const formData = new FormData()
        formData.append('file', file)
        return fetch('/api/admin/designs/upload-stl', {
          method: 'POST',
          body: formData,
          credentials: 'include',
        }).then(async (res) => {
          const data = await res.json()
          if (!res.ok) throw new Error(data.error ?? 'STL upload failed')
          return data as { stlPath: string; hasStl: boolean }
        })
      },
      stlUrl: (id: string) => `/api/admin/designs/${id}/stl`,
      remove: (id: string) => request(`/api/admin/designs/${id}`, { method: 'DELETE' }),
      submit: (id: string) =>
        request<import('../types/catalog.ts').Design>(`/api/admin/designs/${id}/submit`, {
          method: 'POST',
          body: '{}',
        }),
      approve: (id: string) =>
        request<{ design: import('../types/catalog.ts').Design; pricing: unknown }>(
          `/api/admin/designs/${id}/approve`,
          { method: 'POST', body: '{}' },
        ),
      reprice: (id: string) =>
        request<{ design: import('../types/catalog.ts').Design; pricing: unknown }>(
          `/api/admin/designs/${id}/reprice`,
          { method: 'POST', body: '{}' },
        ),
      reject: (id: string, note?: string) =>
        request<import('../types/catalog.ts').Design>(`/api/admin/designs/${id}/reject`, {
          method: 'POST',
          body: JSON.stringify({ note }),
        }),
    },
    pricing: {
      get: () =>
        request<{
          settings: import('../types/catalog.ts').PricingSettingsDto
          printers: import('../types/catalog.ts').PrinterDto[]
          customColors: import('../types/catalog.ts').PricingSettingsDto['customColors']
        }>('/api/admin/pricing'),
      update: (body: Record<string, unknown>) =>
        request<{
          settings: import('../types/catalog.ts').PricingSettingsDto
          printers: import('../types/catalog.ts').PrinterDto[]
          customColors: import('../types/catalog.ts').PricingSettingsDto['customColors']
        }>('/api/admin/pricing', { method: 'PATCH', body: JSON.stringify(body) }),
    },
    orders: {
      list: () =>
        request<{
          orders: import('../types/catalog.ts').OrderDto[]
          printers: import('../types/catalog.ts').PrinterDto[]
        }>('/api/admin/orders'),
      claim: (itemId: string, printerId: string) =>
        request<import('../types/catalog.ts').OrderItemDto>(
          `/api/admin/order-items/${itemId}/claim`,
          { method: 'POST', body: JSON.stringify({ printerId }) },
        ),
      complete: (itemId: string) =>
        request<import('../types/catalog.ts').OrderItemDto>(
          `/api/admin/order-items/${itemId}/complete`,
          { method: 'POST', body: '{}' },
        ),
    },
    stats: () =>
      request<{ pendingApprovals: number; unclaimedItems: number }>('/api/admin/catalog-stats'),
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
      uploadImage: (file: File) => {
        const formData = new FormData()
        formData.append('file', file)
        return fetch('/api/admin/products/upload-image', {
          method: 'POST',
          body: formData,
          credentials: 'include',
        }).then(async (res) => {
          const data = await res.json()
          if (!res.ok) throw new Error(data.error ?? 'Upload failed')
          return data as { url: string }
        })
      },
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
    mail: {
      recipients: () => request<import('../types/api.ts').MailRecipientOption[]>('/api/admin/mail/recipients'),
      unreadCount: () =>
        request<{
          count: number
          latestId: string | null
          latestSubject: string | null
          latestFrom: string | null
        }>('/api/admin/mail/unread-count'),
      inbox: () => request<import('../types/api.ts').MailMessage[]>('/api/admin/mail/inbox'),
      archived: () => request<import('../types/api.ts').MailMessage[]>('/api/admin/mail/archived'),
      sent: () => request<import('../types/api.ts').MailMessage[]>('/api/admin/mail/sent'),
      getSignature: () => request<{ signature: string }>('/api/admin/mail/signature'),
      updateSignature: (signature: string) =>
        request<{ signature: string }>('/api/admin/mail/signature', {
          method: 'PATCH',
          body: JSON.stringify({ signature }),
        }),
      send: (body: { subject: string; body: string; recipientIds: string[]; scheduledAt?: string }) =>
        request<import('../types/api.ts').MailMessage>('/api/admin/mail', {
          method: 'POST',
          body: JSON.stringify(body),
        }),
      markRead: (id: string) =>
        request<import('../types/api.ts').MailMessage>(`/api/admin/mail/${id}/read`, { method: 'PATCH' }),
      markUnread: (id: string) =>
        request<import('../types/api.ts').MailMessage>(`/api/admin/mail/${id}/unread`, { method: 'PATCH' }),
      archive: (id: string) =>
        request<import('../types/api.ts').MailMessage>(`/api/admin/mail/${id}/archive`, { method: 'PATCH' }),
      unarchive: (id: string) =>
        request<import('../types/api.ts').MailMessage>(`/api/admin/mail/${id}/unarchive`, { method: 'PATCH' }),
      trash: () => request<import('../types/api.ts').MailMessage[]>('/api/admin/mail/trash'),
      scheduled: () => request<import('../types/api.ts').MailMessage[]>('/api/admin/mail/scheduled'),
      restore: (id: string) =>
        request<import('../types/api.ts').MailMessage>(`/api/admin/mail/${id}/restore`, { method: 'PATCH' }),
      cancelSchedule: (id: string) =>
        request<{ ok: boolean }>(`/api/admin/mail/${id}/cancel-schedule`, { method: 'PATCH' }),
      sendNow: (id: string) =>
        request<import('../types/api.ts').MailMessage>(`/api/admin/mail/${id}/send-now`, { method: 'PATCH' }),
      delete: (id: string, opts?: { mailbox?: 'inbox' | 'archived' | 'sent' | 'trash'; forever?: boolean }) => {
        const params = new URLSearchParams()
        if (opts?.forever || opts?.mailbox === 'trash') params.set('forever', '1')
        if (opts?.mailbox) params.set('mailbox', opts.mailbox)
        const qs = params.toString()
        return request(`/api/admin/mail/${id}${qs ? `?${qs}` : ''}`, { method: 'DELETE' })
      },
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
        request<import('../types/api.ts').WebsiteContent>('/api/admin/content', {
          method: 'PATCH',
          body: JSON.stringify(body),
        }),
    },
    settings: {
      changePassword: (currentPassword: string, newPassword: string) =>
        request('/api/admin/settings/password', {
          method: 'PATCH',
          body: JSON.stringify({ currentPassword, newPassword }),
        }),
      changeEmail: (email: string, currentPassword: string) =>
        request<{ ok: boolean; email: string }>('/api/admin/settings/email', {
          method: 'PATCH',
          body: JSON.stringify({ email, currentPassword }),
        }),
      updateProfile: (displayName: string) =>
        request<{ ok: boolean; displayName: string | null }>('/api/admin/settings/profile', {
          method: 'PATCH',
          body: JSON.stringify({ displayName }),
        }),
      getCloudSlicer: () =>
        request<{
          tokenMasked: string | null
          hasToken: boolean
          printerId: string
          filamentId: string
          configuredAt: string | null
          ownedPrinterId: string | null
          printers: { id: string; ownerLabel: string; modelName: string; ownerUserId: string | null }[]
        }>('/api/admin/settings/cloud-slicer'),
      updateCloudSlicer: (body: {
        token?: string
        clearToken?: boolean
        printerId?: string
        filamentId?: string
        ownedPrinterId?: string
      }) =>
        request<{
          ok: boolean
          tokenMasked: string | null
          hasToken: boolean
          printerId: string
          filamentId: string
          configuredAt: string | null
          ownedPrinterId: string | null
        }>('/api/admin/settings/cloud-slicer', {
          method: 'PATCH',
          body: JSON.stringify(body),
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
      setPassword: (id: string, password: string) =>
        request<{ ok: boolean }>(`/api/admin/users/${id}/password`, {
          method: 'PATCH',
          body: JSON.stringify({ password }),
        }),
      setEmail: (id: string, email: string) =>
        request<{ ok: boolean; email: string }>(`/api/admin/users/${id}/email`, {
          method: 'PATCH',
          body: JSON.stringify({ email }),
        }),
      delete: (id: string) => request(`/api/admin/users/${id}`, { method: 'DELETE' }),
    },
  },
}
