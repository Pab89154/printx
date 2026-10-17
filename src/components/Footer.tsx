import { AtSign, Mail, MessageCircle } from 'lucide-react'
import { usePublicData } from '../context/PublicDataContext'
import { FOOTER_LINKS } from '../data/navigation'
import { onHashLinkClick } from '../lib/scroll'
import { Logo } from './Logo'

export function Footer() {
  const { data } = usePublicData()
  const contactInstagram = (data?.content?.contactInstagram || '').trim()
  const contactWhatsapp = (data?.content?.contactWhatsapp || '').trim()
  const hasStands = (data?.stands?.length ?? 0) > 0
  const links = FOOTER_LINKS.filter((link) => link.href !== '#stands' || hasStands)

  // Contact uses the on-site form → portal inbox (no mailto / mail app).
  const socialLinks = [
    {
      label: 'Instagram',
      href: contactInstagram || undefined,
      Icon: AtSign,
    },
    {
      label: 'WhatsApp',
      href: contactWhatsapp || undefined,
      Icon: MessageCircle,
    },
    {
      label: 'Message',
      href: '#contact',
      Icon: Mail,
    },
  ]

  return (
    <footer className="bg-navy text-white">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2 lg:col-span-1">
            <Logo
              size={40}
              withWordmark
              light
              subtitle="3D Printing • DFW Area"
            />
            <p className="mt-4 text-sm leading-relaxed text-slate-400">
              Made locally in the DFW area.
            </p>
          </div>

          <div>
            <h3 className="mb-4 text-sm font-bold uppercase tracking-wider text-slate-300">
              Links
            </h3>
            <ul className="space-y-2.5">
              {links.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href.startsWith('#') ? `/${link.href}` : link.href}
                    className="text-sm text-slate-400 transition-colors hover:text-cyan"
                    onClick={(e) => onHashLinkClick(e, link.href)}
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="mb-4 text-sm font-bold uppercase tracking-wider text-slate-300">
              Contact
            </h3>
            <ul className="space-y-2.5 text-sm text-slate-400">
              <li>Dallas–Fort Worth, TX</li>
              <li>
                <a
                  href="/#contact"
                  className="transition-colors hover:text-cyan"
                  onClick={(e) => onHashLinkClick(e, '#contact')}
                >
                  Contact form
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="mb-4 text-sm font-bold uppercase tracking-wider text-slate-300">
              Follow Us
            </h3>
            <div className="flex gap-3">
              {socialLinks.map(({ label, href, Icon }) => {
                const isHash = Boolean(href?.startsWith('#'))
                const enabled = Boolean(href)
                const className =
                  'flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 text-slate-400 transition-all hover:border-cyan/50 hover:bg-cyan/10 hover:text-cyan'

                if (!enabled) {
                  return (
                    <span
                      key={label}
                      title={`${label} link coming soon`}
                      aria-label={`${label} (link not set yet)`}
                      className={`${className} cursor-default opacity-70`}
                    >
                      <Icon size={18} />
                    </span>
                  )
                }

                return (
                  <a
                    key={label}
                    href={isHash ? `/${href}` : href}
                    target={isHash ? undefined : '_blank'}
                    rel={isHash ? undefined : 'noopener noreferrer'}
                    aria-label={label}
                    className={className}
                    onClick={isHash ? (e) => onHashLinkClick(e, href!) : undefined}
                  >
                    <Icon size={18} />
                  </a>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </footer>
  )
}
