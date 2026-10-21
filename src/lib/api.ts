async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const { headers: initHeaders, ...rest } = init ?? {}
  // Avoid forcing Content-Type on GETs — iOS Safari can mishandle empty JSON bodies.
  const method = (rest.method || 'GET').toUpperCase()
  const headers: Record<string, string> = { ...(initHeaders as Record<string, string>) }
  if (method !== 'GET' && method !== 'HEAD' && headers['Content-Type'] === undefined) {
    headers['Content-Type'] = 'application/json'
  }
  const doFetch = () =>
    fetch(url, {
      credentials: 'include',
      ...rest,
      headers,
    })
  let res: Response
  try {
    res = await doFetch()
  } catch (err) {
    // One quiet retry for reads — a stalled database connection on one
    // server instance usually succeeds instantly on a fresh one.
    if (method !== 'GET' && method !== 'HEAD') throw err
    await new Promise((r) => setTimeout(r, 700))
    res = await doFetch()
  }
  if (!res.ok && (method === 'GET' || method === 'HEAD') && res.status >= 500) {
    await new Promise((r) => setTimeout(r, 700))
    res = await doFetch()
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Request failed')
  return data as T
}

function isAppleTouchBrowser() {
  if (typeof navigator === 'undefined') return false
  return (
    /iPad|iPhone|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

function filenameFromDisposition(disposition: string, fallback: string) {
  const utf = /filename\*=(?:UTF-8''|utf-8'')([^;]+)/i.exec(disposition)
  if (utf?.[1]) {
    try {
      return decodeURIComponent(utf[1].trim().replace(/^"+|"+$/g, ''))
    } catch {
      /* fall through */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(disposition)
  return plain?.[1]?.trim() || fallback
}

function triggerBlobSave(objectUrl: string, filename: string) {
  const a = document.createElement('a')
  a.href = objectUrl
  a.download = filename
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/** Authenticated file download that survives Safari/iOS (delayed revoke; no blank-tab freeze). */
async function downloadAuthFile(url: string, fallbackFilename: string, errorLabel: string) {
  const controller = new AbortController()
  // File should already be prepared; keep this short so the UI cannot hang forever.
  const timeoutId = window.setTimeout(() => controller.abort(), 90_000)
  try {
    const res = await fetch(url, { credentials: 'same-origin', signal: controller.signal })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error((data as { error?: string }).error ?? errorLabel)
    }
    const contentType = (res.headers.get('content-type') || '').toLowerCase()
    if (contentType.includes('application/json')) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(data.error ?? errorLabel)
    }
    const blob = await res.blob()
    if (!blob.size) throw new Error(errorLabel)
    const filename = filenameFromDisposition(
      res.headers.get('content-disposition') || '',
      fallbackFilename,
    )
    const objectUrl = URL.createObjectURL(blob)
    triggerBlobSave(objectUrl, filename)
    // iOS often ignores <a download> after an async fetch; open the blob as a fallback.
    if (isAppleTouchBrowser()) {
      const opened = window.open(objectUrl, '_blank')
      if (!opened) window.location.assign(objectUrl)
    }
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Download timed out. Try again — first slice can take a couple of minutes.')
    }
    throw err
  } finally {
    window.clearTimeout(timeoutId)
  }
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
    updateProfile: (name: string) =>
      request<{ customer: { id: string; email: string; displayName: string | null } }>(
        '/api/public/account/profile',
        { method: 'PATCH', body: JSON.stringify({ name }) },
      ),
    updatePassword: (currentPassword: string, newPassword: string) =>
      request<{ ok: true }>('/api/public/account/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      }),
    discounts: () =>
      request<{
        discounts: {
          code: string
          kind: string
          percentOff: number | null
          amountOffCents: number | null
          maxRedemptions: number | null
        }[]
      }>('/api/public/account/discounts'),
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
    schoolPickupCode: (code: string) =>
      request<{ schoolPickup: boolean; code?: string; error?: string }>(
        `/api/public/school-pickup-code?code=${encodeURIComponent(code)}`,
      ),
    cashCheckout: (body: {
      code: string
      promoCode?: string
      customerName: string
      agreeToPay: boolean
      agreeToTerms: boolean
      items: {
        designId: string
        colorId: string
        qty: number
        filamentColorIds?: string[]
      }[]
    }) =>
      request<{
        orderId: string
        totalUsd: number
        subtotalUsd?: number
        discountUsd?: number
        promoCode?: string
        code: string
      }>('/api/public/cash-checkout', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    checkout: (body: {
      customerName?: string
      customerEmail?: string
      promoCode?: string
      items: {
        designId: string
        colorId: string
        qty: number
        filamentColorIds?: string[]
      }[]
    }) =>
      request<{ url: string; orderId: string; sessionId: string }>('/api/public/checkout', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    orderSuccess: (sessionId: string) =>
      request<{
        orderId: string
        status: string
        statusLabel: string
        totalUsd: number
        shippingMethod: string
        trackCode: string | null
        trackCodeAlreadyShown: boolean
        items: {
          designName: string
          colorName: string
          qty: number
          printStatus: string
          printStatusLabel: string
        }[]
      }>(`/api/public/order-success?session_id=${encodeURIComponent(sessionId)}`),
    trackOrder: (code: string) =>
      request<{
        status: string
        statusLabel: string
        shippingMethod: string
        trackingNumber: string
        trackingCarrier: string
        trackingUrl: string
        shippedAt: string | null
        arrivedEta: string | null
        items: {
          designName: string
          colorName: string
          qty: number
          printStatus: string
          printStatusLabel: string
        }[]
      }>('/api/public/track', {
        method: 'POST',
        body: JSON.stringify({ code }),
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
      setPopular: (id: string, popular: boolean) =>
        request<import('../types/catalog.ts').Design>(`/api/admin/designs/${id}/popular`, {
          method: 'POST',
          body: JSON.stringify({ popular }),
        }),
      setManualPhotos: (id: string, manualPhotos: boolean) =>
        request<import('../types/catalog.ts').Design>(`/api/admin/designs/${id}/manual-photos`, {
          method: 'POST',
          body: JSON.stringify({ manualPhotos }),
        }),
      regenerateRealisticImage: (id: string, colorId?: string) =>
        request<import('../types/catalog.ts').Design>(`/api/admin/designs/${id}/realistic-image`, {
          method: 'POST',
          body: JSON.stringify(colorId ? { colorId } : {}),
        }),
      uploadRealisticImage: (id: string, colorId: string, file: File) => {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('colorId', colorId)
        return fetch(`/api/admin/designs/${id}/realistic-image/upload`, {
          method: 'POST',
          body: formData,
          credentials: 'include',
        }).then(async (res) => {
          const data = await res.json()
          if (!res.ok) throw new Error(data.error ?? 'Upload failed')
          return data as { ok: true; imageUrl: string }
        })
      },
      uploadStl: (file: File) => {
        const formData = new FormData()
        formData.append('file', file)
        return fetch('/api/admin/designs/upload-model', {
          method: 'POST',
          body: formData,
          credentials: 'include',
        }).then(async (res) => {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string
            stlPath?: string
            hasStl?: boolean
            modelExt?: string
            sourceGcodePath?: string
            grams?: number | null
            hours?: number | null
            fromGcode?: boolean
            sizeXMm?: number | null
            sizeYMm?: number | null
            sizeZMm?: number | null
          }
          if (!res.ok) throw new Error(data.error ?? 'Model upload failed')
          if (!data.stlPath || !data.hasStl || !data.modelExt) {
            throw new Error('Upload finished but the server did not confirm the file. Try again.')
          }
          return data as {
            stlPath: string
            hasStl: boolean
            modelExt: string
            sourceGcodePath?: string
            grams?: number | null
            hours?: number | null
            fromGcode?: boolean
            sizeXMm?: number | null
            sizeYMm?: number | null
            sizeZMm?: number | null
          }
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
          const data = (await res.json().catch(() => ({}))) as {
            error?: string
            stlPath?: string
            hasStl?: boolean
            modelExt?: string
            sourceGcodePath?: string
            grams?: number | null
            hours?: number | null
            fromGcode?: boolean
            sizeXMm?: number | null
            sizeYMm?: number | null
            sizeZMm?: number | null
          }
          if (!res.ok) throw new Error(data.error ?? 'Model upload failed')
          if (!data.stlPath || !data.hasStl || !data.modelExt) {
            throw new Error('Upload finished but the server did not confirm the file. Try again.')
          }
          return data as {
            stlPath: string
            hasStl: boolean
            modelExt: string
            sourceGcodePath?: string
            grams?: number | null
            hours?: number | null
            fromGcode?: boolean
            sizeXMm?: number | null
            sizeYMm?: number | null
            sizeZMm?: number | null
          }
        })
      },
      /**
       * Big STLs (40–100 MB): mint a file name, then send the file in 8 MB
       * pieces. One giant streamed request kept dying mid-upload in the
       * browser (a crashed/reset page); small pieces are quick, and a failed
       * piece is retried on its own. The server stores the pieces and the
       * model CDN serves them glued back together. Same result shape as
       * uploadModel; dimensions/weight fill in when the design is quoted.
       */
      directUploadModel: async (
        file: File,
        onProgress?: (fraction: number) => void,
      ) => {
        const start = await request<{ fileName: string }>(
          '/api/admin/designs/upload-model/direct-start',
          { method: 'POST', body: JSON.stringify({ ext: '.stl' }) },
        )
        const fileName = start.fileName
        const CHUNK_BYTES = 8 * 1024 * 1024
        const chunkCount = Math.max(1, Math.ceil(file.size / CHUNK_BYTES))
        for (let i = 0; i < chunkCount; i++) {
          const piece = file.slice(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES)
          let sent = false
          for (let attempt = 0; attempt < 3 && !sent; attempt++) {
            try {
              const res = await fetch(
                `/upload/chunk/${encodeURIComponent(fileName)}/${i}`,
                {
                  method: 'PUT',
                  body: piece,
                  credentials: 'include',
                  headers: { 'Content-Type': 'application/octet-stream' },
                },
              )
              const data = (await res.json().catch(() => ({}))) as { error?: string }
              if (!res.ok) throw new Error(data.error ?? 'Upload piece failed')
              sent = true
            } catch {
              if (attempt < 2) await new Promise((r) => setTimeout(r, 1200))
            }
          }
          if (!sent) {
            throw new Error(
              `Upload stopped on piece ${i + 1} of ${chunkCount}. Check your connection and try again — nothing was saved yet.`,
            )
          }
          onProgress?.((i + 1) / chunkCount)
        }
        const res = await fetch(
          `/upload/direct/${encodeURIComponent(fileName)}/complete`,
          {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chunks: chunkCount }),
          },
        )
        const data = (await res.json().catch(() => ({}))) as {
          error?: string
          stlPath?: string
          hasStl?: boolean
          modelExt?: string
        }
        if (!res.ok) throw new Error(data.error ?? 'Big-file upload failed')
        if (!data.stlPath || !data.hasStl) {
          throw new Error('Upload finished but the server did not confirm the file. Try again.')
        }
        return {
          stlPath: data.stlPath,
          hasStl: true,
          modelExt: data.modelExt || '.stl',
          sourceGcodePath: '',
          grams: null,
          hours: null,
          fromGcode: false,
          sizeXMm: null,
          sizeYMm: null,
          sizeZMm: null,
        }
      },
      stlUrl: (id: string) => `/api/admin/designs/${id}/stl`,
      downloadModel: async (design: {
        id: string
        name: string
        hasStl: boolean
        modelExt?: string
        multicolorOnly?: boolean
        parts?: { label: string; hasStl: boolean; modelExt?: string }[]
      }) => {
        const slug =
          design.name
            .trim()
            .replace(/[^\w.\-]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 80) || design.id.slice(0, 8)
        const parts = design.parts ?? []
        if (design.multicolorOnly && parts.some((p) => p.hasStl)) {
          let downloaded = 0
          for (let i = 0; i < parts.length; i++) {
            const part = parts[i]
            if (!part?.hasStl) continue
            if (downloaded > 0) await new Promise((r) => setTimeout(r, 450))
            const ext = (part.modelExt || '.stl').replace(/^\./, '') || 'stl'
            const partSlug =
              part.label
                .trim()
                .replace(/[^\w.\-]+/g, '_')
                .replace(/^_+|_+$/g, '')
                .slice(0, 40) || `part${i + 1}`
            await downloadAuthFile(
              `/api/admin/designs/${encodeURIComponent(design.id)}/parts/${i}/stl`,
              `${slug}-${partSlug}.${ext}`,
              'STL download failed',
            )
            downloaded += 1
          }
          if (downloaded === 0) throw new Error('No STL on file for this design.')
          return
        }
        if (!design.hasStl) throw new Error('No model on file for this design.')
        const ext = (design.modelExt || '.stl').replace(/^\./, '') || 'stl'
        await downloadAuthFile(
          `/api/admin/designs/${encodeURIComponent(design.id)}/stl`,
          `${slug}.${ext}`,
          'Model download failed',
        )
      },
      remove: (id: string) =>
        request<{ ok: true; archived: boolean }>(`/api/admin/designs/${id}`, { method: 'DELETE' }),
      submit: (id: string) =>
        request<import('../types/catalog.ts').Design & { sliceWarning?: string }>(
          `/api/admin/designs/${id}/submit`,
          {
            method: 'POST',
            body: '{}',
          },
        ),
      quoteTick: (id: string) =>
        request<import('../types/catalog.ts').Design>(`/api/admin/designs/${id}/quote-tick`, {
          method: 'POST',
          body: '{}',
        }),
      requote: (id: string) =>
        request<import('../types/catalog.ts').Design & { sliceWarning?: string }>(
          `/api/admin/designs/${id}/requote`,
          {
            method: 'POST',
            body: '{}',
          },
        ),
      approve: (id: string) =>
        request<{
          design: import('../types/catalog.ts').Design
          pricing?: unknown
          quotingStarted?: boolean
          sliceWarning?: string
        }>(`/api/admin/designs/${id}/approve`, { method: 'POST', body: '{}' }),
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
      prepareGcode: (id: string, printerId = 'pablo_p1s') =>
        request<{ status: 'ready' | 'running' }>(`/api/admin/designs/${id}/gcode/prepare`, {
          method: 'POST',
          body: JSON.stringify({ printerId }),
        }),
      gcodeStatus: (id: string, printerId = 'pablo_p1s') =>
        request<{ status: 'ready' | 'idle' | 'running' | 'error'; storedName?: string; error?: string }>(
          `/api/admin/designs/${id}/gcode/status?printerId=${encodeURIComponent(printerId)}`,
        ),
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
      cashIn: (orderId: string) =>
        request<{ ok: true }>(`/api/admin/orders/${orderId}/cash-in`, {
          method: 'POST',
          body: '{}',
        }),
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
      markArrived: (orderId: string) =>
        request<import('../types/catalog.ts').OrderDto>(`/api/admin/orders/${orderId}/arrive`, {
          method: 'POST',
          body: '{}',
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
              visibleToCustomers: boolean
              createdAt: string
            }[]
          }>('/api/admin/discounts'),
        create: (body: {
          code: string
          kind:
            | 'percent'
            | 'amount'
            | 'free_shipping'
            | 'percent_and_shipping'
            | 'amount_and_shipping'
            | 'school_pickup'
          percentOff?: number
          amountOffCents?: number
          maxRedemptions?: number | null
          visibleToCustomers?: boolean
        }) =>
          request<{ discount: { id: string; code: string } }>('/api/admin/discounts', {
            method: 'POST',
            body: JSON.stringify(body),
          }),
        update: (
          id: string,
          body: {
            code: string
            kind:
              | 'percent'
              | 'amount'
              | 'free_shipping'
              | 'percent_and_shipping'
              | 'amount_and_shipping'
              | 'school_pickup'
            percentOff?: number
            amountOffCents?: number
            maxRedemptions?: number | null
            visibleToCustomers?: boolean
          },
        ) =>
          request<{ discount: { id: string; code: string } }>(`/api/admin/discounts/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(body),
          }),
        setVisibility: (id: string, visibleToCustomers: boolean) =>
          request<{ ok: true; visibleToCustomers: boolean }>(
            `/api/admin/discounts/${id}/visibility`,
            {
              method: 'POST',
              body: JSON.stringify({ visibleToCustomers }),
            },
          ),
        deactivate: (id: string) =>
          request<{ ok: true }>(`/api/admin/discounts/${id}/deactivate`, {
            method: 'POST',
            body: '{}',
          }),
        reactivate: (id: string) =>
          request<{ ok: true }>(`/api/admin/discounts/${id}/reactivate`, {
            method: 'POST',
            body: '{}',
          }),
        remove: (id: string) =>
          request<{ ok: true }>(`/api/admin/discounts/${id}`, {
            method: 'DELETE',
          }),
      },
      shipCustom: (id: string, body: { trackingNumber: string; carrier?: string }) =>
        request<{ ok: true }>(`/api/admin/custom-requests/${id}/ship`, {
          method: 'POST',
          body: JSON.stringify(body),
        }),
      downloadStl: async (itemId: string) => {
        const base = `/api/admin/order-items/${encodeURIComponent(itemId)}/stl`
        const meta = await request<{
          partCount: number
          parts: { index: number; label: string; ext: string }[]
        }>(`${base}/meta`)
        const partCount = Math.max(1, Number(meta.partCount) || 1)
        for (let i = 0; i < partCount; i++) {
          if (i > 0) await new Promise((r) => setTimeout(r, 450))
          const part = meta.parts?.[i]
          const ext = (part?.ext || '.stl').replace(/^\./, '') || 'stl'
          const url = partCount > 1 ? `${base}?part=${part?.index ?? i}` : base
          const fallback = `printx-${itemId.slice(0, 8)}${
            partCount > 1 ? `-part${i + 1}` : ''
          }.${ext}`
          await downloadAuthFile(url, fallback, 'STL download failed')
        }
      },
      downloadGcode: async (itemId: string) => {
        const base = `/api/admin/order-items/${encodeURIComponent(itemId)}/gcode`
        type PrepStatus = {
          status: 'idle' | 'running' | 'ready' | 'error'
          error?: string
          partCount?: number
          parts?: { index: number; label: string }[]
        }
        const withTimeout = async <T,>(p: Promise<T>, ms: number, label: string): Promise<T> => {
          let timer: ReturnType<typeof setTimeout> | undefined
          try {
            return await Promise.race([
              p,
              new Promise<T>((_, reject) => {
                timer = setTimeout(() => reject(new Error(label)), ms)
              }),
            ])
          } finally {
            if (timer) clearTimeout(timer)
          }
        }
        let st = await withTimeout(
          request<PrepStatus>(`${base}/status`),
          20_000,
          'Could not check G-code status. Try again.',
        )
        if (st.status !== 'ready') {
          // idle / error — start a fresh prepare. Do not stick on a previous failure
          // (in-memory error jobs otherwise block Download until the next deploy).
          if (st.status !== 'running') {
            st = await withTimeout(
              request<PrepStatus>(`${base}/prepare`, { method: 'POST', body: '{}' }),
              20_000,
              'Could not start G-code prepare. Try again.',
            )
          }
          if (st.status === 'error') throw new Error(st.error || 'G-code prepare failed')
          // Free-plan local slice can take several minutes; fail with a clear error.
          const deadline = Date.now() + 14 * 60_000
          let idleRestarts = 0
          let errorRestarts = 0
          while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 2500))
            st = await withTimeout(
              request<PrepStatus>(`${base}/status`),
              20_000,
              'G-code status check timed out. Try Download again.',
            )
            if (st.status === 'ready') break
            if (st.status === 'error') {
              // One automatic retry after a slice failure (timeout / OOM), then surface it.
              errorRestarts += 1
              if (errorRestarts > 1) throw new Error(st.error || 'G-code prepare failed')
              st = await withTimeout(
                request<PrepStatus>(`${base}/prepare`, { method: 'POST', body: '{}' }),
                20_000,
                'Could not restart G-code prepare. Try again.',
              )
              if (st.status === 'error') throw new Error(st.error || 'G-code prepare failed')
              continue
            }
            if (st.status === 'idle') {
              // Prepare should mark DB "running"; idle means dispatch never stuck. Re-dispatch a few times.
              idleRestarts += 1
              if (idleRestarts > 4) {
                throw new Error(
                  'G-code is not ready yet. Prepare may still be running in GitHub Actions — wait a minute and tap Download again, or use Designs → Prepare G-code.',
                )
              }
              st = await withTimeout(
                request<PrepStatus>(`${base}/prepare`, { method: 'POST', body: '{}' }),
                20_000,
                'Could not restart G-code prepare. Try again.',
              )
              if (st.status === 'error') throw new Error(st.error || 'G-code prepare failed')
            }
          }
          if (st.status !== 'ready') {
            throw new Error(
              'Timed out preparing G-code after ~14 minutes. Tap Download again — PrintX will start a fresh slice.',
            )
          }
        }
        const partCount = Math.max(1, Number(st.partCount) || 1)
        const downloadOne = async (partIndex: number) => {
          const url = partCount > 1 ? `${base}?part=${partIndex}` : base
          const fallback = `printx-${itemId.slice(0, 8)}${partCount > 1 ? `-part${partIndex + 1}` : ''}.gcode`
          try {
            await downloadAuthFile(url, fallback, 'G-code download failed')
          } catch (err) {
            const msg = err instanceof Error ? err.message : ''
            // Race: status flipped to ready before the file was openable — one retry.
            if (/still preparing|NOT_READY|409/i.test(msg)) {
              await new Promise((r) => setTimeout(r, 1500))
              await downloadAuthFile(url, fallback, 'G-code download failed')
              return
            }
            throw err
          }
        }
        for (let i = 0; i < partCount; i++) {
          if (i > 0) await new Promise((r) => setTimeout(r, 450))
          await downloadOne(i)
        }
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
      shippingToProfit: (body: { kind: 'shop' | 'custom'; id: string; undo?: boolean }) =>
        request<{
          ok: true
          kind: 'shop' | 'custom'
          id: string
          shippingUsd: number
          shippingToProfitAt: string | null
        }>('/api/admin/money/shipping-to-profit', {
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
      downloadGcode: (id: string, printerId?: string) => {
        const q = printerId ? `?printerId=${encodeURIComponent(printerId)}` : ''
        return downloadAuthFile(
          `/api/admin/custom-requests/${encodeURIComponent(id)}/gcode${q}`,
          `printx-custom-${id.slice(0, 8)}${printerId ? `-${printerId}` : ''}.gcode`,
          'G-code download failed',
        )
      },
      downloadSource: (fileName: string) =>
        downloadAuthFile(
          `/api/admin/uploads/${encodeURIComponent(fileName)}`,
          fileName,
          'Source model download failed',
        ),
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
      test: () =>
        request<{ ok: true; sent: number; failed: number; removed: number }>(
          '/api/admin/push/test',
          { method: 'POST', body: '{}' },
        ),
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
      send: (body: {
        subject: string
        body: string
        recipientIds: string[]
        scheduledAt?: string
        draftId?: string
      }) =>
        request<import('../types/api.ts').MailMessage>('/api/admin/mail', {
          method: 'POST',
          body: JSON.stringify(body),
        }),
      drafts: () => request<import('../types/api.ts').MailMessage[]>('/api/admin/mail/drafts'),
      saveDraft: (body: {
        id?: string
        subject: string
        body: string
        recipientIds: string[]
      }) =>
        request<import('../types/api.ts').MailMessage>('/api/admin/mail/drafts', {
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
      delete: (id: string, opts?: { mailbox?: 'inbox' | 'archived' | 'sent' | 'drafts' | 'trash'; forever?: boolean }) => {
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
      filamentColors: () =>
        request<{
          mine: string[]
          inStock: string[]
          colors: { id: string; name: string; hex: string }[]
        }>('/api/admin/settings/filament-colors'),
      updateFilamentColors: (colorIds: string[]) =>
        request<{ mine: string[]; inStock: string[] }>('/api/admin/settings/filament-colors', {
          method: 'PATCH',
          body: JSON.stringify({ colorIds }),
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
          quotingInBackground?: boolean
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
