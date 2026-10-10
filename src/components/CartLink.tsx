import { Link } from 'react-router-dom'
import { ShoppingCart } from 'lucide-react'
import { useCart } from '../context/CartContext'

type Props = {
  className?: string
  /** Stronger button look (shop page header). */
  primary?: boolean
}

export function CartLink({ className = '', primary = false }: Props) {
  const { count } = useCart()

  return (
    <Link
      to="/cart"
      aria-label={count > 0 ? `Cart, ${count} items` : 'Cart'}
      className={
        primary
          ? `relative inline-flex h-11 w-11 items-center justify-center rounded-xl bg-electric text-white shadow-sm transition hover:bg-electric/90 ${className}`
          : `relative inline-flex h-10 w-10 items-center justify-center rounded-xl text-navy transition hover:bg-slate-100 ${className}`
      }
    >
      <ShoppingCart size={20} strokeWidth={2} aria-hidden />
      {count > 0 ? (
        <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-navy px-1 text-[11px] font-bold text-white">
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
    </Link>
  )
}
