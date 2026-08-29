import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import type { Stand, WebsiteContent } from './types.ts'

export type Db = DatabaseSync

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.PRINTX_DATA_DIR ?? path.join(__dirname, '..', 'data')
const DB_PATH = path.join(DATA_DIR, 'printx.db')
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads')

let db: Db | null = null

export function getDb(): Db {
  if (!db) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.mkdirSync(UPLOADS_DIR, { recursive: true })
    db = new DatabaseSync(DB_PATH)
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA foreign_keys = ON')
    migrate(db)
    migrateUserAuth(db)
    migrateEmojiToIcons(db)
    migrateContactEmail(db)
    seed(db)
    ensurePrimaryAdmin(db)
  }
  return db
}

export function getUploadsDir(): string {
  getDb()
  return UPLOADS_DIR
}

function migrate(database: Db) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
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
function migrateEmojiToIcons(database: Db) {
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
  const update = database.prepare('UPDATE products SET emoji = ? WHERE emoji = ?')
  for (const [emoji, icon] of Object.entries(map)) {
    update.run(icon, emoji)
  }
  database.prepare("UPDATE products SET emoji = 'printer-3d' WHERE emoji = 'printer'").run()
}

function resolveAdminEmail(): string {
  return (process.env.PRINTX_ADMIN_EMAIL?.trim() || 'pablo.molina@printx.pw').toLowerCase()
}

function resolveAdminPassword(): string {
  // Primary admin always boots with this password so Render env mismatches
  // cannot lock you out. Change it later from Admin → Settings if needed.
  return 'coolprints.X'
}

function ensurePrimaryAdmin(database: Db) {
  const adminEmail = resolveAdminEmail()
  const password = resolveAdminPassword()
  const hash = bcrypt.hashSync(password, 12)

  const byEmail = database.prepare(`
    SELECT id FROM users WHERE role = 'admin' AND LOWER(email) = ? LIMIT 1
  `).get(adminEmail) as { id: string } | undefined

  if (byEmail) {
    database.prepare('UPDATE users SET email = ?, password_hash = ?, email_verified = 1 WHERE id = ?').run(
      adminEmail,
      hash,
      byEmail.id,
    )
  } else {
    const fallback = database.prepare(`
      SELECT id FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1
    `).get() as { id: string } | undefined

    if (fallback) {
      database.prepare('UPDATE users SET email = ?, password_hash = ?, email_verified = 1 WHERE id = ?').run(
        adminEmail,
        hash,
        fallback.id,
      )
    } else {
      database.prepare(
        'INSERT INTO users (id, email, password_hash, role, email_verified, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(randomUUID(), adminEmail, hash, 'admin', 1, new Date().toISOString())
    }
  }

  // Invalidate old sessions so a fresh login is required after credential sync
  const primary = database.prepare(`
    SELECT id FROM users WHERE role = 'admin' AND LOWER(email) = ? LIMIT 1
  `).get(adminEmail) as { id: string } | undefined
  if (primary) {
    database.prepare('DELETE FROM sessions WHERE user_id = ?').run(primary.id)
  }

  console.log(`[printx] Primary admin ready: ${adminEmail}`)
}

function migrateUserAuth(database: Db) {
  try {
    database.exec('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0')
  } catch {
    /* column already exists */
  }
  database.prepare('UPDATE users SET email_verified = 1 WHERE role = ?').run('admin')
}

function migrateContactEmail(database: Db) {
  const row = database.prepare("SELECT value FROM website_settings WHERE key = 'contactEmail'").get() as
    | { value: string }
    | undefined
  if (row) {
    try {
      const email = JSON.parse(row.value) as string
      if (email === 'hello@printxmckinney.com') {
        database.prepare("UPDATE website_settings SET value = ?, updated_at = ? WHERE key = 'contactEmail'").run(
          JSON.stringify('hello@printx.pw'),
          new Date().toISOString(),
        )
      }
    } catch {
      /* ignore malformed settings */
    }
  }

  // Rename TikTok setting → WhatsApp channel URL
  const tiktok = database.prepare("SELECT value FROM website_settings WHERE key = 'contactTiktok'").get() as
    | { value: string }
    | undefined
  const whatsapp = database.prepare("SELECT value FROM website_settings WHERE key = 'contactWhatsapp'").get() as
    | { value: string }
    | undefined
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
    database.prepare('INSERT INTO website_settings (key, value, updated_at) VALUES (?, ?, ?)').run(
      'contactWhatsapp',
      value,
      now,
    )
  }
  if (tiktok) {
    database.prepare("DELETE FROM website_settings WHERE key = 'contactTiktok'").run()
  }

  const online = database.prepare("SELECT value FROM website_settings WHERE key = 'websiteOnline'").get()
  if (!online) {
    database.prepare('INSERT INTO website_settings (key, value, updated_at) VALUES (?, ?, ?)').run(
      'websiteOnline',
      JSON.stringify(true),
      new Date().toISOString(),
    )
  }
}

