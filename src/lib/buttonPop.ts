/** Make `.btn` presses feel like a spring “pop” (visible even on quick taps).
 *
 * Uses `data-btn-pop` instead of classNames so React re-renders (portal auth,
 * stats, route updates) cannot wipe the press/pop state mid-animation.
 */

export const BTN_POP_NAV_EVENT = 'printx:btn-pop-nav'

const ATTR = 'data-btn-pop'
const NAV_LOCK = 'data-btn-nav-lock'
const POP_MS = 360

let pressedBtn: HTMLElement | null = null

function closestBtn(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null
  const el = target.closest('.btn')
  if (!(el instanceof HTMLElement)) return null
  if (el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true') return null
  return el
}

function setPopState(btn: HTMLElement, state: 'pressing' | 'popping' | null) {
  if (state) btn.setAttribute(ATTR, state)
  else btn.removeAttribute(ATTR)
}

function releasePop(btn: HTMLElement) {
  // Restart spring so rapid clicks always pop.
  setPopState(btn, null)
  void btn.offsetWidth
  setPopState(btn, 'popping')
}

function isModifiedClick(e: MouseEvent) {
  return e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0
}

function shouldDelayNav(anchor: HTMLAnchorElement) {
  const href = anchor.getAttribute('href')
  if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return false
  if (anchor.target && anchor.target !== '_self') return false
  if (anchor.hasAttribute('download')) return false
  try {
    const url = new URL(href, window.location.href)
    return url.origin === window.location.origin
  } catch {
    return false
  }
}

export function installButtonPop() {
  if (typeof window === 'undefined') return
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

  document.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return
      const btn = closestBtn(e.target)
      if (!btn) return
      pressedBtn = btn
      setPopState(btn, 'pressing')
    },
    { passive: true },
  )

  document.addEventListener(
    'pointerup',
    () => {
      if (!pressedBtn) return
      const btn = pressedBtn
      pressedBtn = null
      releasePop(btn)
    },
    { passive: true },
  )

  document.addEventListener(
    'pointercancel',
    () => {
      if (!pressedBtn) return
      setPopState(pressedBtn, null)
      pressedBtn = null
    },
    { passive: true },
  )

  // Let the spring finish before React Router unmounts the control.
  document.addEventListener(
    'click',
    (e) => {
      if (!(e.target instanceof Element) || e.defaultPrevented || isModifiedClick(e)) return
      const btn = closestBtn(e.target)
      if (!btn || !(btn instanceof HTMLAnchorElement) || !shouldDelayNav(btn)) return
      if (btn.hasAttribute(NAV_LOCK)) return

      e.preventDefault()
      e.stopPropagation()
      releasePop(btn)
      btn.setAttribute(NAV_LOCK, '1')

      const url = new URL(btn.href)
      const to = `${url.pathname}${url.search}${url.hash}`

      window.setTimeout(() => {
        setPopState(btn, null)
        btn.removeAttribute(NAV_LOCK)
        window.dispatchEvent(new CustomEvent(BTN_POP_NAV_EVENT, { detail: { to } }))
      }, POP_MS)
    },
    true,
  )

  document.addEventListener(
    'animationend',
    (e) => {
      if (!(e.target instanceof HTMLElement)) return
      if (e.animationName !== 'btn-pop' && e.animationName !== 'btn-highlight-pop') return
      if (e.animationName === 'btn-pop' && e.target.getAttribute(ATTR) === 'popping') {
        setPopState(e.target, null)
      }
    },
    { passive: true },
  )
}
