/**
 * Durable file storage on GitHub (repo folder `uploads/`), replacing
 * Supabase Storage whose per-download egress billing blew past quota.
 * Files are referenced by plain name everywhere (DB rows, /api/public/
 * uploads/<name> URLs); only the backing store moved.
 *
 * Writes use the Contents API with PRINTX_GITHUB_TOKEN (fine-grained PAT).
 * Reads use the public raw URLs — same pattern as the shop STL models.
 */

export const GITHUB_UPLOAD_MAX_BYTES = 20 * 1024 * 1024

function repo(): string {
  return (process.env.PRINTX_GITHUB_REPO || 'Pab89154/printx').trim() || 'Pab89154/printx'
}

function ref(): string {
  return (process.env.PRINTX_GITHUB_REF || 'main').trim() || 'main'
}

function token(): string {
  return (process.env.PRINTX_GITHUB_TOKEN || '').trim()
}

export function githubStorageConfigured(): boolean {
  return Boolean(token())
}

export function githubUploadRepoPath(fileName: string): string {
  return `uploads/${fileName}`
}

function rawUrls(repoPath: string): string[] {
  const encoded = repoPath.split('/').map(encodeURIComponent).join('/')
  return [
    `https://raw.githubusercontent.com/${repo()}/${ref()}/${encoded}`,
    `https://rawcdn.githack.com/${repo()}/${ref()}/${encoded}`,
  ]
}

/** Download a file from the repo (tries both raw mirrors). */
export async function downloadGithubFile(repoPath: string): Promise<Buffer | null> {
  for (const source of rawUrls(repoPath)) {
    try {
      const res = await fetch(source)
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer())
        if (buf.length) return buf
      }
    } catch {
      /* try the next source */
    }
  }
  return null
}

export async function downloadGithubUpload(fileName: string): Promise<Buffer | null> {
  const fromRepo = await downloadGithubFile(githubUploadRepoPath(fileName))
  if (fromRepo?.length) return fromRepo
  // Legacy shop STLs live in `models/`, not `uploads/` — check there too
  // so server-side reads (slicing, STL rendering) find them after the
  // Supabase → GitHub migration.
  if (fileName.toLowerCase().endsWith('.stl')) {
    const fromModels = await downloadGithubFile(`models/${fileName}`)
    if (fromModels?.length) return fromModels
  }
  // Big files (>40 MB) live as assets on the "printx-files" release instead
  // of in the repo tree; the public download URL redirects to signed storage.
  try {
    const res = await fetch(
      `https://github.com/${repo()}/releases/download/${BIG_FILES_RELEASE_TAG}/${encodeURIComponent(fileName)}`,
    )
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length) return buf
    }
  } catch {
    /* not a big-file asset */
  }
  // Chunked big files: glue the `<file>.chunk-NNN` assets back together.
  try {
    const chunks = bigFilesChunksFor(fileName, await listBigFilesAssets())
    if (chunks.length) {
      const parts: Buffer[] = []
      for (const chunk of chunks) {
        const res = await fetch(bigFilesReleaseDownloadUrl(chunk.name))
        if (!res.ok) return null
        parts.push(Buffer.from(await res.arrayBuffer()))
      }
      const joined = Buffer.concat(parts)
      if (joined.length) return joined
    }
  } catch {
    /* no chunked copy either */
  }
  return null
}

/** Release that holds oversized model files (assets up to 2 GB each). */
export const BIG_FILES_RELEASE_TAG = 'printx-files'

export function bigFilesReleaseDownloadUrl(fileName: string): string {
  return `https://github.com/${repo()}/releases/download/${BIG_FILES_RELEASE_TAG}/${encodeURIComponent(fileName)}`
}

export type BigFilesAsset = { name: string; id: number; size: number }

function ghApiHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${token()}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'printx-worker',
    'Content-Type': 'application/json',
  }
}

/** Find (or create) the big-files release; null when storage is unconfigured. */
export async function getBigFilesReleaseId(): Promise<number | null> {
  if (!token()) return null
  const headers = ghApiHeaders()
  const relRes = await fetch(
    `https://api.github.com/repos/${repo()}/releases/tags/${BIG_FILES_RELEASE_TAG}`,
    { headers },
  )
  if (relRes.ok) {
    return Number(((await relRes.json()) as { id?: number }).id) || null
  }
  if (relRes.status !== 404) return null
  const createRes = await fetch(`https://api.github.com/repos/${repo()}/releases`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      tag_name: BIG_FILES_RELEASE_TAG,
      name: 'PrintX big files',
      body: 'Oversized model files uploaded from the PrintX admin portal.',
    }),
  })
  if (!createRes.ok) return null
  return Number(((await createRes.json()) as { id?: number }).id) || null
}

