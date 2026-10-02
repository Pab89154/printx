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

/**
 * Upcoming/active stands cannot be scheduled in the past.
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

  if (input.endTime?.trim()) {
    const end = standDateTime(input.date, input.endTime)
    if (end && end.getTime() < start.getTime()) {
      return 'End time must be after the start time.'
    }
  }

  return null
}
