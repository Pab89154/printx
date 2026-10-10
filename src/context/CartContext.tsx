import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { CartLine } from '../types/catalog'

type CartContextValue = {
  lines: CartLine[]
  add: (line: Omit<CartLine, 'qty'>, qty?: number) => void
  setQty: (designId: string, colorId: string, qty: number) => void
  remove: (designId: string, colorId: string) => void
  clear: () => void
  count: number
  subtotal: number
}

const CartContext = createContext<CartContextValue | null>(null)
const STORAGE_KEY = 'printx_cart_v1'

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw) as CartLine[]
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  })

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lines))
  }, [lines])

  const value = useMemo<CartContextValue>(() => {
    return {
      lines,
      add: (line, qty = 1) => {
        setLines((prev) => {
          const idx = prev.findIndex(
            (l) => l.designId === line.designId && l.colorId === line.colorId,
          )
          if (idx >= 0) {
            const next = [...prev]
            next[idx] = { ...next[idx]!, qty: Math.min(20, next[idx]!.qty + qty) }
            return next
          }
          return [...prev, { ...line, qty: Math.min(20, Math.max(1, qty)) }]
        })
      },
      setQty: (designId, colorId, qty) => {
        setLines((prev) =>
          prev
            .map((l) =>
              l.designId === designId && l.colorId === colorId
                ? { ...l, qty: Math.min(20, Math.max(0, Math.floor(qty))) }
                : l,
            )
            .filter((l) => l.qty > 0),
        )
      },
      remove: (designId, colorId) => {
        setLines((prev) => prev.filter((l) => !(l.designId === designId && l.colorId === colorId)))
      },
      clear: () => setLines([]),
      count: lines.reduce((s, l) => s + l.qty, 0),
      subtotal: lines.reduce((s, l) => s + l.unitPrice * l.qty, 0),
    }
  }, [lines])

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart() {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart requires CartProvider')
  return ctx
}
