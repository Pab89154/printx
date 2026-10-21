import { useEffect, useLayoutEffect } from 'react'
import { useLocation } from 'react-router-dom'

function stickyOffset(): number {
  const header = document.querySelector('header')
  const banner = document.querySelector('[data-announcement-banner]')
  const headerH = header?.getBoundingClientRect().height ?? 0
  const bannerH = banner?.getBoundingClientRect().height ?? 0
  return headerH + bannerH + 12
}

/**
 * Every route change opens at the top of the new page.
 *
 * Root cause of the "new page opens at the bottom" bug: React Router's
 * <BrowserRouter> never resets scroll on navigation, and the browser
 * (history.scrollRestoration = "auto") keeps the old scroll position.
 * When the new page first renders short (e.g. a "Loading…" state), the
 * browser clamps that old position to the bottom of the short page —
 * and it stays there when the real content grows in.
 *
 * Hash links (/#custom, /terms-and-conditions#cash) are the one
 * exception: they must still land on their named section.
 */
export function ScrollToTop() {
  const { pathname, search, hash, key } = useLocation()

  // We manage scroll ourselves; stop the browser restoring old positions.
  useEffect(() => {
    if (!('scrollRestoration' in window.history)) return
    const previous = window.history.scrollRestoration
    window.history.scrollRestoration = 'manual'
    return () => {
      window.history.scrollRestoration = previous
    }
  }, [])

  useLayoutEffect(() => {
    if (!hash || hash === '#home') {
      // 'instant' (not 'auto') so `scroll-behavior: smooth` in CSS
      // cannot turn this into a slow crawl up from the old position.
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior })
      return
    }

    let id = hash.slice(1)
    try {
      id = decodeURIComponent(id)
    } catch {
      // Keep the raw id if it is not decodable.
    }
    if (!id) {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior })
      return
    }

    let cancelled = false
    let timer: number | undefined

    const tryScrollToTarget = (): boolean => {
      const el = document.getElementById(id)
      if (!el) return false
      // Match scrollToHash(): reveal wrappers inside the section must
      // be visible, or the user lands on a blank-looking area.
      el.classList.add('visible')
      el.querySelectorAll('.reveal').forEach((node) => node.classList.add('visible'))
      const top = el.getBoundingClientRect().top + window.scrollY - stickyOffset()
      window.scrollTo({ top: Math.max(0, top), left: 0, behavior: 'instant' as ScrollBehavior })
      return true
    }

    // The target may not exist yet (e.g. the home page shows its
    // loading state first) — retry briefly until it mounts.
    if (!tryScrollToTarget()) {
      let attempts = 0
      timer = window.setInterval(() => {
        attempts += 1
        if (cancelled || tryScrollToTarget() || attempts >= 40) {
          window.clearInterval(timer)
        }
      }, 100)
    }

    return () => {
      cancelled = true
      if (timer !== undefined) window.clearInterval(timer)
    }
  }, [pathname, search, hash, key])

  return null
}
