import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { AsyncLocalStorage } from 'node:async_hooks'
import pg from 'pg'

export type QueryResult = { changes: number }

/** Shared async DB API used by PrintX (SQLite locally, Postgres/Supabase in production). */
export type DbApi = {
  exec(sql: string): Promise<void>
  run(sql: string, ...params: unknown[]): Promise<QueryResult>
  get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | undefined>
  all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]>
}

function resolveDataDir(): string {
  const fromEnv = process.env.PRINTX_DATA_DIR?.trim()
  if (fromEnv) return fromEnv
  // Workers bundle has no usable import.meta.url for file paths; local Node does.
  try {
    const metaUrl = import.meta.url
    if (typeof metaUrl === 'string' && metaUrl.startsWith('file:')) {
      return path.join(path.dirname(fileURLToPath(metaUrl)), '..', 'data')
    }
  } catch {
    /* Cloudflare Workers / non-file URL */
  }
  return '/tmp/printx-data'
}

export const DATA_DIR = resolveDataDir()
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads')

/** Workers skip the DB bootstrap mkdir; formidable still needs this directory. */
export function ensureUploadsDir(): string {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true })
  return UPLOADS_DIR
}

function toPgPlaceholders(sql: string): string {
  let i = 0
  return sql.replace(/\?/g, () => `$${++i}`)
}

function splitSqlStatements(sql: string): string[] {
  return sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function isPoolExhaustedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return (
    msg.includes('EMAXCONNSESSION') ||
    msg.includes('max clients reached') ||
    msg.includes('too many clients') ||
    msg.includes('Cannot use a pool after calling end')
  )
}

/** Supabase session pooler (:5432) allows few clients — never open more than one here. */
function isSessionPoolerUrl(databaseUrl: string): boolean {
  try {
    const u = new URL(databaseUrl)
    return u.port === '5432' || u.hostname.includes('pooler.supabase')
  } catch {
    return databaseUrl.includes(':5432') || databaseUrl.includes('pooler.supabase')
  }
}

let api: DbApi | null = null
let pool: pg.Pool | null = null
let generation = 0
let openPromise: Promise<DbApi> | null = null
let closePromise: Promise<void> | null = null
/** Serialize every query so one process never needs >1 session-pooler client. */
let queryChain: Promise<unknown> = Promise.resolve()

function enqueueQuery<T>(work: () => Promise<T>): Promise<T> {
  const run = queryChain.then(work, work)
  // Keep the chain alive even when a query fails.
  queryChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

async function poolQuery(
  activePool: pg.Pool,
  gen: number,
  getGeneration: () => number,
  sql: string,
  params: unknown[] = [],
  attempts = 6,
) {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    if (getGeneration() !== gen) {
      throw new Error('Database connection was restarted')
    }
    try {
      return await enqueueQuery(() => activePool.query(sql, params))
    } catch (err) {
      lastErr = err
      if (!isPoolExhaustedError(err) || i === attempts - 1) throw err
      const waitMs = Math.min(6_000, 300 * 2 ** i)
      console.warn(
        `[printx] Postgres session pool busy (attempt ${i + 1}/${attempts}); retry in ${waitMs}ms`,
      )
      await new Promise((r) => setTimeout(r, waitMs))
    }
  }
  throw lastErr
}

function createPostgresApi(activePool: pg.Pool, gen: number, getGeneration: () => number): DbApi {
  return {
    async exec(sql: string) {
      for (const statement of splitSqlStatements(sql)) {
        await poolQuery(activePool, gen, getGeneration, statement)
      }
    },
    async run(sql: string, ...params: unknown[]) {
      const result = await poolQuery(activePool, gen, getGeneration, toPgPlaceholders(sql), params)
      return { changes: result.rowCount ?? 0 }
    },
    async get<T = Record<string, unknown>>(sql: string, ...params: unknown[]) {
      const result = await poolQuery(activePool, gen, getGeneration, toPgPlaceholders(sql), params)
      return result.rows[0] as T | undefined
    },
    async all<T = Record<string, unknown>>(sql: string, ...params: unknown[]) {
      const result = await poolQuery(activePool, gen, getGeneration, toPgPlaceholders(sql), params)
      return result.rows as T[]
    },
  }
}

