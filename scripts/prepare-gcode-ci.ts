/**
 * GitHub Actions / local CLI: slice a design STL and store G-code in Supabase.
 * Multicolor designs slice every part STL into separate G-code files.
 * Env: DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *      PRINTX_DESIGN_ID, PRINTX_PRINTER_ID, PRINTX_SLICER_BIN
 */
import { getDb, ensureDbReady, closeDb } from '../server/db.ts'
import { rowToDesign } from '../server/catalog.ts'
import { ensureModelBucket, resolveStoredFile } from '../server/objectStorage.ts'
import { storeGcodeBuffer } from '../server/gcodeStorage.ts'
import { sliceStlLocally, localSlicerAvailable } from '../server/localSlicer.ts'
import { designGcodeSliceTargets } from '../server/gcodePartPaths.ts'
import {
  cloudSlicerConfigured,
  quoteStlForPrintxPrinter,
  type CloudSlicerCreds,
} from '../server/cloudSlicer.ts'
import { PRINTER_BED_MM, fitStlToBed } from '../server/stlFit.ts'

function parseIdMap(raw: unknown): Record<string, string> {
  if (!raw) return {}
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!v || typeof v !== 'object') return {}
    const out: Record<string, string> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof val === 'string' && val.trim()) out[k] = val.trim()
    }
    return out
  } catch {
    return {}
  }
}

async function loadPrinterCreds(
  db: Awaited<ReturnType<typeof getDb>>,
  printerId: string,
): Promise<CloudSlicerCreds | null> {
  const row = await db.get<{
    cloud_slicer_token: string | null
    cloud_slicer_printer_id: string | null
    cloud_slicer_filament_id: string | null
  }>(
    `SELECT
       CASE WHEN TRIM(COALESCE(p.cloud_slicer_token, '')) != ''
         THEN p.cloud_slicer_token ELSE u.cloud_slicer_token END as cloud_slicer_token,
       CASE WHEN TRIM(COALESCE(p.cloud_slicer_printer_id, '')) != ''
         THEN p.cloud_slicer_printer_id ELSE u.cloud_slicer_printer_id END as cloud_slicer_printer_id,
       CASE WHEN TRIM(COALESCE(p.cloud_slicer_filament_id, '')) != ''
         THEN p.cloud_slicer_filament_id ELSE u.cloud_slicer_filament_id END as cloud_slicer_filament_id
     FROM printers p
     LEFT JOIN users u ON u.id = p.owner_user_id
     WHERE p.id = ?`,
    printerId,
  )
  if (!row) return null
  const creds: CloudSlicerCreds = {
    token: String(row.cloud_slicer_token || ''),
    printerId: String(row.cloud_slicer_printer_id || ''),
    filamentId: String(row.cloud_slicer_filament_id || ''),
  }
  return cloudSlicerConfigured(creds) ? creds : null
}

