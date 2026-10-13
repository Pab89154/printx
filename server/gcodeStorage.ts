/** Persist captured Cloud Slicer G-code in PrintX storage (CS discards it by default). */

import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { getUploadsDir } from './db.ts'
import {
  objectStorageConfigured,
  objectStorageRequired,
  resolveStoredFile,
  uploadStoredFile,
} from './objectStorage.ts'

export async function storeGcodeBuffer(
  buffer: Buffer,
  opts?: { hint?: string },
): Promise<string> {
  const safeHint = (opts?.hint || 'print')
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
  const fileName = `gcode-${safeHint || 'print'}-${randomUUID().slice(0, 8)}.gcode`
  const uploadsDir = await getUploadsDir()
  const dest = path.join(uploadsDir, fileName)
  await fs.promises.writeFile(dest, buffer)
  if (objectStorageConfigured() || objectStorageRequired()) {
    try {
      await uploadStoredFile(dest, fileName, 'application/octet-stream')
    } catch (err) {
      console.warn('[gcode-storage] upload failed:', err instanceof Error ? err.message : err)
      if (objectStorageRequired() && !objectStorageConfigured()) {
        /* local file still usable in this process */
      }
    }
  }
  return fileName
}

export async function loadStoredGcode(
  fileName: string,
): Promise<{ buffer: Buffer; filename: string } | null> {
  const name = fileName.trim()
  if (!name) return null
  const resolved = await resolveStoredFile(name)
  if (!resolved) return null
  try {
    const buffer = await fs.promises.readFile(resolved.path)
    if (!buffer.length) return null
    return { buffer, filename: name.endsWith('.gcode') ? name : `${name}.gcode` }
  } finally {
    resolved.cleanup?.()
  }
}

/** Open stored G-code for streaming (avoids holding multi-MB buffers in RAM). */
export async function openStoredGcode(
  fileName: string,
): Promise<{ path: string; filename: string; cleanup?: () => void } | null> {
  const name = fileName.trim()
  if (!name) return null
  const resolved = await resolveStoredFile(name)
  if (!resolved) return null
  return {
    path: resolved.path,
    filename: name.endsWith('.gcode') ? name : `${name}.gcode`,
    cleanup: resolved.cleanup,
  }
}
