/** Short in-memory cache for the public bootstrap payload (cuts repeat Supabase round-trips). */

const TTL_MS = 20_000

type Entry = {
  expiresAt: number
  body: unknown
}

let fullCache: Entry | null = null
let pausedCache: Entry | null = null
let catalogCache: Entry | null = null

export function getCachedCatalog(): unknown | null {
  if (!catalogCache) return null
  if (Date.now() > catalogCache.expiresAt) {
    catalogCache = null
    return null
  }
  return catalogCache.body
}

export function setCachedCatalog(body: unknown): void {
  catalogCache = { expiresAt: Date.now() + TTL_MS, body }
}

export function getCachedBootstrap(full: boolean): unknown | null {
  const entry = full ? fullCache : pausedCache
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    if (full) fullCache = null
    else pausedCache = null
    return null
  }
  return entry.body
}

export function setCachedBootstrap(full: boolean, body: unknown): void {
  const entry = { expiresAt: Date.now() + TTL_MS, body }
  if (full) fullCache = entry
  else pausedCache = entry
}

export function invalidateBootstrapCache(): void {
  fullCache = null
  pausedCache = null
  catalogCache = null
}
