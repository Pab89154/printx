async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const { headers: initHeaders, ...rest } = init ?? {}
  // Avoid forcing Content-Type on GETs — iOS Safari can mishandle empty JSON bodies.
  const method = (rest.method || 'GET').toUpperCase()
  const headers: Record<string, string> = { ...(initHeaders as Record<string, string>) }
  if (method !== 'GET' && method !== 'HEAD' && headers['Content-Type'] === undefined) {
    headers['Content-Type'] = 'application/json'
  }
  const res = await fetch(url, {
    credentials: 'include',
    ...rest,
    headers,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Request failed')
  return data as T
}

export const api = {
  customer: {
    me: () =>
      request<{ customer: { id: string; email: string; displayName: string | null } }>(
        '/api/public/auth/me',
      ),
    login: (email: string, password: string) =>
      request<{ customer: { id: string; email: string; displayName: string | null } }>(
        '/api/public/auth/login',
        { method: 'POST', body: JSON.stringify({ email, password }) },
      ),
    register: (name: string, email: string, password: string) =>
      request<{ customer: { id: string; email: string; displayName: string | null } }>(
        '/api/public/auth/register',
        { method: 'POST', body: JSON.stringify({ name, email, password }) },
      ),
    logout: () =>
      request<{ ok: true }>('/api/public/auth/logout', { method: 'POST', body: '{}' }),
    orders: () =>
      request<{ shopOrders: unknown[]; customOrders: unknown[] }>('/api/public/account/orders'),
    requestShopRefund: (orderId: string, reason: string) =>
      request<{ ok: true; id: string; status: string }>(
        `/api/public/account/orders/${orderId}/refund-request`,
        { method: 'POST', body: JSON.stringify({ reason }) },
      ),
    requestCustomRefund: (id: string, reason: string) =>
      request<{ ok: true; id: string; status: string }>(
        `/api/public/account/custom-orders/${id}/refund-request`,
        { method: 'POST', body: JSON.stringify({ reason }) },
      ),
  },
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
        return data as { ok: true; id: string; sliceStatus: string }
      }),
    customRequestStatus: (id: string) =>
      request<{
        id: string
        sliceStatus: string
        catalogPriceUsd: number | null
        error?: string
        status: string
      }>(`/api/public/custom-requests/${id}`),
    customRequestCheckout: (id: string) =>
      request<{ url: string; sessionId: string }>(`/api/public/custom-requests/${id}/checkout`, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    customRequestCancel: (id: string) =>
      request<{ ok: true }>(`/api/public/custom-requests/${id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
  },
  catalog: {
    public: () =>
      request<{
        designs: import('../types/catalog.ts').PublicCatalogDesign[]
        colors: import('../types/catalog.ts').CatalogColor[]
      }>('/api/public/catalog'),
    checkout: (body: {
      customerName?: string
      customerEmail?: string
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
        return fetch('/api/admin/designs/upload-model', {
          method: 'POST',
          body: formData,
          credentials: 'include',
        }).then(async (res) => {
          const data = await res.json()
          if (!res.ok) throw new Error(data.error ?? 'Model upload failed')
          return data as { stlPath: string; hasStl: boolean; modelExt: string }
        })
      },
      uploadModel: (file: File) => {
        const formData = new FormData()
        formData.append('file', file)
        return fetch('/api/admin/designs/upload-model', {
          method: 'POST',
          body: formData,
          credentials: 'include',
        }).then(async (res) => {
          const data = await res.json()
          if (!res.ok) throw new Error(data.error ?? 'Model upload failed')
          return data as { stlPath: string; hasStl: boolean; modelExt: string }
        })
      },
      stlUrl: (id: string) => `/api/admin/designs/${id}/stl`,
      remove: (id: string) => request(`/api/admin/designs/${id}`, { method: 'DELETE' }),
      submit: (id: string) =>
        request<import('../types/catalog.ts').Design & { sliceWarning?: string }>(
          `/api/admin/designs/${id}/submit`,
          {
            method: 'POST',
            body: '{}',
          },
        ),
      requote: (id: string) =>
        request<import('../types/catalog.ts').Design & { sliceWarning?: string }>(
          `/api/admin/designs/${id}/requote`,
          {
            method: 'POST',
            body: '{}',
          },
        ),
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
      refund: (orderId: string) =>
        request<import('../types/catalog.ts').OrderDto>(`/api/admin/orders/${orderId}/refund`, {
          method: 'POST',
          body: '{}',
        }),
      ship: (orderId: string, body: { trackingNumber: string; carrier?: string }) =>
        request<import('../types/catalog.ts').OrderDto>(`/api/admin/orders/${orderId}/ship`, {
          method: 'POST',
          body: JSON.stringify(body),
        }),
      refreshShipping: () =>
        request<{
          orders: import('../types/catalog.ts').OrderDto[]
          printers: import('../types/catalog.ts').PrinterDto[]
        }>('/api/admin/orders/refresh-shipping', {
          method: 'POST',
          body: '{}',
        }),
      delete: (orderId: string) =>
        request<{ ok: true; id: string }>(`/api/admin/orders/${orderId}`, { method: 'DELETE' }),
      listRefundRequests: () =>
        request<{
          requests: {
            id: string
            orderId: string | null
            customRequestId: string | null
            customerEmail: string
            customerName: string
            reason: string
            amountUsd: number
            createdAt: string
          }[]
        }>('/api/admin/refund-requests'),
      approveRefundRequest: (id: string, adminNote?: string) =>
        request<{ ok: true; status: string }>(`/api/admin/refund-requests/${id}/approve`, {
          method: 'POST',
          body: JSON.stringify({ adminNote }),
        }),
      declineRefundRequest: (id: string, adminNote?: string) =>
        request<{ ok: true; status: string }>(`/api/admin/refund-requests/${id}/decline`, {
          method: 'POST',
          body: JSON.stringify({ adminNote }),
        }),
      discounts: {
        list: () =>
          request<{
            discounts: {
              id: string
              code: string
              kind: string
              percentOff: number | null
              amountOffCents: number | null
              maxRedemptions: number | null
              active: boolean
              createdAt: string
            }[]
          }>('/api/admin/discounts'),
        create: (body: {
          code: string
          kind: 'percent' | 'amount'
          percentOff?: number
          amountOffCents?: number
          maxRedemptions?: number | null
        }) =>
          request<{ discount: { id: string; code: string } }>('/api/admin/discounts', {
            method: 'POST',
            body: JSON.stringify(body),
          }),
        deactivate: (id: string) =>
          request<{ ok: true }>(`/api/admin/discounts/${id}/deactivate`, {
            method: 'POST',
            body: '{}',
          }),
      },
      shipCustom: (id: string, body: { trackingNumber: string; carrier?: string }) =>
        request<{ ok: true }>(`/api/admin/custom-requests/${id}/ship`, {
          method: 'POST',
          body: JSON.stringify(body),
        }),
      downloadGcode: async (itemId: string) => {
        const res = await fetch(`/api/admin/order-items/${encodeURIComponent(itemId)}/gcode`, {
          credentials: 'include',
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error((data as { error?: string }).error ?? 'G-code download failed')
        }
        const blob = await res.blob()
        const disposition = res.headers.get('content-disposition') || ''
        const match = /filename="?([^"]+)"?/i.exec(disposition)
        const filename = match?.[1] || `printx-${itemId.slice(0, 8)}.gcode`
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        a.click()
        URL.revokeObjectURL(url)
      },
    },
    money: {
      get: (month?: string) => {
        const q = month && /^\d{4}-\d{2}$/.test(month) ? `?month=${encodeURIComponent(month)}` : ''
        return request<import('../types/catalog.ts').MoneySummaryDto>(`/api/admin/money${q}`)
      },
      settle: (body: { userId: string; yearMonth: string; note?: string }) =>
        request<{
          ok: true
          id: string
          userId: string
          yearMonth: string
          amountUsd: number
          markedPaidAt: string
          note: string
        }>('/api/admin/money/settle', {
          method: 'POST',
          body: JSON.stringify(body),
        }),
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
      delete: (id: string) => request(`/api/admin/custom-requests/${id}`, { method: 'DELETE' }),
      downloadGcode: async (id: string) => {
        const res = await fetch(`/api/admin/custom-requests/${id}/gcode`, { credentials: 'include' })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error((data as { error?: string }).error ?? 'G-code download failed')
        }
        const blob = await res.blob()
        const disposition = res.headers.get('content-disposition') || ''
        const match = /filename="?([^"]+)"?/i.exec(disposition)
        const filename = match?.[1] || `printx-custom-${id.slice(0, 8)}.gcode`
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        a.click()
        URL.revokeObjectURL(url)
      },
    },
    push: {
      vapidPublicKey: () =>
        request<{ publicKey: string; configured: boolean }>('/api/admin/push/vapid-public-key'),
      subscribe: (body: {
        endpoint: string
        keys: { p256dh: string; auth: string }
        userAgent?: string
      }) =>
        request<{ ok: true }>('/api/admin/push/subscribe', {
          method: 'POST',
          body: JSON.stringify(body),
        }),
      unsubscribe: (endpoint: string) =>
        request<{ ok: true }>('/api/admin/push/subscribe', {
          method: 'DELETE',
          body: JSON.stringify({ endpoint }),
        }),
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
          filledMissingQuotes?: number
          fillWarnings?: string[]
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
