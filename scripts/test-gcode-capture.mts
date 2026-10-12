import { quoteAndDownloadGcode, cloudSlicerConfigured } from '../server/cloudSlicer.ts'
import { localSlicerAvailable, resolveLocalSlicerBin, resolveBambuProfileRoot, sliceStlLocally } from '../server/localSlicer.ts'
import { readFileSync, writeFileSync } from 'fs'
import { Client } from 'pg'

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
    }),
)
for (const [k, v] of Object.entries(env)) process.env[k] = String(v)

console.log('local slicer bin', resolveLocalSlicerBin())
console.log('profile root', resolveBambuProfileRoot())
console.log('available pablo_p1s', localSlicerAvailable('pablo_p1s'))

const stlPath = '/tmp/printx-test-cube.stl'
const t0 = Date.now()
try {
  const local = await sliceStlLocally(stlPath, 'pablo_p1s')
  console.log('LOCAL SUCCESS', {
    ms: Date.now() - t0,
    bytes: local.buffer.length,
    filename: local.filename,
    grams: local.grams,
    hours: local.hours,
  })
  writeFileSync('/tmp/printx-test-out.gcode', local.buffer)
  const head = local.buffer.subarray(0, 120).toString('utf8')
  console.log('head:', head.replace(/\n/g, '\\n'))

  const client = new Client({ connectionString: env.DATABASE_URL as string, ssl: { rejectUnauthorized: false } })
  await client.connect()
  const { rows } = await client.query(
    `SELECT cloud_slicer_token, cloud_slicer_printer_id, cloud_slicer_filament_id FROM printers WHERE id = 'pablo_p1s'`,
  )
  await client.end()
  const creds = {
    token: String(rows[0].cloud_slicer_token || ''),
    printerId: String(rows[0].cloud_slicer_printer_id || ''),
    filamentId: String(rows[0].cloud_slicer_filament_id || ''),
  }
  console.log('cloud configured', cloudSlicerConfigured(creds))
  const viaQuote = await quoteAndDownloadGcode(creds, stlPath, { printxPrinterId: 'pablo_p1s' })
  console.log('quoteAndDownloadGcode SUCCESS', {
    ms: Date.now() - t0,
    bytes: viaQuote.buffer.length,
    quoteId: viaQuote.quoteId,
    grams: viaQuote.grams,
    hours: viaQuote.hours,
  })
} catch (err) {
  console.error('FAIL', Date.now() - t0, 'ms', err instanceof Error ? err.stack || err.message : err)
  process.exitCode = 1
}