/** All assets on the big-files release (paginated). */
export async function listBigFilesAssets(): Promise<BigFilesAsset[]> {
  if (!token()) return []
  const releaseId = await getBigFilesReleaseId()
  if (!releaseId) return []
  const out: BigFilesAsset[] = []
  for (let page = 1; page <= 10; page++) {
    const res = await fetch(
      `https://api.github.com/repos/${repo()}/releases/${releaseId}/assets?per_page=100&page=${page}`,
      { headers: ghApiHeaders() },
    )
    if (!res.ok) break
    const items = (await res.json()) as { name?: string; id?: number; size?: number }[]
    if (!Array.isArray(items) || !items.length) break
    for (const item of items) {
      if (item.name && item.id) out.push({ name: item.name, id: item.id, size: Number(item.size) || 0 })
    }
    if (items.length < 100) break
  }
  return out
}

/** Upload (or replace) one asset on the big-files release. */
export async function uploadBigFilesAsset(name: string, body: Buffer): Promise<void> {
  if (!token()) throw new Error('PRINTX_GITHUB_TOKEN is not configured.')
  const releaseId = await getBigFilesReleaseId()
  if (!releaseId) throw new Error('Could not prepare big-file storage.')
  const headers = ghApiHeaders()
  const existing = (await listBigFilesAssets().catch(() => [])).find((a) => a.name === name)
  if (existing) {
    await fetch(`https://api.github.com/repos/${repo()}/releases/assets/${existing.id}`, {
      method: 'DELETE',
      headers,
    }).catch(() => undefined)
  }
  const res = await fetch(
    `https://uploads.github.com/repos/${repo()}/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token()}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'printx-worker',
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(body.length),
      },
      body: new Uint8Array(body),
    },
  )
  if (!res.ok) {
    let detail = `${res.status}`
    try {
      const data = (await res.json()) as { message?: string }
      if (data.message) detail = data.message
    } catch {
      /* keep status */
    }
    throw new Error(`Big-file upload failed: ${detail}`)
  }
}

/**
 * Big models uploaded in slices live as `<file>.chunk-000`, `-001`, …
 * assets (one giant streamed request kept dying in browsers). Returns the
 * chunk assets in order, or [] when the file was stored whole.
 */
export function bigFilesChunksFor(fileName: string, assets: BigFilesAsset[]): BigFilesAsset[] {
  const prefix = `${fileName}.chunk-`
  return assets
    .filter((a) => a.name.startsWith(prefix) && /^\d+$/.test(a.name.slice(prefix.length)))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Upload (create or replace) a file in the repo via the Contents API. */
export async function uploadFileToGithub(repoPath: string, body: Buffer): Promise<void> {
  const t = token()
  if (!t) throw new Error('PRINTX_GITHUB_TOKEN is not configured.')
  const encoded = repoPath.split('/').map(encodeURIComponent).join('/')
  const api = `https://api.github.com/repos/${repo()}/contents/${encoded}`
  const headers: Record<string, string> = {
    Authorization: `Bearer ${t}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'printx-worker',
    'Content-Type': 'application/json',
  }
  // Existing file needs its sha to be replaced.
  let sha: string | undefined
  const existing = await fetch(`${api}?ref=${encodeURIComponent(ref())}`, { headers })
  if (existing.ok) {
    const data = (await existing.json()) as { sha?: string }
    if (data.sha) sha = data.sha
  }
  const res = await fetch(api, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      message: `Upload ${repoPath} (PrintX)`,
      content: body.toString('base64'),
      branch: ref(),
      ...(sha ? { sha } : {}),
    }),
  })
  if (!res.ok) {
    let detail = `${res.status}`
    try {
      const data = (await res.json()) as { message?: string }
      if (data.message) detail = data.message
    } catch {
      /* keep status */
    }
    throw new Error(`GitHub upload failed: ${detail}`)
  }
}

export async function uploadUploadToGithub(fileName: string, body: Buffer): Promise<void> {
  await uploadFileToGithub(githubUploadRepoPath(fileName), body)
}
