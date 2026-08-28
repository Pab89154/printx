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
      <path d="M7 20V8" />
      <path d="M17 20V8" />
      <path d="M7 8h10" />
      <path d="M6 20h12" />
      <path d="M12 8v2" />
      <path d="M10.5 10h3" />
      <path d="M12 10v2.5" />
      <path d="M11.5 12.5 12 14 12.5 12.5" />
      <path d="M12 15 10.5 17" />
      <path d="M12 15 13.5 17" />
      <path d="M10.5 17v2" />
      <path d="M13.5 17v2" />
      <path d="M10.5 19h3" />
    </svg>
  ),
)

Printer3d.displayName = 'Printer3d'
