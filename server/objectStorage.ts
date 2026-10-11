/**
 * Persistent file storage via Supabase Storage REST API.
 * Local disk (`data/uploads`) is a cache only — Render wipes it on cold start.
 */
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ServerResponse } from 'node:http'
import { getUploadsDir } from './db.ts'

const DEFAULT_BUCKET = 'printx-models'
const FILE_SIZE_LIMIT = 50 * 1024 * 1024

function bucketName(): string {
  return (process.env.SUPABASE_STORAGE_BUCKET || DEFAULT_BUCKET).trim() || DEFAULT_BUCKET
}

function supabaseUrl(): string {
  return (process.env.SUPABASE_URL || '').trim().replace(/\/$/, '')
}

/** service_role (legacy JWT) or sb_secret_… (new secret key). */
function serviceRoleKey(): string {
  return (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    ''
  ).trim()
}

export function objectStorageConfigured(): boolean {
  return Boolean(supabaseUrl() && serviceRoleKey())
}

/** When Supabase is configured for the project, models must use Storage. */
export function objectStorageRequired(): boolean {
  if (objectStorageConfigured()) return true
  const url = supabaseUrl()
  const db = (process.env.DATABASE_URL || '').toLowerCase()
  return Boolean(url || db.includes('supabase'))
}

export function isSafeStoredFileName(fileName: string): boolean {
  return Boolean(
    fileName &&
      !fileName.includes('..') &&
      !fileName.includes('/') &&
      !fileName.includes('\\'),
  )
}

function objectKey(fileName: string): string {
  return `uploads/${fileName}`
}

function assertKeyLooksValid(): void {
  const key = serviceRoleKey()
  const anon = (process.env.SUPABASE_ANON_KEY || '').trim()
  if (!key) return
  if (key === anon || key.startsWith('sb_publishable')) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY looks like the anon/publishable key. ' +
        'Use Project Settings → API → service_role (or the sb_secret_… key).',
    )
  }
}

async function storageFetch(apiPath: string, init: RequestInit = {}): Promise<Response> {
  const base = supabaseUrl()
  const key = serviceRoleKey()
  if (!base || !key) {
    throw new Error('Supabase Storage is not configured.')
  }
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${key}`)
  headers.set('apikey', key)
  return fetch(`${base}/storage/v1${apiPath}`, { ...init, headers })
}

async function readStorageError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { message?: string; error?: string; statusCode?: string }
    return String(data.message || data.error || `${res.status} ${res.statusText}`)
  } catch {
    return `${res.status} ${res.statusText}`
  }
}

let bucketReady: Promise<void> | null = null

/** Create the private models bucket once (idempotent). */
export async function ensureModelBucket(): Promise<void> {
  if (!objectStorageConfigured()) return
  assertKeyLooksValid()
  if (!bucketReady) {
    bucketReady = (async () => {
      const name = bucketName()
      const listRes = await storageFetch('/bucket', { method: 'GET' })
      if (listRes.ok) {
        const buckets = (await listRes.json()) as Array<{ id?: string; name?: string }>
        if (buckets.some((b) => b.id === name || b.name === name)) {
          console.log(`[object-storage] bucket ok: ${name}`)
          return
        }
      } else {
        const msg = await readStorageError(listRes)
        // Don't abort forever — try create anyway (list can fail on older projects).
        console.warn('[object-storage] listBuckets:', msg)
      }

      const createRes = await storageFetch('/bucket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: name,
          name,
          public: false,
          file_size_limit: FILE_SIZE_LIMIT,
        }),
      })
      if (!createRes.ok) {
        const msg = await readStorageError(createRes)
        if (!/already exists|duplicate|409/i.test(msg) && createRes.status !== 409) {
          bucketReady = null
          throw new Error(`Could not create Storage bucket "${name}": ${msg}`)
        }
      }
      console.log(`[object-storage] bucket ready: ${name}`)
    })().catch((err) => {
      bucketReady = null
      throw err
    })
  }
  await bucketReady
}

export async function uploadStoredFile(
  localPath: string,
  fileName: string,
  _contentType?: string,
): Promise<void> {
  if (!objectStorageConfigured()) {
    if (objectStorageRequired()) {
      throw new Error(
        'Supabase Storage is not configured. Set SUPABASE_SERVICE_ROLE_KEY ' +
          '(Project Settings → API → service_role / sb_secret_…) on the server and redeploy.',
      )
    }
    return
  }
  if (!isSafeStoredFileName(fileName)) throw new Error('Invalid file name for storage.')
  assertKeyLooksValid()
  await ensureModelBucket()

  const body = await fsPromises.readFile(localPath)
  const key = objectKey(fileName)
  const bucket = bucketName()
  // octet-stream avoids bucket MIME allow-list rejects for model/* types.
  const res = await storageFetch(`/object/${encodeURIComponent(bucket)}/${key}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'x-upsert': 'true',
    },
    body,
  })
  if (!res.ok) {
    throw new Error(`Supabase Storage upload failed: ${await readStorageError(res)}`)
  }
  console.log(`[object-storage] uploaded ${bucket}/${key} (${body.length} bytes)`)
}

