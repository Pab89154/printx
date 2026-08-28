import { forwardRef, type SVGProps } from 'react'

type Printer3dProps = SVGProps<SVGSVGElement> & {
  size?: number | string
}

/** Lucide-style 3D printer icon (not in the Lucide CDN set). */
export const Printer3d = forwardRef<SVGSVGElement, Printer3dProps>(
  ({ className, size = 24, strokeWidth = 2, ...props }, ref) => (
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
      {...props}
    >
      <path d="M4 8V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v3" />
      <path d="M4 8h16" />
      <path d="M6 8v9" />
      <path d="M18 8v9" />
      <path d="M6 12h12" />
      <path d="M12 12v2" />
      <circle cx="12" cy="15" r="1" />
      <rect x="5" y="17" width="14" height="4" rx="1" />
    </svg>
  ),
)

Printer3d.displayName = 'Printer3d'
