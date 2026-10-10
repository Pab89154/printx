import { forwardRef, type SVGProps } from 'react'

type Printer3dProps = SVGProps<SVGSVGElement> & {
  size?: number | string
}

/**
 * 3D printer extruding a cube — Designs nav mark.
 * currentColor only (inherits slate / white / electric like other sidebar icons).
 */
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
      aria-hidden
      {...props}
    >
      {/* Solid extruder head */}
      <path
        fill="currentColor"
        stroke="none"
        d="M4.25 2.1h15.5a1.65 1.65 0 0 1 0 3.3h-4.55l-1.35 1.85a.9.9 0 0 1-1.45 0L11.05 5.4H4.25a1.65 1.65 0 0 1 0-3.3Z"
      />
      {/* Filament loop into the print */}
      <path d="M12 7.35v1.35c0 1.2 3.75 1.05 3.75 2.7 0 1.55-3.75 1.45-3.75 2.75" />
      {/* Isometric cube */}
      <path d="M8.15 16.2 12 14.25l3.85 1.95L12 18.15Z" />
      <path d="M8.15 16.2v3.15L12 21.3v-3.15" />
      <path d="M15.85 16.2v3.15L12 21.3" />
    </svg>
  ),
)

Printer3d.displayName = 'Printer3d'
