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
import { usePublicData } from '../context/PublicDataContext'

type Props = {
  /** Admin sandbox: always show the full site, never the paused screen. */
  forceOnline?: boolean
}

export function PublicSite({ forceOnline = false }: Props) {
  const { data, loading, error } = usePublicData()

  if (loading) {
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

  if (!forceOnline && data?.content?.websiteOnline === false) {
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
