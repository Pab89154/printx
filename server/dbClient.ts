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

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const DATA_DIR = process.env.PRINTX_DATA_DIR ?? path.join(__dirname, '..', 'data')
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads')

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

async function poolQuery(
  pool: pg.Pool,
  generation: number,
  getGeneration: () => number,
  sql: string,
  params: unknown[] = [],
  attempts = 8,
) {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    if (getGeneration() !== generation) {
      throw new Error('Database connection was restarted')
    }
    try {
      return await pool.query(sql, params)
    } catch (err) {
      lastErr = err
      if (!isPoolExhaustedError(err) || i === attempts - 1) throw err
      const waitMs = Math.min(8_000, 400 * 2 ** i)
      console.warn(
        `[printx] Postgres session pool busy (attempt ${i + 1}/${attempts}); retry in ${waitMs}ms`,
      )
      await new Promise((r) => setTimeout(r, waitMs))
    }
  }
  throw lastErr
}

function createPostgresApi(pool: pg.Pool, generation: number, getGeneration: () => number): DbApi {
  return {
    async exec(sql: string) {
      for (const statement of splitSqlStatements(sql)) {
        await poolQuery(pool, generation, getGeneration, statement)
      }
    },
    async run(sql: string, ...params: unknown[]) {
      const result = await poolQuery(pool, generation, getGeneration, toPgPlaceholders(sql), params)
      return { changes: result.rowCount ?? 0 }
    },
    async get<T = Record<string, unknown>>(sql: string, ...params: unknown[]) {
      const result = await poolQuery(pool, generation, getGeneration, toPgPlaceholders(sql), params)
      return result.rows[0] as T | undefined
    },
    async all<T = Record<string, unknown>>(sql: string, ...params: unknown[]) {
      const result = await poolQuery(pool, generation, getGeneration, toPgPlaceholders(sql), params)
      return result.rows as T[]
    },
  }
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

let api: DbApi | null = null
let pool: pg.Pool | null = null
let generation = 0
let openPromise: Promise<DbApi> | null = null
let closePromise: Promise<void> | null = null

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
    if (ending) {
      try {
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
    fs.mkdirSync(UPLOADS_DIR, { recursive: true })

    const databaseUrl = process.env.DATABASE_URL?.trim()
    if (databaseUrl) {
      const poolMax = Number(process.env.PRINTX_PG_POOL_MAX || 1)
      const nextGen = generation + 1
      generation = nextGen
      const created = new pg.Pool({
        connectionString: databaseUrl,
        ssl: databaseUrl.includes('localhost') ? undefined : { rejectUnauthorized: false },
        max: Number.isFinite(poolMax) && poolMax > 0 ? Math.min(poolMax, 3) : 1,
        idleTimeoutMillis: 5_000,
        connectionTimeoutMillis: 20_000,
        allowExitOnIdle: true,
      })
      created.on('error', (err) => {
        console.error('[printx] idle Postgres client error', err)
      })
      pool = created
      api = createPostgresApi(created, nextGen, () => generation)
      console.log(
        `[printx] Using Supabase/Postgres DATABASE_URL (pool max ${created.options.max})`,
      )
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
