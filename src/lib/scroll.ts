import type { MouseEvent } from 'react'

/** Smooth-scroll to an in-page hash target (works reliably with sticky headers). */
export function scrollToHash(hash: string) {
  const id = hash.startsWith('#') ? hash.slice(1) : hash
  if (!id || id === 'home') {
    window.scrollTo({ top: 0, behavior: 'smooth' })
    if (id === 'home') history.pushState(null, '', '#home')
    else history.pushState(null, '', window.location.pathname)
    return
  }

  const el = document.getElementById(id)
  if (!el) return

  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  history.pushState(null, '', `#${id}`)
}

export function onHashLinkClick(event: MouseEvent<HTMLAnchorElement>, href: string) {
  if (!href.startsWith('#')) return
  event.preventDefault()
  scrollToHash(href)
}
