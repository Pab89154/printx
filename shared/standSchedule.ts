/** Parse "3:00 PM" / "15:00" style times into 24h hours + minutes. */
export function parseStandTime(raw: string): { hours: number; minutes: number } | null {
  const value = raw.trim()
  if (!value) return null

  const ampm = value.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/)
  if (ampm) {
    let hours = Number(ampm[1])
    const minutes = Number(ampm[2])
    const period = ampm[3].toUpperCase()
    if (hours < 1 || hours > 12 || minutes > 59) return null
    if (period === 'AM') {
      if (hours === 12) hours = 0
    } else if (hours !== 12) {
      hours += 12
    }
    return { hours, minutes }
  }

  const military = value.match(/^(\d{1,2}):(\d{2})$/)
  if (military) {
    const hours = Number(military[1])
    const minutes = Number(military[2])
    if (hours > 23 || minutes > 59) return null
    return { hours, minutes }
  }

  return null
}

/** Combine YYYY-MM-DD + stand time into a local Date. */
export function standDateTime(date: string, time: string): Date | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim())
  const parsedTime = parseStandTime(time)
  if (!dateMatch || !parsedTime) return null
  const year = Number(dateMatch[1])
  const month = Number(dateMatch[2]) - 1
  const day = Number(dateMatch[3])
  return new Date(year, month, day, parsedTime.hours, parsedTime.minutes, 0, 0)
}

/** End of the stand (end time if set, otherwise start time). */
export function standEndDateTime(
  date: string,
  startTime: string,
  endTime?: string | null,
): Date | null {
  if (endTime?.trim()) {
    const end = standDateTime(date, endTime)
    if (end) return end
  }
  return standDateTime(date, startTime)
}

/** True once the stand's end time has passed. */
export function isStandFinished(
  date: string,
  startTime: string,
  endTime?: string | null,
  now = new Date(),
): boolean {
  const end = standEndDateTime(date, startTime, endTime)
  if (!end) return false
  return end.getTime() < now.getTime()
}

/** True when the stand date is a year or more before today (local calendar). */
export function isStandOlderThanOneYear(date: string, now = new Date()): boolean {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim())
  if (!dateMatch) return false
  const standDay = new Date(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]))
  const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate())
  return standDay.getTime() <= oneYearAgo.getTime()
}

/** School-day window when PrintX cannot run stands (minutes from midnight). */
const SCHOOL_BLOCK_START_MIN = 9 * 60 // 9:00 AM
const SCHOOL_BLOCK_END_MIN = 16 * 60 + 30 // 4:30 PM

function timeToMinutes(raw: string): number | null {
  const parsed = parseStandTime(raw)
  if (!parsed) return null
  return parsed.hours * 60 + parsed.minutes
}

/**
 * Upcoming/active stands cannot be scheduled in the past,
 * and cannot overlap school hours (9:00 AM – 4:30 PM).
 * Status "past" is allowed for historical records.
 */
export function validateStandSchedule(input: {
  date: string
  startTime: string
  endTime?: string
  status?: string
}): string | null {
  const status = input.status || 'upcoming'
  if (status === 'past') return null

  if (!input.date?.trim()) return 'Please choose a date for the stand.'
  if (!input.startTime?.trim()) return 'Please enter a start time.'

  const start = standDateTime(input.date, input.startTime)
  if (!start) {
    return 'Use a valid date and time (for example 3:00 PM).'
  }

  if (start.getTime() < Date.now()) {
    return 'That stand time is in the past. Pick a future date and time.'
  }

  const startMin = timeToMinutes(input.startTime)
  if (startMin == null) {
    return 'Use a valid date and time (for example 3:00 PM).'
  }

  let endMin = startMin
  if (input.endTime?.trim()) {
    const end = standDateTime(input.date, input.endTime)
    if (end && end.getTime() < start.getTime()) {
      return 'End time must be after the start time.'
    }
    const parsedEnd = timeToMinutes(input.endTime)
    if (parsedEnd != null) endMin = parsedEnd
  }

  // Overlaps [9:00 AM, 4:30 PM)
  if (startMin < SCHOOL_BLOCK_END_MIN && endMin > SCHOOL_BLOCK_START_MIN) {
    return 'Stands can’t run during school hours (9:00 AM – 4:30 PM). Choose a time before 9:00 AM or at/after 4:30 PM.'
  }

  return null
}
