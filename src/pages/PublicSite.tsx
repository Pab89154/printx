import { About } from '../components/About'
import { AnnouncementBanner } from '../components/AnnouncementBanner'
import { Contact } from '../components/Contact'
import { CustomPrinting } from '../components/CustomPrinting'
import { FeedbackButton } from '../components/FeedbackButton'
import { Footer } from '../components/Footer'
import { ForSchools } from '../components/ForSchools'
import { Header } from '../components/Header'
import { Hero } from '../components/Hero'
import { HowToBuy } from '../components/HowToBuy'
import { SitePausedScreen } from '../components/SitePausedScreen'
import { WhatWePrint } from '../components/WhatWePrint'
import { WhereToFindUs } from '../components/WhereToFindUs'
import { WhyPrintX } from '../components/WhyPrintX'
import { useAdminAuth } from '../context/AdminAuthContext'
import { usePublicData } from '../context/PublicDataContext'

type Props = {
  /** When true, show the live site even if the public site is paused. */
  forceOnline?: boolean
}

function usePreviewUnlocked(forceOnline: boolean): { ready: boolean; unlocked: boolean } {
  const { authenticated } = useAdminAuth()
  const isPreview =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('admin_preview') === '1'

  if (forceOnline) return { ready: true, unlocked: true }
  if (!isPreview) return { ready: true, unlocked: false }
  // Wait for AdminAuthProvider's /me check (same cookie the iframe shares).
  if (authenticated === null) return { ready: false, unlocked: false }
  return { ready: true, unlocked: authenticated === true }
}

export function PublicSite({ forceOnline = false }: Props) {
  const { data, loading, error } = usePublicData()
  const preview = usePreviewUnlocked(forceOnline)

  if (loading || !preview.ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <p className="text-muted">Loading PrintX…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white p-4">
        <p className="text-red-600">Unable to load site: {error}</p>
      </div>
    )
  }

  if (!preview.unlocked && data?.content?.websiteOnline === false) {
    return <SitePausedScreen />
  }

  return (
    <div className="min-h-screen">
      {data?.announcementActive && data.content.announcementText?.trim() ? (
        <AnnouncementBanner text={data.content.announcementText} />
      ) : null}
      <Header />
      <main>
        <Hero />
        <WhatWePrint />
        <WhereToFindUs />
        <HowToBuy />
        <CustomPrinting />
        <ForSchools />
        <WhyPrintX />
        <About />
        <Contact />
      </main>
      <Footer />
      <FeedbackButton />
    </div>
  )
}