/**
 * Request-scoped DB connection (AsyncLocalStorage).
 *
 * Cloudflare forbids using an I/O object created during one request in a
 * different request ("Cannot perform I/O on behalf of a different
 * request"), so a per-isolate shared client is illegal. But a fresh
 * connection per query storms Hyperdrive/Supavisor when a page fires
 * many requests at once — connects queue for 25s+ and everything starves.
 *
 * The middle path: ONE pg Client per request scope. cfAdapter wraps each
 * API request in runWithDbScope(); cron wraps its whole run. All queries
 * inside the scope share that client (pg serializes on the wire), the
 * client is ended when the scope ends, and no socket ever crosses a
 * request boundary. Outside any scope, falls back to per-query clients.
 * Every query keeps an 8s hard timeout so a dead socket fails fast, and
 * connection-ish errors drop the client — reads retry once on a fresh
 * one, writes never auto-retry (they may already have landed).
 */
type DbScope = { client: pg.Client | null; connecting: Promise<pg.Client> | null }

const dbScope = new AsyncLocalStorage<DbScope>()

export async function runWithDbScope<T>(fn: () => Promise<T>): Promise<T> {
  if (dbScope.getStore()) return fn()
  const scope: DbScope = { client: null, connecting: null }
  try {
    return await dbScope.run(scope, fn)
  } finally {
    const current = scope.client
    scope.client = null
    scope.connecting = null
    if (current) {
      try {
        await current.end()
      } catch {
        /* ignore */
      }
    }
  }
}

const CONNECTION_ERROR =
  /connection terminated|terminated unexpectedly|econnreset|etimedout|connection ended|socket hang up|query read timeout|timeout expired|client was closed|Cannot perform I\/O/i

function createPostgresClientApi(connectionString: string): DbApi {
  const ssl =
    connectionString.includes('localhost') || connectionString.includes('127.0.0.1')
      ? undefined
      : { rejectUnauthorized: false }

  function makeClient(): pg.Client {
    return new pg.Client({
      connectionString,
      ssl,
      connectionTimeoutMillis: 5_000,
      query_timeout: 8_000,
      statement_timeout: 8_000,
      keepAlive: true,
    })
  }

  async function scopeClient(scope: DbScope): Promise<pg.Client> {
    if (scope.client) return scope.client
    if (!scope.connecting) {
      scope.connecting = (async () => {
        const created = makeClient()
        created.on('error', () => {
          if (scope.client === created) scope.client = null
        })
        await created.connect()
        scope.client = created
        scope.connecting = null
        return created
      })().catch((err) => {
        scope.connecting = null
        throw err
      })
    }
    return scope.connecting
  }

  function dropScopeClient(scope: DbScope) {
    const current = scope.client
    scope.client = null
    if (current) {
      void current.end().catch(() => undefined)
    }
  }

  async function withClient<T>(fn: (c: pg.Client) => Promise<T>, retryable: boolean): Promise<T> {
    const scope = dbScope.getStore()
    if (!scope) {
      // No request scope (bootstrap probe, stray background work): one-off client.
      const created = makeClient()
      await created.connect()
      try {
        return await fn(created)
      } finally {
        try {
          await created.end()
        } catch {
          /* ignore */
        }
      }
    }
    try {
      return await fn(await scopeClient(scope))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!CONNECTION_ERROR.test(msg)) throw err
      dropScopeClient(scope)
      if (!retryable) throw err
      return fn(await scopeClient(scope))
    }
  }

  return {
    async exec(sql: string) {
      await withClient(async (c) => {
        for (const statement of splitSqlStatements(sql)) {
          await c.query(statement)
        }
      }, false)
    },
    async run(sql: string, ...params: unknown[]) {
      return withClient(async (c) => {
        const result = await c.query(toPgPlaceholders(sql), params)
        return { changes: result.rowCount ?? 0 }
      }, false)
    },
    async get<T = Record<string, unknown>>(sql: string, ...params: unknown[]) {
      return withClient(async (c) => {
        const result = await c.query(toPgPlaceholders(sql), params)
        return result.rows[0] as T | undefined
      }, true)
    },
    async all<T = Record<string, unknown>>(sql: string, ...params: unknown[]) {
      return withClient(async (c) => {
        const result = await c.query(toPgPlaceholders(sql), params)
        return result.rows as T[]
      }, true)
    },
  }
}

function isCloudflareWorkerRuntime(): boolean {
  return (
    process.env.PRINTX_REQUIRE_OBJECT_STORAGE === '1' ||
    typeof (globalThis as { WebSocketPair?: unknown }).WebSocketPair !== 'undefined'
  )
}

