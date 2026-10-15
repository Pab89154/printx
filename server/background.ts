/**
 * Track async work that must finish after the HTTP response on Cloudflare Workers.
 * The Worker entrypoint drains these via ExecutionContext.waitUntil().
 */

const pending: Promise<unknown>[] = []

export function runInBackground(label: string, work: () => Promise<unknown>): void {
  const task = Promise.resolve()
    .then(work)
    .catch((err) => {
      console.warn(`[bg:${label}]`, err instanceof Error ? err.message : err)
    })
  pending.push(task)
}

export function drainBackgroundTasks(): Promise<unknown>[] {
  if (pending.length === 0) return []
  return pending.splice(0, pending.length)
}
