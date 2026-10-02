import { Megaphone } from 'lucide-react'

type Props = {
  text: string
}

export function AnnouncementBanner({ text }: Props) {
  const message = text.trim()
  if (!message) return null

  return (
    <div className="brand-banner text-white">
      <div className="mx-auto flex max-w-6xl items-center justify-center gap-2.5 px-4 py-2.5 text-center text-sm font-semibold sm:px-6 sm:text-base lg:px-8">
        <Megaphone size={18} className="hidden shrink-0 sm:block" aria-hidden />
        <p>{message}</p>
      </div>
    </div>
  )
}
