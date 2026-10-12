export type StandStatus = 'upcoming' | 'active' | 'past'
export type RequestStatus =
  | 'awaiting_payment'
  | 'new'
  | 'reviewing'
  | 'approved'
  | 'declined'
  | 'completed'

export type PublicStand = {
  id: string
  schoolName: string
  date: string
  displayDate: string
  startTime: string
  endTime: string
  time: string
  location: string
  description: string
  notes: string
  products: string[]
  status: StandStatus
}

export type Product = {
  id: string
  name: string
  description: string
  price: number
  category: string
  image: string
  emoji: string
  imageGradient: string
  available: boolean
  featured: boolean
  displayOrder: number
}

export type WebsiteContent = {
  heroHeadline: string
  heroDescription: string
  aboutText: string
  aboutTeam: string
  contactEmail: string
  contactInstagram: string
  contactWhatsapp: string
  forSchoolsDescription: string
  forSchoolsInstructions: string
  announcementText: string
  announcementEnabled: boolean
  announcementExpiresAt: string | null
  /** When false, public site shows a temporary “planning prints” screen. Admin stays available. */
  websiteOnline: boolean
}

export type PublicBootstrap = {
  stands: PublicStand[]
  pastStands: PublicStand[]
  products: Product[]
  schools: Record<string, unknown>[]
  content: WebsiteContent
  announcementActive: boolean
}

export type DashboardStats = {
  nextStand: PublicStand | null
  activeProducts: number
  newRequests: number
  newMessages: number
  websiteOnline: boolean
}

export type ContactMessage = {
  id: string
  name: string
  email: string
  inquiry_type: string
  message: string
  status: 'new' | 'read'
  created_at: string
}

export type CustomRequest = {
  id: string
  name: string
  email: string
  school: string
  description: string
  size: string
  uploaded_file: string | null
  status: RequestStatus
  slice_status: string
  slice_error: string
  grams_pablo_p1s: number | null
  hours_pablo_p1s: number | null
  grams_court_ender: number | null
  hours_court_ender: number | null
  grams_josh_kobra: number | null
  hours_josh_kobra: number | null
  worst_printer_id: string | null
  worst_cost_usd: number | null
  catalog_price_usd: number | null
  quoted_at: string | null
  has_gcode: boolean
  shipping_name: string
  shipping_line1: string
  shipping_line2: string
  shipping_city: string
  shipping_state: string
  shipping_postal: string
  shipping_country: string
  shipping_method: string
  shipping_usd: number
  created_at: string
  updated_at: string
}

export type School = {
  id: string
  name: string
  address: string
  description: string
  image: string
  active: number
}

export type Stand = PublicStand & {
  schoolId: string | null
  createdAt: string
  updatedAt: string
}

export type AdminPermissions = {
  dashboard: boolean
  messages: boolean
  mail: boolean
  stands: boolean
  products: boolean
  orders: boolean
  requests: boolean
  content: boolean
  sandbox: boolean
  settings: boolean
  website_status: boolean
  manage_admins: boolean
}

export type MailRecipientOption = {
  id: string
  email: string
  displayName: string | null
}

export type MailTrashSource = 'received' | 'sent' | 'both'

export type MailMessage = {
  id: string
  subject: string
  body: string
  createdAt: string
  senderId: string
  senderEmail: string
  senderDisplayName: string | null
  readAt: string | null
  archivedAt: string | null
  deletedAt: string | null
  senderDeletedAt: string | null
  scheduledAt: string | null
  /** Present on Trash mailbox items — controls restore destination. */
  trashSource?: MailTrashSource
  recipients: MailRecipientOption[]
}

export type AdminUser = {
  id: string
  email: string
  displayName: string | null
  emailVerified: boolean
  createdAt: string
  isMainAdmin: boolean
  permissions: AdminPermissions
}
