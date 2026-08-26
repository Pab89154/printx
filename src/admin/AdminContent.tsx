import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { WebsiteContent } from '../types/api'

const inputClass =
  'w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-electric focus:ring-2 focus:ring-electric/20'

export function AdminContent() {
  const [content, setContent] = useState<WebsiteContent | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    api.admin.content.get().then(setContent)
  }, [])

  async function save() {
    if (!content) return
    await api.admin.content.update(content)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  if (!content) return <p>Loading…</p>

  return (
    <div>
      <h1 className="text-2xl font-bold text-navy">Website Content</h1>
      <p className="mt-1 text-muted">Edit homepage, about, contact, and announcement content.</p>

      <div className="mt-6 space-y-8">
        <Section title="Homepage">
          <label>Hero headline<input className={inputClass} value={content.heroHeadline} onChange={(e) => setContent({ ...content, heroHeadline: e.target.value })} /></label>
          <label className="mt-3 block">Hero description<textarea className={inputClass} rows={2} value={content.heroDescription} onChange={(e) => setContent({ ...content, heroDescription: e.target.value })} /></label>
        </Section>

        <Section title="Announcement">
          <label className="flex items-center gap-2"><input type="checkbox" checked={content.announcementEnabled} onChange={(e) => setContent({ ...content, announcementEnabled: e.target.checked })} /> Enable announcement on homepage</label>
          <label className="mt-3 block">Announcement text<input className={inputClass} value={content.announcementText} onChange={(e) => setContent({ ...content, announcementText: e.target.value })} /></label>
          <label className="mt-3 block">Expiration date<input type="date" className={inputClass} value={content.announcementExpiresAt ?? ''} onChange={(e) => setContent({ ...content, announcementExpiresAt: e.target.value || null })} /></label>
        </Section>

        <Section title="About">
          <label>About text<textarea className={inputClass} rows={4} value={content.aboutText} onChange={(e) => setContent({ ...content, aboutText: e.target.value })} /></label>
          <label className="mt-3 block">Team information<textarea className={inputClass} rows={2} value={content.aboutTeam} onChange={(e) => setContent({ ...content, aboutTeam: e.target.value })} /></label>
        </Section>

        <Section title="Contact">
          <label>Email<input className={inputClass} value={content.contactEmail} onChange={(e) => setContent({ ...content, contactEmail: e.target.value })} /></label>
          <label className="mt-3 block">Instagram URL<input className={inputClass} value={content.contactInstagram} onChange={(e) => setContent({ ...content, contactInstagram: e.target.value })} /></label>
          <label className="mt-3 block">TikTok URL<input className={inputClass} value={content.contactTiktok} onChange={(e) => setContent({ ...content, contactTiktok: e.target.value })} /></label>
        </Section>

        <Section title="For Schools">
          <label>Description<textarea className={inputClass} rows={3} value={content.forSchoolsDescription} onChange={(e) => setContent({ ...content, forSchoolsDescription: e.target.value })} /></label>
          <label className="mt-3 block">Contact instructions<textarea className={inputClass} rows={2} value={content.forSchoolsInstructions} onChange={(e) => setContent({ ...content, forSchoolsInstructions: e.target.value })} /></label>
        </Section>
      </div>

      <button type="button" onClick={save} className="mt-8 rounded-xl bg-electric px-6 py-3 text-sm font-semibold text-white">
        {saved ? 'Saved!' : 'Save All Changes'}
      </button>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border bg-white p-6">
      <h2 className="mb-4 text-lg font-semibold text-navy">{title}</h2>
      {children}
    </div>
  )
}
