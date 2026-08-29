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

function createPostgresApi(pool: pg.Pool): DbApi {
  return {
    async exec(sql: string) {
      for (const statement of splitSqlStatements(sql)) {
        await pool.query(statement)
      }
    },
    async run(sql: string, ...params: unknown[]) {
      const result = await pool.query(toPgPlaceholders(sql), params)
      return { changes: result.rowCount ?? 0 }
    },
    async get<T = Record<string, unknown>>(sql: string, ...params: unknown[]) {
      const result = await pool.query(toPgPlaceholders(sql), params)
      return result.rows[0] as T | undefined
    },
    async all<T = Record<string, unknown>>(sql: string, ...params: unknown[]) {
      const result = await pool.query(toPgPlaceholders(sql), params)
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

export function usingPostgres(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim())
}

export async function getDbApi(): Promise<DbApi> {
  if (api) return api

  fs.mkdirSync(UPLOADS_DIR, { recursive: true })

  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (databaseUrl) {
    pool = new pg.Pool({
      connectionString: databaseUrl,
      ssl: databaseUrl.includes('localhost') ? undefined : { rejectUnauthorized: false },
      max: 5,
    })
    api = createPostgresApi(pool)
    console.log('[printx] Using Supabase/Postgres DATABASE_URL')
  } else {
    // Lazy-load node:sqlite so production with DATABASE_URL does not need --experimental-sqlite
    const { DatabaseSync } = await import('node:sqlite')
    fs.mkdirSync(DATA_DIR, { recursive: true })
    const dbPath = path.join(DATA_DIR, 'printx.db')
    const sqlite = new DatabaseSync(dbPath)
    sqlite.exec('PRAGMA journal_mode = WAL')
    sqlite.exec('PRAGMA foreign_keys = ON')
    api = createSqliteApi(sqlite)
    console.log(`[printx] Using local SQLite at ${dbPath}`)
  }

  return api
}
