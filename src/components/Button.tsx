import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost'
type Size = 'sm' | 'md' | 'lg'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: Size
  href?: string
  children: ReactNode
}

const variants: Record<Variant, string> = {
  primary:
    'bg-electric text-white hover:bg-electric-light shadow-lg shadow-electric/25 hover:shadow-electric/40 hover:-translate-y-0.5',
  secondary:
    'bg-white text-navy border border-slate-200 hover:border-electric hover:text-electric hover:-translate-y-0.5 shadow-sm',
  outline:
    'border-2 border-white/30 text-white hover:bg-white/10 hover:-translate-y-0.5',
  ghost: 'text-electric hover:bg-electric/5',
}

const sizes: Record<Size, string> = {
  sm: 'px-4 py-2 text-sm',
  md: 'px-6 py-3 text-sm',
  lg: 'px-8 py-3.5 text-base',
}

export function Button({
  variant = 'primary',
  size = 'md',
  href,
  className = '',
  children,
  ...props
}: ButtonProps) {
  const classes = `inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all duration-300 cursor-pointer ${variants[variant]} ${sizes[size]} ${className}`

  if (href) {
    return (
      <a href={href} className={classes}>
        {children}
      </a>
    )
  }

  return (
    <button type="button" className={classes} {...props}>
      {children}
    </button>
  )
}
