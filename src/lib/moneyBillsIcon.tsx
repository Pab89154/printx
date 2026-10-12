import { forwardRef, type SVGProps } from 'react'

type MoneyBillsProps = SVGProps<SVGSVGElement> & {
  size?: number | string
}

const GREEN = '#7CCF3A'
const OLIVE = '#6B8F3C'
const CREAM = '#F4F0D8'

/**
 * Flat green dollar bill — Money nav icon (keeps its own colors).
 */
export const MoneyBills = forwardRef<SVGSVGElement, MoneyBillsProps>(
  ({ className, size = 24, ...props }, ref) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden
      {...props}
    >
      {/* Outer bill */}
      <rect x="1.5" y="5.75" width="21" height="12.5" rx="3.4" fill={GREEN} />
      {/* Inner cream face — large radius gives scalloped border look */}
      <rect x="3.15" y="7.35" width="17.7" height="9.3" rx="2.8" fill={CREAM} />
      {/* Corner dots on green frame */}
      <circle cx="3.7" cy="7.85" r="0.9" fill={OLIVE} />
      <circle cx="20.3" cy="7.85" r="0.9" fill={OLIVE} />
      <circle cx="3.7" cy="16.15" r="0.9" fill={OLIVE} />
      <circle cx="20.3" cy="16.15" r="0.9" fill={OLIVE} />
      {/* Side seals */}
      <circle cx="6.2" cy="12" r="1.45" fill={GREEN} />
      <circle cx="17.8" cy="12" r="1.45" fill={GREEN} />
      {/* Center seal */}
      <circle cx="12" cy="12" r="3.25" fill={OLIVE} />
      {/* Cream dollar sign */}
      <text
        x="12"
        y="12.1"
        textAnchor="middle"
        dominantBaseline="central"
        fill={CREAM}
        fontSize="4.6"
        fontWeight="800"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        $
      </text>
    </svg>
  ),
)

MoneyBills.displayName = 'MoneyBills'
