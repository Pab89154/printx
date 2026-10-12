import { forwardRef, type SVGProps } from 'react'

type MoneyBillsProps = SVGProps<SVGSVGElement> & {
  size?: number | string
}

/**
 * Stack of banknotes with $ mark — Money nav icon.
 * Uses currentColor so it matches other sidebar icons (white / slate / electric).
 */
export const MoneyBills = forwardRef<SVGSVGElement, MoneyBillsProps>(
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
      {/* Back bills (stack) */}
      <rect x="3.5" y="4.5" width="15.5" height="10.5" rx="1.6" />
      <rect x="5" y="6.5" width="15.5" height="10.5" rx="1.6" />
      {/* Front bill */}
      <rect x="6.5" y="8.5" width="15.5" height="10.5" rx="1.6" />
      {/* Center seal */}
      <circle cx="14.25" cy="13.75" r="2.35" />
      <path
        d="M14.25 12.15v3.2M13.35 12.7c.2-.35.55-.55.9-.55.7 0 1.1.4 1.1.95 0 .9-2 1-2 2 0 .5.4.9 1 .9.4 0 .75-.2.95-.55"
        strokeWidth={1.6}
      />
      {/* Side rosettes */}
      <circle cx="9.35" cy="13.75" r="1.05" />
      <circle cx="9.35" cy="13.75" r="0.25" fill="currentColor" stroke="none" />
      <circle cx="19.15" cy="13.75" r="1.05" />
      <circle cx="19.15" cy="13.75" r="0.25" fill="currentColor" stroke="none" />
    </svg>
  ),
)

MoneyBills.displayName = 'MoneyBills'
