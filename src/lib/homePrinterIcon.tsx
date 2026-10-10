import { forwardRef, type SVGProps } from 'react'

type Props = SVGProps<SVGSVGElement> & {
  size?: number | string
}

/**
 * Home / marketing 3D-printer mark (open frame + arm nozzle + cube).
 * Uses currentColor — not the Designs nav icon.
 */
export const HomePrinterIcon = forwardRef<SVGSVGElement, Props>(
  ({ className, size = 24, strokeWidth = 2.25, ...props }, ref) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
      {...props}
    >
      {/* Open-top printer frame */}
      <path d="M4 6.5v10.5a3.5 3.5 0 0 0 3.5 3.5h9A3.5 3.5 0 0 0 20 17V6.5" />
      {/* Arm from top-right down to nozzle */}
      <path d="M20 6.5H12v7" />
      {/* Nozzle tip */}
      <path
        fill="currentColor"
        stroke="none"
        d="M10.15 13.5h3.7l-.85 1.55a1 1 0 0 1-2 0l-.85-1.55z"
      />
      {/* Isometric cube */}
      <path d="M8.2 16.6 12 14.5l3.8 2.1-3.8 2.1Z" />
      <path d="M8.2 16.6v3.2L12 21.9v-3.1" />
      <path d="M15.8 16.6v3.2L12 21.9" />
    </svg>
  ),
)

HomePrinterIcon.displayName = 'HomePrinterIcon'
