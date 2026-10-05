import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react'
import { onHashLinkClick } from '../lib/scroll'

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: Size
  href?: string
  children: ReactNode
}

const variants: Record<Variant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  outline: 'btn-outline',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
}

const sizes: Record<Size, string> = {
  sm: '!min-h-10 !px-4 !text-sm',
  md: '!min-h-11 !px-6 !text-sm',
  lg: '!min-h-12 !px-8 !text-base',
}

export function Button({
  variant = 'primary',
  size = 'md',
  href,
  className = '',
  children,
  type = 'button',
  onClick,
  ...props
}: ButtonProps) {
  const classes = `btn ${variants[variant]} ${sizes[size]} ${className}`.trim()

  if (href) {
    const isHash = href.startsWith('#')
    const anchorProps: AnchorHTMLAttributes<HTMLAnchorElement> = {
      href,
      className: classes,
      onClick: isHash
        ? (e) => {
            onHashLinkClick(e, href)
          }
        : undefined,
    }
    return <a {...anchorProps}>{children}</a>
  }

  return (
    <button type={type} className={classes} onClick={onClick} {...props}>
      {children}
    </button>
  )
}
