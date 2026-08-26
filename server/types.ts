export type StandStatus = 'upcoming' | 'active' | 'past'

export type RequestStatus = 'new' | 'reviewing' | 'approved' | 'declined' | 'completed'

export type User = {
  id: string
  email: string | null
  passwordHash: string
  role: 'admin'
  createdAt: string
}

export type Stand = {
  id: string
  schoolId: string | null
  schoolName: string
  date: string
  startTime: string
  endTime: string
  location: string
  description: string
  notes: string
  products: string[]
  status: StandStatus
  createdAt: string
  updatedAt: string
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
  createdAt: string
  updatedAt: string
}

export type CustomRequest = {
  id: string
  name: string
  email: string
  school: string
  description: string
  size: string
  uploadedFile: string | null
  status: RequestStatus
  createdAt: string
  updatedAt: string
}

export type School = {
  id: string
  name: string
  address: string
  description: string
  image: string
  active: boolean
  createdAt: string
  updatedAt: string
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

export type DashboardStats = {
  nextStand: Stand | null
  activeProducts: number
  newRequests: number
  websiteOnline: boolean
}

export type PublicBootstrap = {
  stands: Stand[]
  products: Product[]
  schools: School[]
  content: WebsiteContent
}
