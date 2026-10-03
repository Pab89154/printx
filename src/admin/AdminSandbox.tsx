import { Link, Navigate } from 'react-router-dom'
import { ArrowLeft, ExternalLink, FlaskConical } from 'lucide-react'
import { firstAllowedAdminPath, publicSiteUrl } from '../lib/portal'
import { useAdminAuth } from '../context/AdminAuthContext'

/** Live printx.pw preview for signed-in admins — ignores the public pause switch. */
export function AdminSandbox() {
  const { can, permissions } = useAdminAuth()
  const backTo = firstAllowedAdminPath(permissions)
  if (!can('sandbox')) return <Navigate to={backTo} replace />

  const previewSrc = (() => {
    const base = publicSiteUrl('/')
    const url = new URL(base.endsWith('/') ? base : `${base}/`, window.location.origin)
    url.searchParams.set('admin_preview', '1')
    return url.toString()
  })()

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <div className="sticky top-0 z-[60] shrink-0 border-b border-amber-200 bg-amber-50 text-amber-950">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-2.5 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <FlaskConical size={16} className="shrink-0 text-amber-700" />
            <p className="font-medium">
              <span className="font-bold">Admin sandbox</span>
              <span className="hidden sm:inline">
                {' '}
                — exact live site preview. Public visitors still see the paused screen if the website is offline.
              </span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={previewSrc}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm font-semibold text-amber-900 hover:bg-amber-100"
            >
              <ExternalLink size={14} />
              Open live preview
            </a>
            <Link
              to={backTo}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm font-semibold text-amber-900 hover:bg-amber-100"
            >
              <ArrowLeft size={14} />
              Back to portal
            </Link>
          </div>
        </div>
      </div>
      <iframe
        title="PrintX live site preview"
        src={previewSrc}
        className="w-full flex-1 border-0"
        style={{ minHeight: 'calc(100vh - 3.25rem)' }}
      />
    </div>
  )
}
