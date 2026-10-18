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
import { GITHUB_MODEL_FILES } from '../shared/githubModels.ts'

const DEFAULT_BUCKET = 'printx-models'
const FILE_SIZE_LIMIT = 50 * 1024 * 1024

function bucketName(): string {
  return (process.env.SUPABASE_STORAGE_BUCKET || DEFAULT_BUCKET).trim() || DEFAULT_BUCKET
}

/**
 * Prefer SUPABASE_URL. If missing (common on Render when only DATABASE_URL is set),
 * derive https://<projectRef>.supabase.co from the pooler/direct DB URI.
 */
function supabaseUrl(): string {
  const explicit = cleanEnv(process.env.SUPABASE_URL).replace(/\/$/, '')
  if (explicit) return explicit

  const db = cleanEnv(process.env.DATABASE_URL)
  if (!db) return ''

  // postgresql://postgres.PROJECTREF:…@aws-0-….pooler.supabase.com:5432/postgres
  const poolerUser = /[/:@]postgres\.([a-z0-9]+)[:@]/i.exec(db)
  if (poolerUser?.[1]) return `https://${poolerUser[1]}.supabase.co`

  // postgresql://…@db.PROJECTREF.supabase.co:5432/postgres
  const directHost = /@db\.([a-z0-9]+)\.supabase\.co\b/i.exec(db)
  if (directHost?.[1]) return `https://${directHost[1]}.supabase.co`

  return ''
}

/** Strip quotes/BOM/whitespace that often sneak in when pasting Render secrets. */
function cleanEnv(raw: string | undefined): string {
  if (typeof raw !== 'string') return ''
  let s = raw.replace(/^\uFEFF/, '').trim()
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim()
  }
  return s
}

const SERVICE_ROLE_ENV_NAMES = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_SERVICE_ROLE',
  'SUPABASE_SERVICE_KEY',
  'SERVICE_ROLE_KEY',
] as const

let resolvedKeySource: string | null = null

/**
 * service_role (legacy JWT eyJ…) or sb_secret_… (new secret key).
 * Accepts common Render env name variants — the live process was not seeing the key.
 */
function serviceRoleKey(): string {
  resolvedKeySource = null
  for (const name of SERVICE_ROLE_ENV_NAMES) {
    const cleaned = cleanEnv(process.env[name]).replace(/\s+/g, '')
    if (!cleaned) continue
    resolvedKeySource = name
    return cleaned
  }
  // Last resort: any SUPABASE_* value that looks like a secret/service key.
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.toUpperCase().startsWith('SUPABASE')) continue
    const cleaned = cleanEnv(v).replace(/\s+/g, '')
    if (!cleaned) continue
    if (cleaned.startsWith('sb_secret_') || cleaned.startsWith('eyJ')) {
      // Prefer not to treat the anon/publishable JWT as service role.
      if (k.toUpperCase().includes('ANON') || k.toUpperCase().includes('PUBLISH')) continue
      if (cleaned.startsWith('sb_publishable')) continue
      resolvedKeySource = k
      return cleaned
    }
  }
  return ''
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

