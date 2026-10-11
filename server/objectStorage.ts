/**
 * Persistent file storage via Supabase Storage.
 * Local disk (`data/uploads`) is still used as a cache; Render cold starts wipe it,
 * so models must also live in the `printx-models` bucket when configured.
 */
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ServerResponse } from 'node:http'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getUploadsDir } from './db.ts'
import { modelContentType } from '../shared/modelFormats.ts'

const DEFAULT_BUCKET = 'printx-models'
const FILE_SIZE_LIMIT = 50 * 1024 * 1024

function bucketName(): string {
  return (process.env.SUPABASE_STORAGE_BUCKET || DEFAULT_BUCKET).trim() || DEFAULT_BUCKET
}

function supabaseUrl(): string {
  return (process.env.SUPABASE_URL || '').trim().replace(/\/$/, '')
}

function serviceRoleKey(): string {
  return (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
}

export function objectStorageConfigured(): boolean {
  return Boolean(supabaseUrl() && serviceRoleKey())
}

let client: SupabaseClient | null = null

function getClient(): SupabaseClient | null {
  if (!objectStorageConfigured()) return null
  if (!client) {
    client = createClient(supabaseUrl(), serviceRoleKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return client
}

/** Object key inside the bucket (design models + other uploads share one namespace). */
function objectKey(fileName: string): string {
  return `uploads/${fileName}`
}

export function isSafeStoredFileName(fileName: string): boolean {
  return Boolean(
    fileName &&
      !fileName.includes('..') &&
      !fileName.includes('/') &&
      !fileName.includes('\\'),
  )
}

let bucketReady: Promise<void> | null = null

/** Create the private models bucket once (idempotent). Safe no-op when unconfigured. */
export async function ensureModelBucket(): Promise<void> {
  const sb = getClient()
  if (!sb) return
  if (!bucketReady) {
    bucketReady = (async () => {
      const name = bucketName()
      const { data: buckets, error: listErr } = await sb.storage.listBuckets()
      if (listErr) {
        console.warn('[object-storage] listBuckets:', listErr.message)
        return
      }
      if (buckets?.some((b) => b.id === name || b.name === name)) return
      const { error } = await sb.storage.createBucket(name, {
        public: false,
        fileSizeLimit: FILE_SIZE_LIMIT,
      })
      if (error && !/already exists/i.test(error.message)) {
        console.warn('[object-storage] createBucket:', error.message)
      } else {
        console.log(`[object-storage] bucket ready: ${name}`)
      }
    })()
  }
  await bucketReady
}

export async function uploadStoredFile(
  localPath: string,
  fileName: string,
  contentType?: string,
): Promise<void> {
  const sb = getClient()
  if (!sb) return
  if (!isSafeStoredFileName(fileName)) throw new Error('Invalid file name for storage.')
  await ensureModelBucket()
  const body = await fsPromises.readFile(localPath)
  const ext = path.extname(fileName).toLowerCase()
  const type = contentType || modelContentType(ext)
  const { error } = await sb.storage.from(bucketName()).upload(objectKey(fileName), body, {
    contentType: type,
    upsert: true,
  })
  if (error) throw new Error(`Supabase Storage upload failed: ${error.message}`)
}

async function downloadStoredFile(fileName: string): Promise<Buffer | null> {
  const sb = getClient()
  if (!sb || !isSafeStoredFileName(fileName)) return null
  const { data, error } = await sb.storage.from(bucketName()).download(objectKey(fileName))
  if (error || !data) return null
  return Buffer.from(await data.arrayBuffer())
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
    console.log(`[object-storage] enabled → bucket "${bucketName()}"`)
  } else if (supabaseUrl()) {
    console.warn(
      '[object-storage] SUPABASE_URL set but SUPABASE_SERVICE_ROLE_KEY missing — ' +
        'design models will stay on ephemeral disk only.',
    )
  }
}
