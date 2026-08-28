import { AtSign, Layers3, Mail, Music2 } from 'lucide-react'
import { usePublicData } from '../context/PublicDataContext'
import { FOOTER_LINKS, SOCIAL_LINKS } from '../data/navigation'

const socialIcons: Record<string, typeof AtSign> = {
  Instagram: AtSign,
  TikTok: Music2,
  Email: Mail,
}

export function Footer() {
  const { data } = usePublicData()
  const contactEmail = data?.content?.contactEmail ?? 'hello@printx.pw'

  return (
    <footer className="bg-navy text-white">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2 lg:col-span-1">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-electric to-cyan">
                <Layers3 size={20} strokeWidth={2.5} />
              </div>
              <div>
                <div className="text-lg font-extrabold">PrintX</div>
                <div className="text-xs text-slate-400">3D Printing • McKinney, TX</div>
              </div>
            </div>
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
                <a href={`mailto:${contactEmail}`} className="transition-colors hover:text-cyan">
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
              {SOCIAL_LINKS.map((social) => {
                const Icon = socialIcons[social.label] ?? Mail
                return (
                  <a
                    key={social.label}
                    href={social.href}
                    aria-label={social.label}
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