/** Public CDN in front of the GitHub repo. Shop previews use this instead of Supabase. */
function githubModelUrl(fileName: string): string {
  const repo = (process.env.PRINTX_GITHUB_REPO || 'Pab89154/printx').trim()
  const ref = (process.env.PRINTX_GITHUB_REF || 'main').trim() || 'main'
  return `https://cdn.jsdelivr.net/gh/${repo}@${ref}/models/${encodeURIComponent(fileName)}`
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

/** Short-lived URL so the browser fetches the file from Storage, not through the Worker. */
export async function signedStoredFileUrl(
  fileName: string,
  expiresIn = 600,
): Promise<string | null> {
  if (!objectStorageConfigured() || !isSafeStoredFileName(fileName)) return null
  try {
    assertKeyLooksValid()
    const bucket = bucketName()
    const res = await storageFetch(
      `/object/sign/${encodeURIComponent(bucket)}/${objectKey(fileName)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn }),
      },
    )
    if (!res.ok) {
      console.warn('[object-storage] sign failed:', await readStorageError(res))
      return null
    }
    const data = (await res.json()) as { signedURL?: string; signedUrl?: string }
    const signed = String(data.signedURL || data.signedUrl || '')
    if (!signed) return null
    if (signed.startsWith('http://') || signed.startsWith('https://')) return signed
    const pathPart = signed.startsWith('/') ? signed : `/${signed}`
    return `${supabaseUrl()}/storage/v1${pathPart}`
  } catch (err) {
    console.warn('[object-storage] sign failed:', err instanceof Error ? err.message : err)
    return null
  }
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
    // Do not backfill-upload here. Reading a multi‑MB STL into RAM to re-upload
    // while the local slicer is also loading it OOMs free-tier Render and stalls
    // Download G-code. Uploads happen at write time (storeGcodeBuffer / design save).
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

/**
 * Send a stored file on an HTTP response. Returns false if missing.
 * Uses readFile + end (not stream.pipe) so Cloudflare Workers' ServerResponse
 * mock works — pipe() needs a real Writable and was throwing "dest.on is not a function".
 */
export async function sendStoredFile(
  res: ServerResponse,
  fileName: string,
  contentType: string,
  cacheControl: string,
  headers?: Record<string, string>,
): Promise<boolean> {
  if (isSafeStoredFileName(fileName)) {
    const repoCopy = path.join(process.cwd(), 'models', fileName)
    if (fs.existsSync(repoCopy)) {
      const buf = await fsPromises.readFile(repoCopy)
      if (buf.length) {
        res.statusCode = 200
        res.setHeader('Content-Type', contentType)
        res.setHeader('Cache-Control', cacheControl)
        res.setHeader('Content-Length', String(buf.byteLength))
        if (headers) {
          for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
        }
        res.end(buf)
        return true
      }
    }
  }

  if (GITHUB_MODEL_FILES.has(fileName)) {
    res.statusCode = 302
    res.setHeader('Location', githubModelUrl(fileName))
    res.setHeader('Cache-Control', 'public, max-age=300')
    res.end()
    return true
  }

  if (isSafeStoredFileName(fileName)) {
    try {
      const uploadsDir = await getUploadsDir()
      const localPath = path.join(uploadsDir, fileName)
      if (fs.existsSync(localPath)) {
        const buf = await fsPromises.readFile(localPath)
        if (buf.length) {
          res.statusCode = 200
          res.setHeader('Content-Type', contentType)
          res.setHeader('Cache-Control', cacheControl)
          res.setHeader('Content-Length', String(buf.byteLength))
          if (headers) {
            for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
          }
          res.end(buf)
          return true
        }
      }
    } catch {
      /* fall through to Storage */
    }
  }

  // Proxying a multi‑MB STL through the Worker hits the 20s request cap (504).
  const signed = await signedStoredFileUrl(fileName)
  if (signed) {
    res.statusCode = 302
    res.setHeader('Location', signed)
    res.setHeader('Cache-Control', 'private, no-store')
    res.end()
    return true
  }

  const resolved = await resolveStoredFile(fileName)
  if (!resolved) return false
  try {
    const buf = await fs.promises.readFile(resolved.path)
    if (!buf.length) return false
    res.statusCode = 200
    res.setHeader('Content-Type', contentType)
    res.setHeader('Cache-Control', cacheControl)
    res.setHeader('Content-Length', String(buf.byteLength))
    if (headers) {
      for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
    }
    res.end(buf)
    return true
  } catch (err) {
    console.warn(
      '[object-storage] sendStoredFile failed:',
      err instanceof Error ? err.message : err,
    )
    if (!res.headersSent && !res.writableEnded) {
      /* caller may send JSON 404/500 */
    }
    return false
  } finally {
    resolved.cleanup?.()
  }
}

export function logObjectStorageStatus(): void {
  if (objectStorageConfigured()) {
    const key = serviceRoleKey()
    const kind = key.startsWith('sb_secret')
      ? 'sb_secret'
      : key.startsWith('eyJ')
        ? 'jwt service_role'
        : 'custom'
    console.log(
      `[object-storage] enabled → bucket "${bucketName()}" (${kind} via ${resolvedKeySource || 'env'})`,
    )
  } else if (objectStorageRequired()) {
    const present = SERVICE_ROLE_ENV_NAMES.filter((n) => Boolean(cleanEnv(process.env[n])))
    console.warn(
      '[object-storage] REQUIRED but no usable service role key in process.env. ' +
        `Checked: ${SERVICE_ROLE_ENV_NAMES.join(', ')}. ` +
        (present.length
          ? `Present but empty/invalid after clean: ${present.join(', ')}.`
          : 'None of those names are set on this process — add SUPABASE_SERVICE_ROLE_KEY on the Render *printx* service → Environment → Runtime (not Build-only), then Manual Deploy.'),
    )
  }
}

export function objectStorageHealth(): {
  configured: boolean
  required: boolean
  bucket: string
  keySource: string | null
  envPresent: Record<string, boolean>
} {
  // Resolve key first so keySource is populated.
  const configured = objectStorageConfigured()
  const url = supabaseUrl()
  const envPresent: Record<string, boolean> = {
    SUPABASE_URL: Boolean(cleanEnv(process.env.SUPABASE_URL)),
    SUPABASE_URL_DERIVED: Boolean(url) && !cleanEnv(process.env.SUPABASE_URL),
    DATABASE_URL: Boolean(cleanEnv(process.env.DATABASE_URL)),
    SUPABASE_ANON_KEY: Boolean(cleanEnv(process.env.SUPABASE_ANON_KEY)),
  }
  for (const name of SERVICE_ROLE_ENV_NAMES) {
    envPresent[name] = Boolean(cleanEnv(process.env[name]))
  }
  return {
    configured,
    required: objectStorageRequired(),
    bucket: bucketName(),
    keySource: configured ? resolvedKeySource : null,
    envPresent,
  }
}
