import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import type { DashboardStats } from '../types/api'

export function AdminDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null)

  useEffect(() => {
    api.admin.stats().then(setStats).catch(console.error)
  }, [])

  return (
    <div>
      <h1 className="text-2xl font-bold text-navy">Welcome to PrintX</h1>
      <p className="mt-1 text-muted">Here&apos;s what&apos;s happening with your business.</p>

      <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Next Stand" href="/admin/stands">
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

        <StatCard title="Products" href="/admin/products">
          <p className="text-3xl font-bold text-electric">{stats?.activeProducts ?? '—'}</p>
          <p className="text-sm text-muted">Active products</p>
        </StatCard>

        <StatCard title="Custom Requests" href="/admin/requests">
          <p className="text-3xl font-bold text-cyan">{stats?.newRequests ?? '—'}</p>
          <p className="text-sm text-muted">New requests</p>
        </StatCard>

        <StatCard title="Website">
          <p className="flex items-center gap-2 text-lg font-semibold text-green-600">
            <img
              src="https://cdn.jsdelivr.net/npm/lucide-static@0.469.0/icons/circle-check.svg"
              alt=""
              className="h-5 w-5"
            />
            Online
          </p>
          <p className="text-sm text-muted">Public site is live</p>
        </StatCard>
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link to="/admin/stands" className="rounded-xl bg-electric px-5 py-2.5 text-sm font-semibold text-white hover:bg-electric-light">
          + Add Stand
        </Link>
        <Link to="/admin/products" className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-navy hover:border-electric">
          + Add Product
        </Link>
        <Link to="/admin/requests" className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-navy hover:border-electric">
          View Requests
        </Link>
      </div>
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
