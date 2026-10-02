import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import type { DashboardStats } from '../types/api'
import { adminPath } from '../lib/portal'

export function AdminDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null)

  useEffect(() => {
    api.admin.stats().then(setStats).catch(console.error)
  }, [])

  const online = stats?.websiteOnline !== false

  return (
    <div>
      <h1 className="text-2xl font-bold text-navy">Welcome to PrintX</h1>
      <p className="mt-1 text-muted">Here&apos;s what&apos;s happening with your business.</p>

      <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Next Stand" href={adminPath('stands')}>
          {stats?.nextStand ? (
            <>
              <p className="font-semibold text-navy">{stats.nextStand.schoolName}</p>
              <p className="text-sm text-muted">{stats.nextStand.displayDate}</p>
              <p className="text-sm text-muted">{stats.nextStand.startTime}</p>
            </>
          ) : (
            <p className="text-sm text-muted">No upcoming stands</p>
          )}
        </StatCard>

        <StatCard title="Inbox" href={adminPath('messages')}>
          <p className="text-3xl font-bold text-electric">{stats?.newMessages ?? '—'}</p>
          <p className="text-sm text-muted">New messages</p>
        </StatCard>

        <StatCard title="Custom Requests" href={adminPath('requests')}>
          <p className="text-3xl font-bold text-cyan">{stats?.newRequests ?? '—'}</p>
          <p className="text-sm text-muted">New requests</p>
        </StatCard>

        <StatCard title="Website" href={adminPath('settings')}>
          {online ? (
            <>
              <p className="text-lg font-semibold text-green-600">Online</p>
              <p className="text-sm text-muted">Public site is live</p>
            </>
          ) : (
            <>
              <p className="text-lg font-semibold text-amber-600">Paused</p>
              <p className="text-sm text-muted">Showing planning screen</p>
            </>
          )}
        </StatCard>
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link to={adminPath('stands')} className="rounded-xl bg-electric px-5 py-2.5 text-sm font-semibold text-white hover:bg-electric-light">
          + Add Stand
        </Link>
        <Link to={adminPath('sandbox')} className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-2.5 text-sm font-semibold text-amber-900 hover:border-amber-400">
          Open site sandbox
        </Link>
        <Link to={adminPath('messages')} className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-navy hover:border-electric">
          Open Inbox
        </Link>
        <Link to={adminPath('requests')} className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-navy hover:border-electric">
          View Requests
        </Link>
      </div>

      {!online && (
        <p className="mt-4 text-sm text-amber-700">
          Public site is paused. Use the{' '}
          <Link to={adminPath('sandbox')} className="font-semibold underline underline-offset-2">
            site sandbox
          </Link>{' '}
          to preview PrintX without turning the website back on.
        </p>
      )}
    </div>
  )
}

function StatCard({ title, href, children }: { title: string; href?: string; children: React.ReactNode }) {
  const inner = (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      <h3 className="text-sm font-bold uppercase tracking-wider text-muted">{title}</h3>
      <div className="mt-3">{children}</div>
    </div>
  )
  return href ? <Link to={href}>{inner}</Link> : inner
}
