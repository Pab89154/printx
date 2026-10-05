/** Make `.btn` presses feel like a spring “pop” (visible even on quick taps). */

let pressedBtn: HTMLElement | null = null

function closestBtn(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null
  const el = target.closest('.btn')
  if (!(el instanceof HTMLElement)) return null
  if (el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true') return null
  return el
}

function releasePop(btn: HTMLElement) {
  btn.classList.remove('is-pressing')
  // Restart spring so rapid clicks always pop.
  btn.classList.remove('is-popping')
  void btn.offsetWidth
  btn.classList.add('is-popping')
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
      btn.classList.remove('is-popping')
      btn.classList.add('is-pressing')
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
      pressedBtn.classList.remove('is-pressing', 'is-popping')
      pressedBtn = null
    },
    { passive: true },
  )

  document.addEventListener(
    'animationend',
    (e) => {
      if (!(e.target instanceof HTMLElement)) return
      if (e.animationName !== 'btn-pop' && e.animationName !== 'btn-highlight-pop') return
      if (e.animationName === 'btn-pop') e.target.classList.remove('is-popping')
    },
    { passive: true },
  )
}
