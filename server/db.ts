import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import type { Stand, WebsiteContent } from './types.ts'
import { getDbApi, UPLOADS_DIR, type DbApi } from './dbClient.ts'

export type Db = DbApi

let ready = false
let readyPromise: Promise<DbApi> | null = null

async function migrate(database: DbApi) {
  await database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      email_verified INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS schools (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      image TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stands (
      id TEXT PRIMARY KEY,
      school_id TEXT REFERENCES schools(id) ON DELETE SET NULL,
      school_name TEXT NOT NULL,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      location TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      products_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'upcoming',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      price REAL NOT NULL DEFAULT 0,
      category TEXT NOT NULL DEFAULT 'General',
      image TEXT NOT NULL DEFAULT '',
      emoji TEXT NOT NULL DEFAULT 'package',
      image_gradient TEXT NOT NULL DEFAULT 'from-blue-500 to-cyan-400',
      available INTEGER NOT NULL DEFAULT 1,
      featured INTEGER NOT NULL DEFAULT 0,
      display_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS custom_requests (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      school TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      size TEXT NOT NULL DEFAULT '',
      uploaded_file TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS contact_messages (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      inquiry_type TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS website_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)
}

/** Convert legacy emoji product icons to Lucide CDN icon names. */
async function migrateEmojiToIcons(database: DbApi) {
  const map: Record<string, string> = {
    '🌀': 'loader',
    '🔑': 'key-round',
    '📱': 'smartphone',
    '🗂️': 'folder-open',
    '📚': 'book-open',
    '✨': 'sparkles',
    '📦': 'package',
    '🖨️': 'printer-3d',
  }
  for (const [emoji, icon] of Object.entries(map)) {
    await database.run('UPDATE products SET emoji = ? WHERE emoji = ?', icon, emoji)
  }
  await database.run("UPDATE products SET emoji = 'printer-3d' WHERE emoji = 'printer'")
}

function resolveAdminEmail(): string {
  return (process.env.PRINTX_ADMIN_EMAIL?.trim() || 'pablo.molina@printx.pw').toLowerCase()
}

function resolveAdminPassword(): string {
  // Primary admin always boots with this password so Render env mismatches
  // cannot lock you out. Change it later from Admin → Settings if needed.
  return 'coolprints.X'
}

async function ensurePrimaryAdmin(database: DbApi) {
  const adminEmail = resolveAdminEmail()
  const password = resolveAdminPassword()
  const hash = bcrypt.hashSync(password, 12)

  const byEmail = await database.get<{ id: string }>(
    `SELECT id FROM users WHERE role = 'admin' AND LOWER(email) = ? LIMIT 1`,
    adminEmail,
  )

  if (byEmail) {
    await database.run(
      'UPDATE users SET email = ?, password_hash = ?, email_verified = 1 WHERE id = ?',
      adminEmail,
      hash,
      byEmail.id,
    )
  } else {
    const fallback = await database.get<{ id: string }>(
      `SELECT id FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1`,
    )

    if (fallback) {
      await database.run(
        'UPDATE users SET email = ?, password_hash = ?, email_verified = 1 WHERE id = ?',
        adminEmail,
        hash,
        fallback.id,
      )
    } else {
      await database.run(
        'INSERT INTO users (id, email, password_hash, role, email_verified, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        randomUUID(),
        adminEmail,
        hash,
        'admin',
        1,
        new Date().toISOString(),
      )
    }
  }

  // Invalidate old sessions so a fresh login is required after credential sync
  const primary = await database.get<{ id: string }>(
    `SELECT id FROM users WHERE role = 'admin' AND LOWER(email) = ? LIMIT 1`,
    adminEmail,
  )
  if (primary) {
    await database.run('DELETE FROM sessions WHERE user_id = ?', primary.id)
  }

  console.log(`[printx] Primary admin ready: ${adminEmail}`)
}

async function migrateUserAuth(database: DbApi) {
  try {
    await database.exec('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0')
  } catch {
    /* column already exists */
  }
  await database.run('UPDATE users SET email_verified = 1 WHERE role = ?', 'admin')
}

async function migrateContactEmail(database: DbApi) {
  const row = await database.get<{ value: string }>(
    "SELECT value FROM website_settings WHERE key = 'contactEmail'",
  )
  if (row) {
    try {
      const email = JSON.parse(row.value) as string
      if (email === 'hello@printxmckinney.com') {
        await database.run(
          "UPDATE website_settings SET value = ?, updated_at = ? WHERE key = 'contactEmail'",
          JSON.stringify('hello@printx.pw'),
          new Date().toISOString(),
        )
      }
    } catch {
      /* ignore malformed settings */
    }
  }

  // Rename TikTok setting → WhatsApp channel URL
  const tiktok = await database.get<{ value: string }>(
    "SELECT value FROM website_settings WHERE key = 'contactTiktok'",
  )
  const whatsapp = await database.get<{ value: string }>(
    "SELECT value FROM website_settings WHERE key = 'contactWhatsapp'",
  )
  if (!whatsapp) {
    const now = new Date().toISOString()
    let value = '""'
    if (tiktok) {
      try {
        const parsed = JSON.parse(tiktok.value) as string
        // Don't carry over placeholder TikTok URLs
        value = JSON.stringify(parsed.includes('tiktok.com') ? '' : parsed)
      } catch {
        value = '""'
      }
    }
    await database.run(
      'INSERT INTO website_settings (key, value, updated_at) VALUES (?, ?, ?)',
      'contactWhatsapp',
      value,
      now,
    )
  }
  if (tiktok) {
    await database.run("DELETE FROM website_settings WHERE key = 'contactTiktok'")
  }

  const online = await database.get("SELECT value FROM website_settings WHERE key = 'websiteOnline'")
  if (!online) {
    await database.run(
      'INSERT INTO website_settings (key, value, updated_at) VALUES (?, ?, ?)',
      'websiteOnline',
      JSON.stringify(true),
      new Date().toISOString(),
    )
  }
}

async function seed(database: DbApi) {
  const productCount = await database.get<{ c: number | string }>('SELECT COUNT(*) as c FROM products')
  if (Number(productCount?.c ?? 0) === 0) {
    const now = new Date().toISOString()
    const products = [
      ['fidget-toys', 'Fidget Toys', 'Spinners, clickers, and satisfying desk toys in fun colors.', 5, 'Toys', 'loader', 'from-blue-500 to-cyan-400', 1, 1, 1],
      ['keychains', 'Keychains', 'Custom name tags, logos, and shapes for backpacks and keys.', 4, 'Accessories', 'key-round', 'from-indigo-500 to-blue-400', 1, 1, 2],
      ['phone-stands', 'Phone Stands', 'Sturdy, colorful stands for desks, nightstands, and study spaces.', 8, 'Accessories', 'smartphone', 'from-cyan-500 to-teal-400', 1, 1, 3],
      ['desk-accessories', 'Desk Accessories', 'Organizers, cable clips, pen holders, and tidy-up tools.', 6, 'Desk', 'folder-open', 'from-violet-500 to-indigo-400', 1, 0, 4],
      ['school-accessories', 'School Accessories', 'Bookmarks, rulers, clips, and handy tools for class.', 3, 'School', 'book-open', 'from-sky-500 to-blue-400', 1, 0, 5],
      ['custom-designs', 'Custom Designs', 'Bring your own idea — ask us about printing it in PLA or PETG.', 10, 'Custom', 'sparkles', 'from-blue-600 to-cyan-500', 1, 1, 6],
    ]
    for (const p of products) {
      await database.run(
        `INSERT INTO products (id, name, description, price, category, image, emoji, image_gradient, available, featured, display_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?)`,
        ...p,
        now,
        now,
      )
    }
  }

  const schoolCount = await database.get<{ c: number | string }>('SELECT COUNT(*) as c FROM schools')
  let mckinneySchoolId = ''
  if (Number(schoolCount?.c ?? 0) === 0) {
    const now = new Date().toISOString()
    mckinneySchoolId = randomUUID()
    await database.run(
      'INSERT INTO schools (id, name, address, description, image, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      mckinneySchoolId,
      'McKinney School',
      'McKinney, TX',
      'Home base for PrintX stands.',
      '',
      1,
      now,
      now,
    )
  } else {
    const row = await database.get<{ id: string }>('SELECT id FROM schools WHERE name = ?', 'McKinney School')
    mckinneySchoolId = row?.id ?? ''
  }

  const standCount = await database.get<{ c: number | string }>('SELECT COUNT(*) as c FROM stands')
  if (Number(standCount?.c ?? 0) === 0) {
    const now = new Date().toISOString()
    await database.run(
      `INSERT INTO stands (id, school_id, school_name, date, start_time, end_time, location, description, notes, products_json, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      randomUUID(),
      mckinneySchoolId || null,
      'McKinney School',
      '2026-09-12',
      '3:15 PM',
      '4:30 PM',
      'School cafeteria',
      'Our next stand — come check out fidgets, keychains, and more!',
      '',
      JSON.stringify(['Fidget Toys', 'Keychains', 'Phone Stands', 'Desk Accessories']),
      'upcoming',
      now,
      now,
    )
  }

  const settingsCount = await database.get<{ c: number | string }>('SELECT COUNT(*) as c FROM website_settings')
  if (Number(settingsCount?.c ?? 0) === 0) {
    const defaults: WebsiteContent = {
      heroHeadline: 'Your Ideas. Our Prints.',
      heroDescription: 'Student-made 3D prints, sold locally at school stands throughout McKinney, Texas.',
      aboutText: 'PrintX was created by students who wanted to turn 3D printing into a real local business. What started as a passion for making things grew into a stand at schools across McKinney — where students can see, touch, and buy 3D-printed products made by people their age.',
      aboutTeam: 'We believe in learning by doing — combining creativity, entrepreneurship, and technology to build something real for our community.',
      contactEmail: 'hello@printx.pw',
      contactInstagram: 'https://instagram.com',
      contactWhatsapp: '',
      forSchoolsDescription: 'Interested in having a PrintX stand at your school? Contact us to learn more about setting up a stand for your students, clubs, or events.',
      forSchoolsInstructions: 'Email us with your school name, preferred dates, and what kind of event you are planning.',
      announcementText: 'Next PrintX Stand: Friday at McKinney School!',
      announcementEnabled: true,
      announcementExpiresAt: '2026-09-13',
      websiteOnline: true,
    }
    const now = new Date().toISOString()
    for (const [key, value] of Object.entries(defaults)) {
      await database.run(
        'INSERT INTO website_settings (key, value, updated_at) VALUES (?, ?, ?)',
        key,
        JSON.stringify(value),
        now,
      )
    }
  }
}

async function initDb(): Promise<DbApi> {
  const database = await getDbApi()
  await migrate(database)
  await migrateUserAuth(database)
  await migrateEmojiToIcons(database)
  await migrateContactEmail(database)
  await seed(database)
  await ensurePrimaryAdmin(database)
  ready = true
  return database
}

/** Initialize once (migrate, seed, ensurePrimaryAdmin). Safe to call repeatedly. */
export async function ensureDbReady(): Promise<DbApi> {
  if (ready) return getDbApi()
  if (!readyPromise) {
    readyPromise = initDb().catch((err) => {
      readyPromise = null
      throw err
    })
  }
  return readyPromise
}

export async function getDb(): Promise<DbApi> {
  return ensureDbReady()
}

export async function getUploadsDir(): Promise<string> {
  await ensureDbReady()
  return UPLOADS_DIR
}

export function rowToStand(row: Record<string, unknown>): Stand {
  return {
    id: row.id as string,
    schoolId: (row.school_id as string | null) ?? null,
    schoolName: row.school_name as string,
    date: row.date as string,
    startTime: row.start_time as string,
    endTime: row.end_time as string,
    location: row.location as string,
    description: row.description as string,
    notes: row.notes as string,
    products: JSON.parse((row.products_json as string) || '[]') as string[],
    status: row.status as Stand['status'],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

export function rowToProduct(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    name: row.name as string,
    description: row.description as string,
    price: row.price as number,
    category: row.category as string,
    image: row.image as string,
    emoji: row.emoji as string,
    imageGradient: row.image_gradient as string,
    available: Boolean(row.available),
    featured: Boolean(row.featured),
    displayOrder: row.display_order as number,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

export async function getWebsiteContent(database: DbApi): Promise<WebsiteContent> {
  const rows = await database.all<{ key: string; value: string }>('SELECT key, value FROM website_settings')
  const content = {} as Record<string, unknown>
  for (const row of rows) {
    try {
      content[row.key] = JSON.parse(row.value)
    } catch {
      content[row.key] = row.value
    }
  }

  const defaults: WebsiteContent = {
    heroHeadline: 'Your Ideas. Our Prints.',
    heroDescription: 'Student-made 3D prints, sold locally at school stands throughout McKinney, Texas.',
    aboutText:
      'PrintX was created by students who wanted to turn 3D printing into a real local business. What started as a passion for making things grew into a stand at schools across McKinney — where students can see, touch, and buy 3D-printed products made by people their age.',
    aboutTeam:
      'We believe in learning by doing — combining creativity, entrepreneurship, and technology to build something real for our community.',
    contactEmail: 'hello@printx.pw',
    contactInstagram: '',
    contactWhatsapp: '',
    forSchoolsDescription:
      'Interested in having a PrintX stand at your school? Contact us to learn more about setting up a stand for your students, clubs, or events.',
    forSchoolsInstructions:
      'Email us with your school name, preferred dates, and what kind of event you are planning.',
    announcementText: 'Next PrintX Stand: Friday at McKinney School!',
    announcementEnabled: true,
    announcementExpiresAt: '2026-09-13',
    websiteOnline: true,
  }

  const merged = { ...defaults, ...content } as WebsiteContent

  // Treat blank strings as missing so wiped admin saves don't blank the public site
  for (const [key, fallback] of Object.entries(defaults) as [keyof WebsiteContent, WebsiteContent[keyof WebsiteContent]][]) {
    const value = merged[key]
    if (typeof fallback === 'string' && typeof value === 'string' && value.trim() === '') {
      ;(merged as Record<string, unknown>)[key] = fallback
    }
    if (value === undefined || value === null) {
      ;(merged as Record<string, unknown>)[key] = fallback
    }
  }

  return merged
}

export async function setWebsiteSetting(database: DbApi, key: string, value: unknown) {
  const now = new Date().toISOString()
  await database.run(
    `
    INSERT INTO website_settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `,
    key,
    JSON.stringify(value),
    now,
  )
}
