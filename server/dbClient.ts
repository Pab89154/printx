import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
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

/** Cloudflare Workers: pg.Pool idle sockets hang the isolate — use short-lived Clients. */
function createPostgresClientApi(connectionString: string): DbApi {
  async function withClient<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
    const client = new pg.Client({
      connectionString,
      // Hyperdrive's local connection string is plaintext to the edge proxy.
      ssl: connectionString.includes('localhost') || connectionString.includes('127.0.0.1')
        ? undefined
        : { rejectUnauthorized: false },
      connectionTimeoutMillis: 10_000,
    })
    await client.connect()
    try {
      return await fn(client)
    } finally {
      try {
        await client.end()
      } catch {
        /* ignore */
      }
    }
  }

  return {
    async exec(sql: string) {
      await withClient(async (client) => {
        for (const statement of splitSqlStatements(sql)) {
          await client.query(statement)
        }
      })
    },
    async run(sql: string, ...params: unknown[]) {
      return withClient(async (client) => {
        const result = await client.query(toPgPlaceholders(sql), params)
        return { changes: result.rowCount ?? 0 }
      })
    },
    async get<T = Record<string, unknown>>(sql: string, ...params: unknown[]) {
      return withClient(async (client) => {
        const result = await client.query(toPgPlaceholders(sql), params)
        return result.rows[0] as T | undefined
      })
    },
    async all<T = Record<string, unknown>>(sql: string, ...params: unknown[]) {
      return withClient(async (client) => {
        const result = await client.query(toPgPlaceholders(sql), params)
        return result.rows as T[]
      })
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
