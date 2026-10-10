import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { resolveImageUrl } from '../shared/imageUrl.ts'
import { setPrimaryAdminUserId } from '../shared/permissions.ts'
import type { Stand, WebsiteContent } from './types.ts'
import { closeDbApi, getDbApi, UPLOADS_DIR, type DbApi } from './dbClient.ts'

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
      permissions TEXT,
      display_name TEXT,
      mail_signature TEXT NOT NULL DEFAULT '',
      cloud_slicer_token TEXT NOT NULL DEFAULT '',
      cloud_slicer_printer_id TEXT NOT NULL DEFAULT '',
      cloud_slicer_filament_id TEXT NOT NULL DEFAULT '',
      cloud_slicer_configured_at TEXT,
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
      image_gradient TEXT NOT NULL DEFAULT 'from-navy to-electric',
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
      status TEXT NOT NULL DEFAULT 'new',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mail_messages (
      id TEXT PRIMARY KEY,
      sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      sender_deleted_at TEXT,
      scheduled_at TEXT
    );

    CREATE TABLE IF NOT EXISTS mail_recipients (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES mail_messages(id) ON DELETE CASCADE,
      recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      read_at TEXT,
      archived_at TEXT,
      deleted_at TEXT,
      UNIQUE (message_id, recipient_id)
    );

    CREATE TABLE IF NOT EXISTS website_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pricing_settings (
      id TEXT PRIMARY KEY,
      filament_usd_per_gram REAL NOT NULL DEFAULT 0.0289,
      electricity_usd_per_kwh REAL NOT NULL DEFAULT 0.15,
      margin_pct REAL NOT NULL DEFAULT 0.5,
      unproductive_adder_usd REAL NOT NULL DEFAULT 0.2,
      fixing_adder_usd REAL NOT NULL DEFAULT 0.05,
      sales_tax_pct REAL NOT NULL DEFAULT 0,
      custom_colors_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL,
      updated_by TEXT
    );

    CREATE TABLE IF NOT EXISTS printers (
      id TEXT PRIMARY KEY,
      owner_label TEXT NOT NULL,
      model_name TEXT NOT NULL,
      avg_power_kw REAL NOT NULL DEFAULT 0.2,
      active INTEGER NOT NULL DEFAULT 1,
      owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS designs (
      id TEXT PRIMARY KEY,
      sku_base TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'General',
      image_url TEXT NOT NULL DEFAULT '',
      stl_path TEXT NOT NULL DEFAULT '',
      slice_status TEXT NOT NULL DEFAULT 'idle',
      slice_error TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      submitted_at TEXT,
      reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at TEXT,
      review_note TEXT NOT NULL DEFAULT '',
      grams_pablo_p1s REAL,
      hours_pablo_p1s REAL,
      grams_court_ender REAL,
      hours_court_ender REAL,
      grams_josh_kobra REAL,
      hours_josh_kobra REAL,
      available_color_ids TEXT NOT NULL DEFAULT '[]',
      worst_cost_usd REAL,
      catalog_price_usd REAL,
      priced_at TEXT,
      pricing_inputs_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      customer_name TEXT NOT NULL DEFAULT '',
      customer_email TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending_payment',
      stripe_session_id TEXT,
      stripe_payment_intent TEXT,
      subtotal_usd REAL NOT NULL DEFAULT 0,
      total_usd REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'usd',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      paid_at TEXT
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      design_id TEXT NOT NULL REFERENCES designs(id) ON DELETE RESTRICT,
      sku TEXT NOT NULL,
      color_id TEXT NOT NULL,
      color_name TEXT NOT NULL DEFAULT '',
      qty INTEGER NOT NULL DEFAULT 1,
      unit_price_usd REAL NOT NULL DEFAULT 0,
      worst_cost_unit_usd REAL NOT NULL DEFAULT 0,
      line_total_usd REAL NOT NULL DEFAULT 0,
      print_status TEXT NOT NULL DEFAULT 'unclaimed',
      assigned_printer_id TEXT,
      assigned_admin_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      claimed_at TEXT,
      completed_at TEXT,
      reimburse_usd REAL,
      profit_usd REAL
    );

    CREATE TABLE IF NOT EXISTS profit_ledger (
      id TEXT PRIMARY KEY,
      order_item_id TEXT NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      entry_type TEXT NOT NULL,
      amount_usd REAL NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
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

async function readPrimaryAdminUserId(database: DbApi): Promise<string | null> {
  const row = await database.get<{ value: string }>(
    "SELECT value FROM website_settings WHERE key = 'primaryAdminUserId'",
  )
  if (!row?.value) return null
  try {
    const parsed = JSON.parse(row.value) as unknown
    return typeof parsed === 'string' && parsed.trim() ? parsed.trim() : null
  } catch {
    return typeof row.value === 'string' && row.value.trim() ? row.value.trim() : null
  }
}

async function persistPrimaryAdminUserId(database: DbApi, userId: string) {
  setPrimaryAdminUserId(userId)
  await setWebsiteSetting(database, 'primaryAdminUserId', userId)
}

async function ensurePrimaryAdmin(database: DbApi) {
  const adminEmail = resolveAdminEmail()
  const password = resolveAdminPassword()

  const storedId = await readPrimaryAdminUserId(database)
  if (storedId) {
    const byId = await database.get<{ id: string; email: string }>(
      `SELECT id, email FROM users WHERE id = ? AND role = 'admin'`,
      storedId,
    )
    if (byId) {
      // Keep login email as-is so in-app email changes survive deploys / cold starts.
      await database.run('UPDATE users SET email_verified = 1 WHERE id = ?', byId.id)
      setPrimaryAdminUserId(byId.id)
      console.log(`[printx] Primary admin ready: ${byId.email}`)
      return
    }
  }

  const byEmail = await database.get<{ id: string; email: string }>(
    `SELECT id, email FROM users WHERE role = 'admin' AND LOWER(email) = ? LIMIT 1`,
    adminEmail,
  )

  if (byEmail) {
    // Keep existing password + sessions. Resetting them on every boot caused
    // “Unauthorized” mid-session after Render cold starts / deploys.
    await database.run('UPDATE users SET email_verified = 1 WHERE id = ?', byEmail.id)
    await persistPrimaryAdminUserId(database, byEmail.id)
    console.log(`[printx] Primary admin ready: ${byEmail.email}`)
    return
  }

  const hash = bcrypt.hashSync(password, 12)
  const fallback = await database.get<{ id: string; email: string }>(
    `SELECT id, email FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1`,
  )

  if (fallback) {
    // Only reclaim the oldest admin when no primary id is stored yet (first boot / migration).
    await database.run(
      'UPDATE users SET email = ?, password_hash = ?, email_verified = 1 WHERE id = ?',
      adminEmail,
      hash,
      fallback.id,
    )
    await database.run('DELETE FROM sessions WHERE user_id = ?', fallback.id)
    await persistPrimaryAdminUserId(database, fallback.id)
    console.log(`[printx] Primary admin ready: ${adminEmail}`)
    return
  }

  const id = randomUUID()
  await database.run(
    'INSERT INTO users (id, email, password_hash, role, email_verified, permissions, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id,
    adminEmail,
    hash,
    'admin',
    1,
    null,
    new Date().toISOString(),
  )
  await persistPrimaryAdminUserId(database, id)
  console.log(`[printx] Primary admin ready: ${adminEmail}`)
}

async function migrateUserAuth(database: DbApi) {
  try {
    await database.exec('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0')
  } catch {
    /* column already exists */
  }
  try {
    await database.exec('ALTER TABLE users ADD COLUMN permissions TEXT')
  } catch {
    /* column already exists */
  }
  try {
    await database.exec('ALTER TABLE users ADD COLUMN display_name TEXT')
  } catch {
    /* column already exists */
  }
  try {
    await database.exec(`ALTER TABLE users ADD COLUMN mail_signature TEXT NOT NULL DEFAULT ''`)
  } catch {
    /* column already exists */
  }
  try {
    await database.exec(`ALTER TABLE users ADD COLUMN cloud_slicer_token TEXT NOT NULL DEFAULT ''`)
  } catch {
    /* column already exists */
  }
  try {
    await database.exec(`ALTER TABLE users ADD COLUMN cloud_slicer_printer_id TEXT NOT NULL DEFAULT ''`)
  } catch {
    /* column already exists */
  }
  try {
    await database.exec(`ALTER TABLE users ADD COLUMN cloud_slicer_filament_id TEXT NOT NULL DEFAULT ''`)
  } catch {
    /* column already exists */
  }
  try {
    await database.exec('ALTER TABLE users ADD COLUMN cloud_slicer_configured_at TEXT')
  } catch {
    /* column already exists */
  }
  await database.run('UPDATE users SET email_verified = 1 WHERE role = ?', 'admin')
}

async function migrateDesignStl(database: DbApi) {
  try {
    await database.exec(`ALTER TABLE designs ADD COLUMN stl_path TEXT NOT NULL DEFAULT ''`)
  } catch {
    /* column already exists */
  }
  try {
    await database.exec(`ALTER TABLE designs ADD COLUMN slice_status TEXT NOT NULL DEFAULT 'idle'`)
  } catch {
    /* column already exists */
  }
  try {
    await database.exec(`ALTER TABLE designs ADD COLUMN slice_error TEXT NOT NULL DEFAULT ''`)
  } catch {
    /* column already exists */
  }
}

async function migrateContactMessagesStatus(database: DbApi) {
  try {
    await database.exec(
      `ALTER TABLE contact_messages ADD COLUMN status TEXT NOT NULL DEFAULT 'new'`,
    )
  } catch {
    /* column already exists */
  }
}

async function migrateMailArchive(database: DbApi) {
  try {
    await database.exec('ALTER TABLE mail_recipients ADD COLUMN archived_at TEXT')
  } catch {
    /* column already exists */
  }
}

async function migrateMailTrash(database: DbApi) {
  try {
    await database.exec('ALTER TABLE mail_recipients ADD COLUMN deleted_at TEXT')
  } catch {
    /* column already exists */
  }
  try {
    await database.exec('ALTER TABLE mail_messages ADD COLUMN sender_deleted_at TEXT')
  } catch {
    /* column already exists */
  }
}

async function migrateMailSchedule(database: DbApi) {
  try {
    await database.exec('ALTER TABLE mail_messages ADD COLUMN scheduled_at TEXT')
  } catch {
    /* column already exists */
  }
}

/** Clear the old demo expiry that kept announcements hidden after Sept 2026. */
async function migrateStaleAnnouncementExpiry(database: DbApi) {
  const row = await database.get<{ value: string }>(
    "SELECT value FROM website_settings WHERE key = 'announcementExpiresAt'",
  )
  if (!row) return
  try {
    const value = JSON.parse(row.value) as string | null
    if (value === '2026-09-13') {
      await database.run(
        "UPDATE website_settings SET value = ?, updated_at = ? WHERE key = 'announcementExpiresAt'",
        JSON.stringify(null),
        new Date().toISOString(),
      )
    }
  } catch {
    /* ignore */
  }
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

/** Remap product card gradients to logo navy / cyan / electric only. */
/** Swap old McKinney-only default copy to DFW area (only when still the exact old defaults). */
async function migrateDfwAreaCopy(database: DbApi) {
  const replacements: Record<string, { from: string; to: string }> = {
    heroDescription: {
      from: 'Student-made 3D prints, sold locally at school stands throughout McKinney, Texas.',
      to: 'Student-made 3D prints, sold locally at school stands throughout the DFW area.',
    },
    aboutText: {
      from: 'PrintX was created by students who wanted to turn 3D printing into a real local business. What started as a passion for making things grew into a stand at schools across McKinney — where students can see, touch, and buy 3D-printed products made by people their age.',
      to: 'PrintX was created by students who wanted to turn 3D printing into a real local business. What started as a passion for making things grew into a stand at schools across the DFW area — where students can see, touch, and buy 3D-printed products made by people their age.',
    },
  }

  const now = new Date().toISOString()
  for (const [key, { from, to }] of Object.entries(replacements)) {
    const row = await database.get<{ value: string }>(
      'SELECT value FROM website_settings WHERE key = ?',
      key,
    )
    if (!row) continue
    try {
      const current = JSON.parse(row.value) as string
      if (current === from) {
        await database.run(
          'UPDATE website_settings SET value = ?, updated_at = ? WHERE key = ?',
          JSON.stringify(to),
          now,
          key,
        )
      }
    } catch {
      /* ignore malformed settings */
    }
  }
}

async function migrateBrandGradients(database: DbApi) {
  const remaps: Array<[string, string]> = [
    ['from-blue-500 to-cyan-400', 'from-navy to-electric'],
    ['from-indigo-500 to-blue-400', 'from-electric to-cyan'],
    ['from-cyan-500 to-teal-400', 'from-cyan to-electric'],
    ['from-violet-500 to-indigo-400', 'from-navy via-navy-mid to-cyan'],
    ['from-sky-500 to-blue-400', 'from-electric to-navy'],
    ['from-blue-600 to-cyan-500', 'from-cyan to-navy'],
  ]
  for (const [from, to] of remaps) {
    await database.run('UPDATE products SET image_gradient = ? WHERE image_gradient = ?', to, from)
  }
}

async function seed(database: DbApi) {
  // Once demo data has been offered, never re-insert it when admins clear tables.
  // (Render free tier restarts often — without this flag, deleted stands come back.)
  const seedFlag = await database.get<{ value: string }>(
    "SELECT value FROM website_settings WHERE key = 'demoDataSeeded'",
  )
  if (seedFlag) return

  const productCount = Number(
    (await database.get<{ c: number | string }>('SELECT COUNT(*) as c FROM products'))?.c ?? 0,
  )
  const schoolCount = Number(
    (await database.get<{ c: number | string }>('SELECT COUNT(*) as c FROM schools'))?.c ?? 0,
  )
  const standCount = Number(
    (await database.get<{ c: number | string }>('SELECT COUNT(*) as c FROM stands'))?.c ?? 0,
  )
  const settingsCount = Number(
    (await database.get<{ c: number | string }>('SELECT COUNT(*) as c FROM website_settings'))?.c ?? 0,
  )

  const isFreshInstall =
    productCount === 0 && schoolCount === 0 && standCount === 0 && settingsCount === 0

  if (!isFreshInstall) {
    // Existing database (admin may have deleted all stands on purpose) — lock seed forever.
    await database.run(
      'INSERT INTO website_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING',
      'demoDataSeeded',
      JSON.stringify(true),
      new Date().toISOString(),
    )
    return
  }

  const now = new Date().toISOString()
  const products = [
    ['fidget-toys', 'Fidget Toys', 'Spinners, clickers, and satisfying desk toys in fun colors.', 5, 'Toys', 'loader', 'from-navy to-electric', 1, 1, 1],
    ['keychains', 'Keychains', 'Custom name tags, logos, and shapes for backpacks and keys.', 4, 'Accessories', 'key-round', 'from-electric to-cyan', 1, 1, 2],
    ['phone-stands', 'Phone Stands', 'Sturdy, colorful stands for desks, nightstands, and study spaces.', 8, 'Accessories', 'smartphone', 'from-cyan to-electric', 1, 1, 3],
    ['desk-accessories', 'Desk Accessories', 'Organizers, cable clips, pen holders, and tidy-up tools.', 6, 'Desk', 'folder-open', 'from-navy via-navy-mid to-cyan', 1, 0, 4],
    ['school-accessories', 'School Accessories', 'Bookmarks, rulers, clips, and handy tools for class.', 3, 'School', 'book-open', 'from-electric to-navy', 1, 0, 5],
    ['custom-designs', 'Custom Designs', 'Bring your own idea — ask us about printing it in PLA or PETG.', 10, 'Custom', 'sparkles', 'from-cyan to-navy', 1, 1, 6],
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

  const mckinneySchoolId = randomUUID()
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

  await database.run(
    `INSERT INTO stands (id, school_id, school_name, date, start_time, end_time, location, description, notes, products_json, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    randomUUID(),
    mckinneySchoolId,
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

  const defaults: WebsiteContent = {
    heroHeadline: 'Your Ideas. Our Prints.',
    heroDescription: 'Student-made 3D prints, sold locally at school stands throughout the DFW area.',
    aboutText: 'PrintX was created by students who wanted to turn 3D printing into a real local business. What started as a passion for making things grew into a stand at schools across the DFW area — where students can see, touch, and buy 3D-printed products made by people their age.',
    aboutTeam: 'We believe in learning by doing — combining creativity, entrepreneurship, and technology to build something real for our community.',
    contactEmail: 'hello@printx.pw',
    contactInstagram: 'https://instagram.com',
    contactWhatsapp: '',
    forSchoolsDescription: 'Interested in having a PrintX stand at your school? Contact us to learn more about setting up a stand for your students, clubs, or events.',
    forSchoolsInstructions: 'Email us with your school name, preferred dates, and what kind of event you are planning.',
    announcementText: 'Next PrintX Stand: Friday at McKinney School!',
    announcementEnabled: false,
    announcementExpiresAt: null,
    websiteOnline: true,
  }
  for (const [key, value] of Object.entries(defaults)) {
    await database.run(
      'INSERT INTO website_settings (key, value, updated_at) VALUES (?, ?, ?)',
      key,
      JSON.stringify(value),
      now,
    )
  }

  await database.run(
    'INSERT INTO website_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING',
    'demoDataSeeded',
    JSON.stringify(true),
    now,
  )
}

async function initDb(): Promise<DbApi> {
  const database = await getDbApi()
  await migrate(database)
  await migrateUserAuth(database)
  await migrateDesignStl(database)
  await migrateContactMessagesStatus(database)
  await migrateMailArchive(database)
  await migrateMailTrash(database)
  await migrateMailSchedule(database)
  await migrateStaleAnnouncementExpiry(database)
  await migrateEmojiToIcons(database)
  await migrateContactEmail(database)
  await migrateBrandGradients(database)
  await migrateDfwAreaCopy(database)
  await seed(database)
  await ensurePrimaryAdmin(database)
  const { seedCatalogDefaults } = await import('./catalog.ts')
  await seedCatalogDefaults(database)
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

/** Release DB resources so Vite config/server restarts do not leak Supabase sessions. */
export async function closeDb(): Promise<void> {
  ready = false
  readyPromise = null
  await closeDbApi()
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
    // Unwrap Brave/search proxy URLs — those proxies block hotlinking in the browser.
    image: resolveImageUrl(row.image as string),
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
    heroDescription: 'Student-made 3D prints, sold locally at school stands throughout the DFW area.',
    aboutText:
      'PrintX was created by students who wanted to turn 3D printing into a real local business. What started as a passion for making things grew into a stand at schools across the DFW area — where students can see, touch, and buy 3D-printed products made by people their age.',
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
    announcementEnabled: false,
    announcementExpiresAt: null,
    websiteOnline: true,
  }

  const merged = { ...defaults, ...content } as WebsiteContent

  // Treat blank strings as missing so wiped admin saves don't blank the public site
  for (const [key, fallback] of Object.entries(defaults) as [keyof WebsiteContent, WebsiteContent[keyof WebsiteContent]][]) {
    const value = merged[key]
    // Optional date: empty/null means "no expiration" (do not revive an old seed date)
    if (key === 'announcementExpiresAt') {
      if (value === undefined) {
        ;(merged as Record<string, unknown>)[key] = null
      } else if (value === '' || value === null) {
        ;(merged as Record<string, unknown>)[key] = null
      }
      continue
    }
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
