import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import type { DashboardStats } from '../types/api'
import type { MoneySummaryDto } from '../types/catalog'
import { adminPath } from '../lib/portal'
import { useAdminAuth } from '../context/AdminAuthContext'
import { SandboxIcon } from '../lib/sandboxIcon'

function currentUtcMonth(): string {
  const now = new Date()
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  if (!y || !m) return ym
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export function AdminDashboard() {
  const { can, email } = useAdminAuth()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [money, setMoney] = useState<MoneySummaryDto | null>(null)

  useEffect(() => {
    if (!can('dashboard')) return
    api.admin.stats().then(setStats).catch(console.error)
  }, [can])

  useEffect(() => {
    if (!can('orders')) return
    api.catalog.money
      .get(currentUtcMonth())
      .then(setMoney)
      .catch(console.error)
  }, [can])

  const owedToMeUsd = useMemo(() => {
    if (!money || !email) return 0
    const me = email.trim().toLowerCase()
    const mine = money.owedByPerson.find((p) => p.email.trim().toLowerCase() === me)
    return mine?.totalOwedUsd ?? 0
  }, [money, email])

  const online = stats?.websiteOnline !== false

  const cards = [
    can('stands') && (
      <StatCard key="stands" title="Next Stand" href={adminPath('stands')}>
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
    ),
    can('messages') && (
      <StatCard key="messages" title="Inbox" href={adminPath('messages')}>
        <p className="text-3xl font-bold leading-none text-electric">{stats?.newMessages ?? '—'}</p>
        <p className="text-sm text-muted">New messages</p>
      </StatCard>
    ),
    can('requests') && (
      <StatCard key="requests" title="Custom Requests" href={adminPath('requests')}>
        <p className="text-3xl font-bold leading-none text-cyan">{stats?.newRequests ?? '—'}</p>
        <p className="text-sm text-muted">New requests</p>
      </StatCard>
    ),
    (can('settings') || can('website_status')) && (
      <StatCard
        key="website"
        title="Website"
        href={can('settings') ? adminPath('settings') : undefined}
      >
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
    ),
  ].filter(Boolean)

  const actions = [
    can('stands') && (
      <Link key="add-stand" to={adminPath('stands')} className="btn btn-primary">
        + Add Stand
      </Link>
    ),
    can('sandbox') && (
      <Link
        key="sandbox"
        to={adminPath('sandbox')}
        className="btn btn-secondary !border-amber-300 !bg-amber-50 !text-amber-900 hover:!border-amber-500 hover:!bg-amber-100 hover:!text-amber-950"
      >
        <SandboxIcon size={16} className="text-amber-500" />
        Open site sandbox
      </Link>
    ),
    can('messages') && (
      <Link key="inbox" to={adminPath('messages')} className="btn btn-secondary">
        Open Inbox
      </Link>
    ),
    can('requests') && (
      <Link key="requests" to={adminPath('requests')} className="btn btn-secondary">
        View Requests
      </Link>
    ),
    can('products') && (
      <Link key="designs" to={adminPath('designs')} className="btn btn-secondary">
        Designs
      </Link>
    ),
  ].filter(Boolean)

  return (
    <div>
      <h1 className="text-2xl font-bold text-navy">Welcome to PrintX</h1>
      <p className="mt-1 text-muted">Here&apos;s what&apos;s happening with your business.</p>

      {can('orders') && (
        <Link
          to={adminPath('money')}
          className="mt-8 block rounded-3xl border-2 border-electric/25 bg-gradient-to-br from-navy to-[#132038] p-6 text-white shadow-lg transition hover:border-electric/50 hover:shadow-xl sm:p-8"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-electric">Money</p>
              <p className="mt-1 text-base text-white/75">
                {money ? monthLabel(money.month) : 'This month'} · tap for full breakdown
              </p>
            </div>
            <span className="rounded-full bg-electric/20 px-3 py-1 text-xs font-semibold text-electric">
              Open Money →
            </span>
          </div>
          <div className="mt-6 grid gap-6 sm:grid-cols-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-white/55">
                From Stripe
              </p>
              <p className="mt-2 text-4xl font-extrabold tracking-tight tabular-nums sm:text-5xl">
                {money ? `$${money.earnings.totalUsd.toFixed(2)}` : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-white/55">
                Owed to me
              </p>
              <p className="mt-2 text-4xl font-extrabold tracking-tight tabular-nums text-cyan sm:text-5xl">
                {money ? `$${owedToMeUsd.toFixed(2)}` : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-white/55">
                Business kept
              </p>
              <p className="mt-2 text-4xl font-extrabold tracking-tight tabular-nums text-electric sm:text-5xl">
                {money ? `$${money.businessKeptUsd.toFixed(2)}` : '—'}
              </p>
            </div>
          </div>
          {money?.totals && (
            <p className="mt-5 text-sm text-white/60">
              Year Stripe ${money.totals.year.stripeUsd.toFixed(2)} · All time $
              {money.totals.allTime.stripeUsd.toFixed(2)}
            </p>
          )}
        </Link>
      )}

      {cards.length > 0 ? (
        <div className="mt-8 grid items-stretch gap-6 sm:grid-cols-2 lg:grid-cols-4">{cards}</div>
      ) : (
        !can('orders') && (
          <p className="mt-8 rounded-xl border border-dashed bg-white p-8 text-center text-muted">
            No dashboard widgets are available for your account.
          </p>
        )
      )}

      {actions.length > 0 && (
        <div className="mt-8 flex flex-wrap items-center gap-3">{actions}</div>
      )}

      {!online && can('sandbox') && (
        <p className="mt-6 text-sm text-amber-700">
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
    <div className="flex h-full min-h-[8.5rem] flex-col rounded-2xl border border-slate-100 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      <h3 className="text-sm font-bold uppercase tracking-wider text-muted">{title}</h3>
      <div className="mt-3 flex flex-1 flex-col justify-center gap-1">{children}</div>
    </div>
  )
  return href ? (
    <Link to={href} className="block h-full">
      {inner}
    </Link>
  ) : (
    inner
  )
}
