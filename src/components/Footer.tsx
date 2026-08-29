import { AtSign, Mail, MessageCircle } from 'lucide-react'
import { usePublicData } from '../context/PublicDataContext'
import { FOOTER_LINKS } from '../data/navigation'
import { mailtoHref } from '../lib/mailto'
import { Logo } from './Logo'

export function Footer() {
  const { data } = usePublicData()
  const contactEmail = data?.content?.contactEmail ?? 'hello@printx.pw'
  const contactInstagram = data?.content?.contactInstagram ?? ''
  const contactWhatsapp = data?.content?.contactWhatsapp ?? ''
  const emailDraftHref = mailtoHref(contactEmail, { subject: 'Hello PrintX' })

  const socialLinks = [
    { label: 'Instagram', href: contactInstagram, Icon: AtSign },
    { label: 'WhatsApp', href: contactWhatsapp, Icon: MessageCircle },
    { label: 'Email', href: emailDraftHref, Icon: Mail },
  ].filter((link) => Boolean(link.href))

  return (
    <footer className="bg-navy text-white">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2 lg:col-span-1">
            <Logo
              size={40}
              withWordmark
              light
              subtitle="3D Printing • McKinney, TX"
            />
            <p className="mt-4 text-sm leading-relaxed text-slate-400">
              Made locally in McKinney, Texas.
            </p>
          </div>

          <div>
            <h3 className="mb-4 text-sm font-bold uppercase tracking-wider text-slate-300">
              Links
            </h3>
            <ul className="space-y-2.5">
              {FOOTER_LINKS.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    className="text-sm text-slate-400 transition-colors hover:text-cyan"
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
              <li>McKinney, Texas</li>
              <li>
                <a href={emailDraftHref} className="transition-colors hover:text-cyan">
                  {contactEmail}
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
                const isMail = href.startsWith('mailto:')
                return (
                  <a
                    key={label}
                    href={href}
                    target={isMail ? undefined : '_blank'}
                    rel={isMail ? undefined : 'noopener noreferrer'}
                    aria-label={label}
                    className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 text-slate-400 transition-all hover:border-cyan/50 hover:bg-cyan/10 hover:text-cyan"
                  >
                    <Icon size={18} />
                  </a>
                )
              })}
            </div>
          </div>
        </div>

        <div className="mt-12 border-t border-white/10 pt-8 text-center text-sm text-slate-500">
          © {new Date().getFullYear()} PrintX. All rights reserved.
        </div>
      </div>
    </footer>
  )
}