async function main() {
  const designId = process.env.PRINTX_DESIGN_ID?.trim()
  const printerId = process.env.PRINTX_PRINTER_ID?.trim() || 'pablo_p1s'
  if (!designId) throw new Error('PRINTX_DESIGN_ID is required')

  await ensureDbReady()
  await ensureModelBucket()
  const db = await getDb()
  const designRow = await db.get<Record<string, unknown>>('SELECT * FROM designs WHERE id = ?', designId)
  if (!designRow) {
    // The design was deleted after the job was queued (e.g. a duplicate in
    // Admin). Nothing to slice and nobody to update — finish quietly so
    // GitHub does not send a scary "workflow failed" email.
    console.log(
      `[prepare-gcode-ci] Design ${designId} no longer exists (deleted after prepare was clicked). Nothing to do — skipping.`,
    )
    await closeDb()
    return
  }
  const design = rowToDesign(designRow)

  const targets = designGcodeSliceTargets(design)
  if (!targets.length) {
    throw new Error(
      design.multicolorOnly
        ? 'Multicolor design has no part STLs to slice'
        : 'Design has no stl_path',
    )
  }

  const gcodePaths = parseIdMap(designRow.gcode_paths_json)
  const quoteIds = parseIdMap(designRow.quote_ids_json)
  const fileIds = parseIdMap(designRow.file_ids_json)
  let totalGrams = 0
  let totalHours = 0
  let gcodeNote = ''

  try {
    const creds = await loadPrinterCreds(db, printerId)
    for (const target of targets) {
      const resolved = await resolveStoredFile(target.stlPath)
      if (!resolved) throw new Error(`STL missing in storage: ${target.stlPath}`)
      try {
        const label =
          target.partIndex != null
            ? `part ${target.partIndex + 1} (${target.label})`
            : 'model'
        if (creds && target.partIndex == null) {
          const bedMm = PRINTER_BED_MM[printerId] ?? 220
          const fitted = fitStlToBed(resolved.path, bedMm)
          if (fitted.scaled) {
            console.log(
              '[prepare-gcode-ci] scaled STL to fit bed',
              `${fitted.sizeMm.toFixed(0)}mm -> ${bedMm}mm`,
              `factor ${fitted.factor.toFixed(4)}`,
            )
          }
          console.log('[prepare-gcode-ci] cloud quote', designId, printerId, target.stlPath)
          let quoted
          try {
            quoted = await quoteStlForPrintxPrinter(printerId, fitted.path, creds, {
              prefer: 'cloud',
              captureGcode: false,
              allowLocalFallback: false,
            })
          } finally {
            fitted.cleanup?.()
          }
          totalGrams += quoted.grams
          totalHours += quoted.hours
          if (quoted.quoteId) quoteIds[printerId] = quoted.quoteId
          if (quoted.fileId) fileIds[printerId] = quoted.fileId
          console.log('[prepare-gcode-ci] cloud quote', `${quoted.grams}g`, `${quoted.hours}h`)
        }
        if (localSlicerAvailable(printerId) && !(totalGrams > 0)) {
          try {
            console.log('[prepare-gcode-ci] slicing', designId, printerId, label, target.stlPath)
            const local = await sliceStlLocally(resolved.path, printerId)
            const hint =
              target.partIndex != null
                ? `${designId.slice(0, 8)}-${printerId}-p${target.partIndex}`
                : `${designId.slice(0, 8)}-${printerId}`
            const storedName = await storeGcodeBuffer(local.buffer, { hint })
            gcodePaths[target.storageKey(printerId)] = storedName
            if (totalGrams <= 0) totalGrams += local.grams
            if (totalHours <= 0) totalHours += local.hours
            console.log('[prepare-gcode-ci] stored', storedName, `${local.grams}g`, `${local.hours}h`)
          } catch (sliceErr) {
            const message = sliceErr instanceof Error ? sliceErr.message : String(sliceErr)
            console.warn('[prepare-gcode-ci] local slice skipped:', message.slice(0, 300))
            if (!gcodeNote) gcodeNote = 'G-code was not stored. Grams/hours are from Cloud Slicer.'
          }
        }
      } finally {
        resolved.cleanup?.()
      }
    }

    if (!(totalGrams > 0) || !(totalHours > 0)) {
      throw new Error(
        creds
          ? 'Quoting finished without grams/hours.'
          : `No Cloud Slicer credentials for ${printerId}, and the local slicer did not produce grams/hours.`,
      )
    }

    quoteIds[printerId] = quoteIds[printerId] || `local-${Date.now().toString(36)}`

    const gramsCol =
      printerId === 'pablo_p1s'
        ? 'grams_pablo_p1s'
        : printerId === 'court_ender'
          ? 'grams_court_ender'
          : 'grams_josh_kobra'
    const hoursCol =
      printerId === 'pablo_p1s'
        ? 'hours_pablo_p1s'
        : printerId === 'court_ender'
          ? 'hours_court_ender'
          : 'hours_josh_kobra'

    const existingGrams = Number(designRow[gramsCol])
    const existingHours = Number(designRow[hoursCol])
    const grams =
      Number.isFinite(existingGrams) && existingGrams > 0 ? existingGrams : totalGrams
    const hours =
      Number.isFinite(existingHours) && existingHours > 0 ? existingHours : totalHours

    await db.run(
      `UPDATE designs SET
         gcode_paths_json = ?,
         quote_ids_json = ?,
         file_ids_json = ?,
         ${gramsCol} = ?,
         ${hoursCol} = ?,
         slice_status = 'ready',
         slice_error = ?,
         updated_at = ?
       WHERE id = ?`,
      JSON.stringify(gcodePaths),
      JSON.stringify(quoteIds),
      JSON.stringify(fileIds),
      grams,
      hours,
      gcodeNote.slice(0, 500),
      new Date().toISOString(),
      designId,
    )
    console.log(
      '[prepare-gcode-ci] done',
      targets.length,
      'file(s)',
      `${grams}g`,
      `${hours}h`,
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    try {
      await db.run(
        `UPDATE designs SET slice_status = 'error', slice_error = ?, updated_at = ? WHERE id = ?`,
        message.slice(0, 500),
        new Date().toISOString(),
        designId,
      )
    } catch {
      /* best-effort */
    }
    throw err
  } finally {
    await closeDb()
  }
}

main().catch((err) => {
  console.error('[prepare-gcode-ci]', err instanceof Error ? err.message : err)
  process.exit(1)
})
