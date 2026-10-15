import { handleWorkerFetch, type WorkerEnv } from '../server/cfAdapter.ts'
import { drainBackgroundTasks } from '../server/background.ts'

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
    try {
      return await handleWorkerFetch(request, env)
    } finally {
      // Keep push / mail side-effects alive after the response (Workers otherwise abort them).
      for (const task of drainBackgroundTasks()) {
        ctx.waitUntil(task)
      }
    }
  },
}
