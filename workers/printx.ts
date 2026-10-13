import { handleWorkerFetch, type WorkerEnv } from '../server/cfAdapter.ts'

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    return handleWorkerFetch(request, env)
  },
}
