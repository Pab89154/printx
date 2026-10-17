import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import {
  CASH_PAYMENT_LABEL,
  CASH_TERMS_BODY,
  CASH_TERMS_LABEL,
  cashPaymentDetail,
  cashSaleItemNotice,
} from '../../shared/checkoutConsent'
import type { PublicCatalogDesign } from '../types/catalog'

export function AdminCashSale() {
  const [designs, setDesigns] = useState<PublicCatalogDesign[]>([])
  const [designId, setDesignId] = useState('')
  const [colorId, setColorId] = useState('')
  const [filamentColorIds, setFilamentColorIds] = useState<string[]>([])
  const [qty, setQty] = useState(1)
  const [code, setCode] = useState('')
  const [codeOk, setCodeOk] = useState('')
  const [codeError, setCodeError] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [agreePay, setAgreePay] = useState(false)
  const [agreeTerms, setAgreeTerms] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void api.catalog
      .public()
      .then((data) => {
        const priced = data.designs.filter((d) => (d.catalogPriceUsd ?? 0) > 0)
        setDesigns(priced)
        if (priced[0]) setDesignId(priced[0].id)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load designs'))
  }, [])

  const design = designs.find((d) => d.id === designId) ?? null

  useEffect(() => {
    if (!design) return
    if (design.multicolorOnly) {
      const solids = design.availableColors.filter((c) => c.id !== 'multicolor')
      const n = design.multicolorSlotCount || design.parts?.length || 1
      setFilamentColorIds(Array.from({ length: n }, (_, i) => solids[i]?.id || solids[0]?.id || ''))
      setColorId('multicolor')
    } else {
      setColorId(design.availableColors[0]?.id || '')
      setFilamentColorIds([])
    }
  }, [design])

  useEffect(() => {
    const trimmed = code.trim()
    setCodeOk('')
    setCodeError('')
    if (trimmed.length < 3) return
    const handle = window.setTimeout(() => {
      void api.catalog.orders
        .cashCode(trimmed)
        .then((res) => {
          setCodeOk(res.code)
          setCodeError('')
        })
        .catch((e) => {
          setCodeOk('')
          setCodeError(e instanceof Error ? e.message : 'Invalid code')
        })
    }, 300)
    return () => window.clearTimeout(handle)
  }, [code])

  const colorName = useMemo(() => {
    if (!design) return ''
    if (design.multicolorOnly) {
      return filamentColorIds
        .map((id, i) => {
          const name = design.availableColors.find((c) => c.id === id)?.name || 'Color'
          const label = design.parts?.[i]?.label
          return label ? `${label}: ${name}` : name
        })
        .join(', ')
    }
    return design.availableColors.find((c) => c.id === colorId)?.name || ''
  }, [design, colorId, filamentColorIds])

  const unit = design?.catalogPriceUsd ?? 0
  const total = Math.round(unit * qty * 100) / 100
  const notice =
    design && colorName
      ? cashSaleItemNotice(
          [{ name: design.name, color: colorName, qty, lineUsd: total }],
          total,
        )
      : ''

  const nameOk = customerName.trim().length >= 3 && customerName.trim().includes(' ')
  const colorsOk = design?.multicolorOnly
    ? filamentColorIds.every(Boolean)
    : Boolean(colorId)
  const ready = Boolean(codeOk && design && colorsOk && nameOk && agreePay && agreeTerms && total > 0)

  async function submit() {
    if (!design || !ready) return
    setBusy(true)
    setError('')
    setDone('')
    try {
      const res = await api.catalog.orders.cashSale({
        code: codeOk,
        customerName: customerName.trim(),
        agreeToPay: true,
        agreeToTerms: true,
        items: [
          {
            designId: design.id,
            colorId: design.multicolorOnly ? 'multicolor' : colorId,
            qty,
            ...(design.multicolorOnly ? { filamentColorIds } : {}),
          },
        ],
      })
      setDone(`Cash received. Order saved for $${res.totalUsd.toFixed(2)}.`)
      setCustomerName('')
      setAgreePay(false)
      setAgreeTerms(false)
      setCode('')
      setCodeOk('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record the sale')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold text-navy">Cash sale</h1>
        <p className="mt-1 text-sm text-muted">
          School pickup. No shipping charge and no shipment. The order is created when cash is
          received.
        </p>
      </div>

      <label className="block text-sm text-navy">
        Classmate code
        <input
          className="mt-1 w-full rounded-lg border px-3 py-3 text-base uppercase"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="off"
          placeholder="Required"
        />
      </label>
      {codeOk ? <p className="text-sm text-emerald-700">Code {codeOk} is valid.</p> : null}
      {codeError ? <p className="text-sm text-red-600">{codeError}</p> : null}

      <label className="block text-sm text-navy">
        Design
        <select
          className="mt-1 w-full rounded-lg border px-3 py-3 text-base"
          value={designId}
          onChange={(e) => setDesignId(e.target.value)}
        >
          {designs.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} · ${d.catalogPriceUsd?.toFixed(2)}
            </option>
          ))}
        </select>
      </label>

      {design?.multicolorOnly ? (
        filamentColorIds.map((id, index) => (
          <label key={index} className="block text-sm text-navy">
            {design.parts?.[index]?.label || `Color ${index + 1}`}
            <select
              className="mt-1 w-full rounded-lg border px-3 py-3 text-base"
              value={id}
              onChange={(e) =>
                setFilamentColorIds((prev) => prev.map((v, i) => (i === index ? e.target.value : v)))
              }
            >
              {design.availableColors
                .filter((c) => c.id !== 'multicolor')
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </label>
        ))
      ) : (
        <label className="block text-sm text-navy">
          Color
          <select
            className="mt-1 w-full rounded-lg border px-3 py-3 text-base"
            value={colorId}
            onChange={(e) => setColorId(e.target.value)}
          >
            {(design?.availableColors ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="block text-sm text-navy">
        Quantity
        <input
          type="number"
          min={1}
          max={20}
          className="mt-1 w-full rounded-lg border px-3 py-3 text-base"
          value={qty}
          onChange={(e) => setQty(Math.min(20, Math.max(1, Math.floor(Number(e.target.value) || 1))))}
        />
      </label>

      <p className="rounded-xl border bg-white px-4 py-3 text-sm text-navy">
        <span className="font-semibold">School pickup · ${total.toFixed(2)}</span>
        <span className="mt-1 block text-muted">{notice || 'Pick a design to see the total.'}</span>
      </p>

      <label className="block text-sm text-navy">
        Classmate full name
        <input
          className="mt-1 w-full rounded-lg border px-3 py-3 text-base"
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          autoComplete="name"
          placeholder="First and last name"
        />
      </label>

      <label className="flex items-start gap-3 rounded-xl border bg-white px-4 py-3 text-base text-navy">
        <input
          type="checkbox"
          className="mt-1 h-5 w-5"
          checked={agreePay}
          onChange={(e) => setAgreePay(e.target.checked)}
        />
        <span>
          <span className="font-semibold">{CASH_PAYMENT_LABEL}</span>
          <span className="mt-1 block text-sm text-muted">{cashPaymentDetail(notice)}</span>
        </span>
      </label>
      <div className="rounded-xl border bg-white px-4 py-3 text-sm text-navy">
        <p className="font-semibold">Terms and conditions</p>
        <p className="mt-2 text-sm">
          <a href="/terms-and-conditions#cash" target="_blank" rel="noreferrer" className="text-electric underline">
            Click here to read the terms and conditions.
          </a>
        </p>
        <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-muted">{CASH_TERMS_BODY}</p>
        <label className="mt-3 flex items-start gap-3 text-base">
          <input
            type="checkbox"
            className="mt-1 h-5 w-5"
            checked={agreeTerms}
            onChange={(e) => setAgreeTerms(e.target.checked)}
          />
          <span className="font-semibold">{CASH_TERMS_LABEL}</span>
        </label>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {done ? <p className="text-sm text-emerald-700">{done}</p> : null}

      <button
        type="button"
        className="btn btn-primary w-full py-3 text-base"
        disabled={!ready || busy}
        onClick={() => void submit()}
      >
        {busy ? 'Saving…' : 'Cash received'}
      </button>
    </div>
  )
}
