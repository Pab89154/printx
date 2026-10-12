import { localSlicerAvailable, sliceStlLocally, resolveProfilesBase, resolveLocalSlicerBin } from '../server/localSlicer.ts'

console.log('bin', resolveLocalSlicerBin())
console.log('profiles base', resolveProfilesBase())
const stl = '/tmp/printx-test-cube.stl'
for (const id of ['pablo_p1s', 'court_ender', 'josh_kobra'] as const) {
  console.log(id, 'available', localSlicerAvailable(id))
  const t0 = Date.now()
  try {
    const r = await sliceStlLocally(stl, id)
    console.log('SUCCESS', id, { ms: Date.now() - t0, bytes: r.buffer.length, grams: r.grams, hours: r.hours })
  } catch (err) {
    console.error('FAIL', id, err instanceof Error ? err.message : err)
    process.exitCode = 1
  }
}
