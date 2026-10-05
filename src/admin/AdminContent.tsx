import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { WebsiteContent } from '../types/api'

const inputClass =
  'w-full rounded-xl border border-slate-200 px-3 py-2.5 text-base outline-none focus:border-electric focus:ring-2 focus:ring-electric/20 sm:text-sm'

export function AdminContent() {
  const [content, setContent] = useState<WebsiteContent | null>(null)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [bannerSaving, setBannerSaving] = useState(false)
  const [error, setError] = useState('')
  const [bannerMessage, setBannerMessage] = useState('')

  useEffect(() => {
    api.admin.content
      .get()
      .then(setContent)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load content'))
  }, [])

  async function save() {
    if (!content || saving) return
    setSaving(true)
    setError('')
    try {
      const next = await api.admin.content.update(content)
      setContent(next)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save content')
    } finally {
      setSaving(false)
    }
  }

  async function toggleAnnouncement(enabled: boolean) {
    if (!content || bannerSaving) return
    const previous = content
    setContent({ ...content, announcementEnabled: enabled })
    setBannerSaving(true)
    setBannerMessage('')
    setError('')
    try {
      const next = await api.admin.content.update({
        announcementEnabled: enabled,
        announcementText: content.announcementText,
        announcementExpiresAt: content.announcementExpiresAt,
      })
      setContent(next)
      if (enabled && next.websiteOnline === false) {
        setBannerMessage(
          'Banner is on, but the public site is paused — visitors won’t see it until you turn the website back on in Settings.',
        )
      } else if (enabled && !next.announcementText?.trim()) {
        setBannerMessage('Banner is on, but it stays hidden until you add announcement text and save.')
      } else {
        setBannerMessage(enabled ? 'Announcement banner is on.' : 'Announcement banner is off.')
      }
    } catch (e) {
      setContent(previous)
      setError(e instanceof Error ? e.message : 'Could not update announcement banner')
    } finally {
      setBannerSaving(false)
    }
  }

  if (!content) {
    return <p className="text-muted">{error || 'Loading…'}</p>
  }

  const sitePaused = content.websiteOnline === false

  return (
    <div>
      <h1 className="text-2xl font-bold text-navy">Website Content</h1>
      <p className="mt-1 text-muted">Edit homepage, about, contact, and announcement content.</p>

      {error && (
        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      <div className="mt-6 space-y-8">
        <Section title="Homepage">
          <label>Hero headline<input className={inputClass} value={content.heroHeadline} onChange={(e) => setContent({ ...content, heroHeadline: e.target.value })} /></label>
          <label className="mt-3 block">Hero description<textarea className={inputClass} rows={2} value={content.heroDescription} onChange={(e) => setContent({ ...content, heroDescription: e.target.value })} /></label>
        </Section>

        <Section title="Announcement">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={content.announcementEnabled}
              disabled={bannerSaving}
              onChange={(e) => void toggleAnnouncement(e.target.checked)}
            />
            Show announcement banner on the public site
          </label>
          {bannerMessage && (
            <p className={`mt-2 text-xs ${sitePaused && content.announcementEnabled ? 'text-amber-700' : 'text-muted'}`}>
              {bannerMessage}
            </p>
          )}
          {sitePaused && content.announcementEnabled && !bannerMessage && (
            <p className="mt-2 text-xs text-amber-700">
              Public site is paused — the banner won’t appear for visitors until the website is online again (Settings).
            </p>
          )}
          <label className="mt-3 block">
            Announcement text
            <input
              className={inputClass}
              value={content.announcementText}
              onChange={(e) => setContent({ ...content, announcementText: e.target.value })}
              placeholder="Next PrintX stand this Friday!"
            />
          </label>
          <label className="mt-3 block">
            Expiration date (optional)
            <input
              type="date"
              className={inputClass}
              value={content.announcementExpiresAt ?? ''}
              onChange={(e) => setContent({ ...content, announcementExpiresAt: e.target.value || null })}
            />
          </label>
          <p className="mt-2 text-xs text-muted">
            The on/off switch saves immediately. Text and expiration still need <span className="font-medium">Save All Changes</span>.
            Leave the date blank for no end date.
          </p>
          {content.announcementEnabled && !content.announcementText.trim() && (
            <p className="mt-2 text-xs text-amber-700">Add announcement text, or the banner will stay hidden.</p>
          )}
        </Section>

        <Section title="About">
          <label>About text<textarea className={inputClass} rows={4} value={content.aboutText} onChange={(e) => setContent({ ...content, aboutText: e.target.value })} /></label>
          <label className="mt-3 block">Team information<textarea className={inputClass} rows={2} value={content.aboutTeam} onChange={(e) => setContent({ ...content, aboutTeam: e.target.value })} /></label>
        </Section>

        <Section title="Contact">
          <label>Email<input className={inputClass} value={content.contactEmail} onChange={(e) => setContent({ ...content, contactEmail: e.target.value })} /></label>
          <label className="mt-3 block">Instagram URL<input className={inputClass} value={content.contactInstagram} onChange={(e) => setContent({ ...content, contactInstagram: e.target.value })} /></label>
          <label className="mt-3 block">WhatsApp channel URL<input className={inputClass} placeholder="https://whatsapp.com/channel/..." value={content.contactWhatsapp ?? ''} onChange={(e) => setContent({ ...content, contactWhatsapp: e.target.value })} /></label>
        </Section>

        <Section title="For Schools">
          <label>Description<textarea className={inputClass} rows={3} value={content.forSchoolsDescription} onChange={(e) => setContent({ ...content, forSchoolsDescription: e.target.value })} /></label>
          <label className="mt-3 block">Contact instructions<textarea className={inputClass} rows={2} value={content.forSchoolsInstructions} onChange={(e) => setContent({ ...content, forSchoolsInstructions: e.target.value })} /></label>
        </Section>
      </div>

      <button type="button" onClick={() => void save()} disabled={saving} className="btn btn-primary mt-8">
        {saving ? 'Saving…' : saved ? 'Saved!' : 'Save All Changes'}
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
