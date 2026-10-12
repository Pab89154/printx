import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { CartLine } from '../types/catalog'

type CartContextValue = {
  lines: CartLine[]
  add: (line: Omit<CartLine, 'qty'>, qty?: number) => void
  setQty: (designId: string, colorId: string, qty: number, filamentColorIds?: string[]) => void
  remove: (designId: string, colorId: string, filamentColorIds?: string[]) => void
  clear: () => void
  count: number
  subtotal: number
}

const CartContext = createContext<CartContextValue | null>(null)
const STORAGE_KEY = 'printx_cart_v2'

function filamentKey(ids: string[] | undefined): string {
  return (ids ?? []).join('|')
}

function sameLine(
  a: Pick<CartLine, 'designId' | 'colorId' | 'filamentColorIds'>,
  designId: string,
  colorId: string,
  filamentColorIds?: string[],
): boolean {
  return (
    a.designId === designId &&
    a.colorId === colorId &&
    filamentKey(a.filamentColorIds) === filamentKey(filamentColorIds)
  )
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('printx_cart_v1')
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
          const idx = prev.findIndex((l) =>
            sameLine(l, line.designId, line.colorId, line.filamentColorIds),
          )
          if (idx >= 0) {
            const next = [...prev]
            next[idx] = { ...next[idx]!, qty: Math.min(20, next[idx]!.qty + qty) }
            return next
          }
          return [...prev, { ...line, qty: Math.min(20, Math.max(1, qty)) }]
        })
      },
      setQty: (designId, colorId, qty, filamentColorIds) => {
        setLines((prev) =>
          prev
            .map((l) =>
              sameLine(l, designId, colorId, filamentColorIds)
                ? { ...l, qty: Math.min(20, Math.max(0, Math.floor(qty))) }
                : l,
            )
            .filter((l) => l.qty > 0),
        )
      },
      remove: (designId, colorId, filamentColorIds) => {
        setLines((prev) =>
          prev.filter((l) => !sameLine(l, designId, colorId, filamentColorIds)),
        )
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