function seed(database: Db) {
  const productCount = database.prepare('SELECT COUNT(*) as c FROM products').get() as { c: number }
  if (productCount.c === 0) {
    const now = new Date().toISOString()
    const products = [
      ['fidget-toys', 'Fidget Toys', 'Spinners, clickers, and satisfying desk toys in fun colors.', 5, 'Toys', 'loader', 'from-blue-500 to-cyan-400', 1, 1, 1],
      ['keychains', 'Keychains', 'Custom name tags, logos, and shapes for backpacks and keys.', 4, 'Accessories', 'key-round', 'from-indigo-500 to-blue-400', 1, 1, 2],
      ['phone-stands', 'Phone Stands', 'Sturdy, colorful stands for desks, nightstands, and study spaces.', 8, 'Accessories', 'smartphone', 'from-cyan-500 to-teal-400', 1, 1, 3],
      ['desk-accessories', 'Desk Accessories', 'Organizers, cable clips, pen holders, and tidy-up tools.', 6, 'Desk', 'folder-open', 'from-violet-500 to-indigo-400', 1, 0, 4],
      ['school-accessories', 'School Accessories', 'Bookmarks, rulers, clips, and handy tools for class.', 3, 'School', 'book-open', 'from-sky-500 to-blue-400', 1, 0, 5],
      ['custom-designs', 'Custom Designs', 'Bring your own idea — ask us about printing it in PLA or PETG.', 10, 'Custom', 'sparkles', 'from-blue-600 to-cyan-500', 1, 1, 6],
    ]
    const stmt = database.prepare(`
      INSERT INTO products (id, name, description, price, category, image, emoji, image_gradient, available, featured, display_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const p of products) {
      stmt.run(...p, now, now)
    }
  }

  const schoolCount = database.prepare('SELECT COUNT(*) as c FROM schools').get() as { c: number }
  let mckinneySchoolId = ''
  if (schoolCount.c === 0) {
    const now = new Date().toISOString()
    mckinneySchoolId = randomUUID()
    database.prepare(
      'INSERT INTO schools (id, name, address, description, image, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(mckinneySchoolId, 'McKinney School', 'McKinney, TX', 'Home base for PrintX stands.', '', 1, now, now)
  } else {
    const row = database.prepare('SELECT id FROM schools WHERE name = ?').get('McKinney School') as { id: string } | undefined
    mckinneySchoolId = row?.id ?? ''
  }

  const standCount = database.prepare('SELECT COUNT(*) as c FROM stands').get() as { c: number }
  if (standCount.c === 0) {
    const now = new Date().toISOString()
    database.prepare(`
      INSERT INTO stands (id, school_id, school_name, date, start_time, end_time, location, description, notes, products_json, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
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

  const settingsCount = database.prepare('SELECT COUNT(*) as c FROM website_settings').get() as { c: number }
  if (settingsCount.c === 0) {
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
    const stmt = database.prepare('INSERT INTO website_settings (key, value, updated_at) VALUES (?, ?, ?)')
    for (const [key, value] of Object.entries(defaults)) {
      stmt.run(key, JSON.stringify(value), now)
    }
  }
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

export function getWebsiteContent(database: Db): WebsiteContent {
  const rows = database.prepare('SELECT key, value FROM website_settings').all() as { key: string; value: string }[]
  const content = {} as Record<string, unknown>
  for (const row of rows) {
    try {
      content[row.key] = JSON.parse(row.value)
    } catch {
      content[row.key] = row.value
    }
  }
  return {
    heroHeadline: '',
    heroDescription: '',
    aboutText: '',
    aboutTeam: '',
    contactEmail: 'hello@printx.pw',
    contactInstagram: '',
    contactWhatsapp: '',
    forSchoolsDescription: '',
    forSchoolsInstructions: '',
    announcementText: '',
    announcementEnabled: false,
    announcementExpiresAt: null,
    websiteOnline: true,
    ...content,
  } as WebsiteContent
}

export function setWebsiteSetting(database: Db, key: string, value: unknown) {
  const now = new Date().toISOString()
  database.prepare(`
    INSERT INTO website_settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, JSON.stringify(value), now)
}
