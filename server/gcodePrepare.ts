/** Offline G-code prepare via GitHub Actions (free) — never slice on the web host. */

import type { DbApi } from './dbClient.ts'

const GITHUB_API = 'https://api.github.com'

export type GcodePrepareDispatchResult =
  | { ok: true; mode: 'github' | 'local_hint' }
  | { ok: false; error: string }

function githubRepo(): { owner: string; repo: string } | null {
  const full = process.env.PRINTX_GITHUB_REPO?.trim() || process.env.GITHUB_REPOSITORY?.trim()
  if (full && full.includes('/')) {
    const [owner, repo] = full.split('/')
    if (owner && repo) return { owner, repo }
  }
  // Default PrintX repo when unset (override with PRINTX_GITHUB_REPO).
  return { owner: 'Pab89154', repo: 'printx' }
}

function githubToken(): string {
  return (
    process.env.PRINTX_GITHUB_TOKEN?.trim() ||
    process.env.GH_TOKEN?.trim() ||
    process.env.GITHUB_TOKEN?.trim() ||
    ''
  )
}

/** Fire-and-forget repository_dispatch / workflow_dispatch for the slicer workflow. */
export async function dispatchGcodePrepareJob(input: {
  designId: string
  printerId: string
}): Promise<GcodePrepareDispatchResult> {
  const token = githubToken()
  const repo = githubRepo()
  if (!token || !repo) {
    return {
      ok: false,
      error:
        'G-code prepare needs PRINTX_GITHUB_TOKEN (fine-grained PAT with Actions:write) and PRINTX_GITHUB_REPO=owner/repo. Or run the “Prepare G-code” workflow manually in GitHub Actions.',
    }
  }

  const url = `${GITHUB_API}/repos/${repo.owner}/${repo.repo}/actions/workflows/prepare-gcode.yml/dispatches`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'printx-gcode-prepare',
    },
    body: JSON.stringify({
      ref: process.env.PRINTX_GITHUB_REF?.trim() || 'main',
      inputs: {
        design_id: input.designId,
        printer_id: input.printerId,
      },
    }),
  })

  if (res.status === 204 || res.status === 200) {
    return { ok: true, mode: 'github' }
  }

  const text = await res.text().catch(() => '')
  return {
    ok: false,
    error: `GitHub Actions dispatch failed (${res.status}): ${text.slice(0, 300) || res.statusText}`,
  }
}

/** Record that a prepare was requested (UI / status polling). */
export async function markDesignGcodePreparing(
  db: DbApi,
  designId: string,
  printerId: string,
): Promise<void> {
  const now = new Date().toISOString()
  await db.run(
    `UPDATE designs SET
       slice_error = CASE
         WHEN slice_error IS NULL OR trim(slice_error) = '' THEN ?
         ELSE slice_error
       END,
       updated_at = ?
     WHERE id = ?`,
    `Preparing G-code for ${printerId} via GitHub Actions…`,
    now,
    designId,
  )
}
