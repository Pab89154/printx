import { Link } from 'react-router-dom'
import { ArrowLeft, FlaskConical } from 'lucide-react'
import { PublicSite } from '../pages/PublicSite'
import { adminPath } from '../lib/portal'

/** Full public site preview for signed-in admins — ignores the public pause switch. */
export function AdminSandbox() {
  return (
    <div className="min-h-screen bg-white">
      <div className="sticky top-0 z-[60] border-b border-amber-200 bg-amber-50 text-amber-950">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-2.5 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <FlaskConical size={16} className="shrink-0 text-amber-700" />
            <p className="font-medium">
              <span className="font-bold">Admin sandbox</span>
              <span className="hidden sm:inline">
                {' '}
                — try the full site here. Public visitors still see the paused screen if the website is offline.
              </span>
            </p>
          </div>
          <Link
            to={adminPath('dashboard')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm font-semibold text-amber-900 hover:bg-amber-100"
          >
            <ArrowLeft size={14} />
            Back to portal
          </Link>
        </div>
      </div>
      <PublicSite forceOnline />
    </div>
  )
}
