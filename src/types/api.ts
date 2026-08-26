export type StandStatus = 'upcoming' | 'active' | 'past'
export type RequestStatus = 'new' | 'reviewing' | 'approved' | 'declined' | 'completed'

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
  contactTiktok: string
  forSchoolsDescription: string
  forSchoolsInstructions: string
  announcementText: string
  announcementEnabled: boolean
  announcementExpiresAt: string | null
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
  websiteOnline: boolean
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
