import type { MouseEvent } from 'react'

function stickyOffset(): number {
  const header = document.querySelector('header')
  const banner = document.querySelector('[data-announcement-banner]')
  const headerH = header?.getBoundingClientRect().height ?? 0
  const bannerH = banner?.getBoundingClientRect().height ?? 0
  return headerH + bannerH + 12
}

function setHash(fragment: string) {
  const url = new URL(window.location.href)
  const next = `${url.pathname}${url.search}${fragment ? `#${fragment}` : ''}`
  history.pushState(null, '', next)
}

/** Smooth-scroll to an in-page hash target (works with sticky headers + query strings). */
export function scrollToHash(hash: string) {
  const id = hash.startsWith('#') ? hash.slice(1) : hash

  if (!id || id === 'home') {
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setHash(id === 'home' ? 'home' : '')
    return
  }

  const el = document.getElementById(id)
  if (!el) return

  // Ensure scroll-reveal wrappers are visible before scrolling into view
  el.classList.add('visible')
  el.querySelectorAll('.reveal').forEach((node) => node.classList.add('visible'))

  const top = el.getBoundingClientRect().top + window.scrollY - stickyOffset()
  window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
  setHash(id)
}

export function onHashLinkClick(event: MouseEvent<HTMLAnchorElement>, href: string) {
  if (!href.startsWith('#')) return
  event.preventDefault()
  event.stopPropagation()
  scrollToHash(href)
}
