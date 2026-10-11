import { forwardRef, type SVGProps } from 'react'

type Props = SVGProps<SVGSVGElement> & {
  size?: number | string
}

/**
 * Home / marketing 3D-printer mark — enclosed chamber (reads clearly as a printer).
 * Uses currentColor — not the Designs nav icon.
 */
export const HomePrinterIcon = forwardRef<SVGSVGElement, Props>(
  ({ className, size = 24, ...props }, ref) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
      {...props}
    >
      {/* Body + chamber + control-button cutouts */}
      <path
        fillRule="evenodd"
        d="M3 3h18v18H3V3zm2.5 2.5h13v11h-13v-11zm10.25 13.25a1.15 1.15 0 1 0 0 2.3 1.15 1.15 0 0 0 0-2.3zm3.35 0a1.15 1.15 0 1 0 0 2.3 1.15 1.15 0 0 0 0-2.3z"
      />
      {/* Gantry */}
      <rect x="6.25" y="6.5" width="11.5" height="2.4" rx="0.35" />
      {/* Extruder head */}
      <path d="M9.5 6.5h5v2.6H13.4v1.4h-2.8V9.1H9.5V6.5z" />
      {/* Isometric cube being printed */}
      <path d="M12 11.2 15.4 13l-3.4 1.8L8.6 13Z" />
      <path d="M8.6 13.35 11.6 15v3.4l-3-1.6Z" />
      <path d="M12.4 15 15.4 13.35v3.4l-3 1.6Z" />
    </svg>
  ),
)

HomePrinterIcon.displayName = 'HomePrinterIcon'
