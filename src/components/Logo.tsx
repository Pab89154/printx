type LogoProps = {
  size?: number
  className?: string
  /** Show wordmark next to the mark */
  withWordmark?: boolean
  /** Wordmark color for dark backgrounds */
  light?: boolean
  subtitle?: string
}

export function Logo({
  size = 40,
  className = '',
  withWordmark = false,
  light = false,
  subtitle,
}: LogoProps) {
  return (
    <span className={`inline-flex items-center gap-3 ${className}`.trim()}>
      <img
        src="/logo.png"
        alt="PrintX"
        width={size}
        height={size}
        className="shrink-0 rounded-[22%] shadow-sm"
        decoding="async"
      />
      {withWordmark && (
        <span className="min-w-0">
          <span className={`block text-lg font-extrabold tracking-tight leading-none ${light ? 'text-white' : 'text-navy'}`}>
            PrintX
          </span>
          {subtitle && (
            <span className={`mt-0.5 block text-xs font-medium ${light ? 'text-slate-400' : 'text-muted'}`}>
              {subtitle}
            </span>
          )}
        </span>
      )}
    </span>
  )
}