async function downloadStoredFile(fileName: string): Promise<Buffer | null> {
  if (!objectStorageConfigured() || !isSafeStoredFileName(fileName)) return null
  const bucket = bucketName()
  const res = await storageFetch(`/object/${encodeURIComponent(bucket)}/${objectKey(fileName)}`, {
    method: 'GET',
  })
  if (!res.ok) return null
  return Buffer.from(await res.arrayBuffer())
}

/**
 * Resolve a stored upload to a local path (disk cache, then Supabase).
 * Callers that get a temp file should invoke `cleanup` when done.
 */
export async function resolveStoredFile(
  fileName: string,
): Promise<{ path: string; cleanup?: () => void } | null> {
  if (!isSafeStoredFileName(fileName)) return null
  const uploadsDir = await getUploadsDir()
  const localPath = path.join(uploadsDir, fileName)
  if (fs.existsSync(localPath)) {
    if (objectStorageConfigured()) {
      void uploadStoredFile(localPath, fileName).catch((err) => {
        console.warn(
          '[object-storage] backfill failed:',
          err instanceof Error ? err.message : err,
        )
      })
    }
    return { path: localPath }
  }

  const buf = await downloadStoredFile(fileName)
  if (!buf) return null

  try {
    await fsPromises.writeFile(localPath, buf)
    return { path: localPath }
  } catch {
    const tmp = path.join(os.tmpdir(), `printx-${fileName}`)
    await fsPromises.writeFile(tmp, buf)
    return {
      path: tmp,
      cleanup: () => {
        try {
          fs.unlinkSync(tmp)
        } catch {
          /* ignore */
        }
      },
    }
  }
}

/** Stream a stored file to an HTTP response. Returns false if missing. */
export async function sendStoredFile(
  res: ServerResponse,
  fileName: string,
  contentType: string,
  cacheControl: string,
  headers?: Record<string, string>,
): Promise<boolean> {
  const resolved = await resolveStoredFile(fileName)
  if (!resolved) return false
  res.statusCode = 200
  res.setHeader('Content-Type', contentType)
  res.setHeader('Cache-Control', cacheControl)
  if (headers) {
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
  }
  const stream = fs.createReadStream(resolved.path)
  stream.on('close', () => resolved.cleanup?.())
  stream.on('error', () => {
    resolved.cleanup?.()
    if (!res.headersSent) {
      res.statusCode = 500
      res.end()
    } else {
      res.destroy()
    }
  })
  stream.pipe(res)
  return true
}

export function logObjectStorageStatus(): void {
  if (objectStorageConfigured()) {
    const key = serviceRoleKey()
    const kind = key.startsWith('sb_secret')
      ? 'sb_secret'
      : key.startsWith('eyJ')
        ? 'jwt service_role'
        : 'custom'
    console.log(`[object-storage] enabled → bucket "${bucketName()}" (${kind})`)
  } else if (objectStorageRequired()) {
    console.warn(
      '[object-storage] REQUIRED but SUPABASE_SERVICE_ROLE_KEY is missing — ' +
        'model uploads will fail until you set the service_role / sb_secret key.',
    )
  }
}

export function objectStorageHealth(): { configured: boolean; required: boolean; bucket: string } {
  return {
    configured: objectStorageConfigured(),
    required: objectStorageRequired(),
    bucket: bucketName(),
  }
}