function createSqliteApi(database: {
  exec(sql: string): void
  prepare(sql: string): {
    run(...params: unknown[]): { changes?: number }
    get(...params: unknown[]): unknown
    all(...params: unknown[]): unknown[]
  }
}): DbApi {
  return {
    async exec(sql: string) {
      database.exec(sql)
    },
    async run(sql: string, ...params: unknown[]) {
      const result = database.prepare(sql).run(...(params as never[]))
      return { changes: Number(result.changes ?? 0) }
    },
    async get<T = Record<string, unknown>>(sql: string, ...params: unknown[]) {
      return database.prepare(sql).get(...(params as never[])) as T | undefined
    },
    async all<T = Record<string, unknown>>(sql: string, ...params: unknown[]) {
      return database.prepare(sql).all(...(params as never[])) as T[]
    },
  }
}

export function usingPostgres(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim())
}

/** End Postgres pool (or drop SQLite handle) so Vite restarts don't leak session clients. */
export async function closeDbApi(): Promise<void> {
  if (closePromise) return closePromise
  closePromise = (async () => {
    if (openPromise) {
      try {
        await openPromise
      } catch {
        /* ignore failed open */
      }
    }
    const ending = pool
    generation += 1
    pool = null
    api = null
    openPromise = null
    queryChain = Promise.resolve()
    if (ending) {
      try {
        // Stop checking out new clients, then drain.
        await ending.end()
      } catch (err) {
        console.warn('[printx] pool end failed', err)
      }
    }
  })().finally(() => {
    closePromise = null
  })
  return closePromise
}

export async function getDbApi(): Promise<DbApi> {
  if (api) return api
  if (closePromise) await closePromise
  if (api) return api
  if (openPromise) return openPromise

  openPromise = (async () => {
    // Always close any prior pool before opening — Vite HMR can leave orphans.
    if (pool) {
      try {
        await pool.end()
      } catch {
        /* ignore */
      }
      pool = null
      api = null
    }

    const onWorker = isCloudflareWorkerRuntime()
    if (!onWorker) {
      try {
        fs.mkdirSync(UPLOADS_DIR, { recursive: true })
      } catch (err) {
        console.warn('[printx] could not create uploads dir', err)
      }
    }

    const databaseUrl = process.env.DATABASE_URL?.trim()
    if (databaseUrl) {
      if (onWorker) {
        api = createPostgresClientApi(databaseUrl)
        console.log('[printx] Using Postgres via short-lived Clients (Workers/Hyperdrive)')
      } else {
      const sessionPooler = isSessionPoolerUrl(databaseUrl)
      const envMax = Number(process.env.PRINTX_PG_POOL_MAX || 1)
      // Session mode (Supabase :5432) caps ~15 clients across the whole project.
      // One process must never take more than a single session.
      const poolMax = sessionPooler
        ? 1
        : Number.isFinite(envMax) && envMax > 0
          ? Math.min(envMax, 3)
          : 1
      const nextGen = generation + 1
      generation = nextGen
      const created = new pg.Pool({
        connectionString: databaseUrl,
        ssl: databaseUrl.includes('localhost') ? undefined : { rejectUnauthorized: false },
        max: poolMax,
        // Release idle sessions fast so Render + local don't starve each other.
        idleTimeoutMillis: sessionPooler ? 1_000 : 5_000,
        connectionTimeoutMillis: 15_000,
        allowExitOnIdle: true,
        maxUses: 50,
      })
      created.on('error', (err) => {
        console.error('[printx] idle Postgres client error', err)
      })
      pool = created
      api = createPostgresApi(created, nextGen, () => generation)
      console.log(
        `[printx] Using Supabase/Postgres DATABASE_URL (pool max ${created.options.max}${
          sessionPooler ? ', session-pooler' : ''
        })`,
      )
      }
    } else {
      const { DatabaseSync } = await import('node:sqlite')
      fs.mkdirSync(DATA_DIR, { recursive: true })
      const dbPath = path.join(DATA_DIR, 'printx.db')
      const sqlite = new DatabaseSync(dbPath)
      sqlite.exec('PRAGMA journal_mode = WAL')
      sqlite.exec('PRAGMA foreign_keys = ON')
      api = createSqliteApi(sqlite)
      console.log(`[printx] Using local SQLite at ${dbPath}`)
    }

    return api!
  })().finally(() => {
    openPromise = null
  })

  return openPromise
}
