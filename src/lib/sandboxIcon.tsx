import { forwardRef, type SVGProps } from 'react'

type SandboxIconProps = SVGProps<SVGSVGElement> & {
  size?: number | string
}

/**
 * Geometric cube / hexagon mark for Site sandbox.
 * Uses currentColor so it picks up amber text classes on sandbox buttons.
 */
export const SandboxIcon = forwardRef<SVGSVGElement, SandboxIconProps>(
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
      <path
        fillRule="evenodd"
        d="M11.8 0 22.4 6.2 22.3 17.9 12.1 23.9 1.5 17.7 1.6 6Z M12 2.2 20.49 7.1 20.49 16.9 12 21.8 3.51 16.9 3.51 7.1Z"
      />
      <path d="M14.6 3.9 15.4 4.2 19.2 6.4 19.4 6.9 19.2 7.2 18.7 7.5 12.2 11.2 11.5 11.1 4.8 7.3 4.6 7 4.9 6.4 9.1 4 9.6 4 12 5.4Z" />
      <path d="M19.8 8.1 20.1 8.1 20.4 8.4 20.4 13.5 19.8 14 17.9 15 17.6 15.3 17.6 18.3 17.5 18.5 13.1 21 12.6 20.9 12.5 20.7 12.5 12.4 13.1 11.9Z" />
      <path d="M4.1 8.2 11.3 12.2 11.4 12.4 11.4 20.6 11.1 20.9 10.6 20.8 6.5 18.4 6.3 18.1 6.3 15.3 3.7 13.6 3.7 8.5Z" />
    </svg>
  ),
)

SandboxIcon.displayName = 'SandboxIcon'
