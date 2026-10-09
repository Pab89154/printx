import { useEffect, useId, useState, type TextareaHTMLAttributes, type InputHTMLAttributes } from 'react'
import { applySpellingFix, findSpellingIssues, type SpellingIssue } from '../lib/spellcheck'

type Shared = {
  value: string
  onChange: (value: string) => void
  className?: string
  labelClassName?: string
}

type TextareaProps = Shared &
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange' | 'className'> & {
    multiline: true
  }

type InputProps = Shared &
  Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'className' | 'type'> & {
    multiline?: false
  }

type Props = TextareaProps | InputProps

export function SpellCheckedField(props: Props) {
  const { value, onChange, className = '', labelClassName, multiline, ...rest } = props
  const reactId = useId()
  const [issues, setIssues] = useState<SpellingIssue[]>([])

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      void findSpellingIssues(value).then((next) => {
        if (!cancelled) setIssues(next)
      })
    }, 350)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [value])

  const fieldClass =
    className ||
    'mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-base outline-none focus:border-electric focus:ring-2 focus:ring-electric/20 sm:text-sm'

  return (
    <div className={labelClassName}>
      {multiline ? (
        <textarea
          {...(rest as TextareaHTMLAttributes<HTMLTextAreaElement>)}
          className={fieldClass}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          lang="en"
          spellCheck
          autoCorrect="on"
          autoCapitalize="sentences"
        />
      ) : (
        <input
          {...(rest as InputHTMLAttributes<HTMLInputElement>)}
          type="text"
          className={fieldClass}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          lang="en"
          spellCheck
          autoCorrect="on"
          autoCapitalize="sentences"
        />
      )}
      {issues.length > 0 ? (
        <div className="mt-2 space-y-1.5" aria-live="polite">
          <p className="text-xs font-medium text-muted">Spelling — tap a word to fix it</p>
          <ul className="flex flex-col gap-1.5">
            {issues.map((issue, index) => (
              <li
                key={`${reactId}-${issue.word}-${index}`}
                className="flex flex-wrap items-center gap-1.5 text-sm"
              >
                <span className="rounded-md bg-red-50 px-1.5 py-0.5 font-medium text-red-700 line-through decoration-red-400/80">
                  {issue.word}
                </span>
                <span className="text-muted" aria-hidden>
                  →
                </span>
                {issue.suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="rounded-full border border-electric/30 bg-electric/10 px-2.5 py-0.5 text-sm font-semibold text-electric transition-colors hover:border-electric hover:bg-electric/20"
                    onClick={() => onChange(applySpellingFix(value, issue.word, suggestion))}
                  >
                    {suggestion}
                  </button>
                ))}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
