export type Product = {
  id: string
  name: string
  description: string
  price: number
  imageGradient: string
  emoji: string
}

export const PRODUCTS: Product[] = [
  {
    id: 'fidget-toys',
    name: 'Fidget Toys',
    description: 'Spinners, clickers, and satisfying desk toys in fun colors.',
    price: 5,
    imageGradient: 'from-navy to-electric',
    emoji: '🌀',
  },
  {
    id: 'keychains',
    name: 'Keychains',
    description: 'Custom name tags, logos, and shapes for backpacks and keys.',
    price: 4,
    imageGradient: 'from-electric to-cyan',
    emoji: '🔑',
  },
  {
    id: 'phone-stands',
    name: 'Phone Stands',
    description: 'Sturdy, colorful stands for desks, nightstands, and study spaces.',
    price: 8,
    imageGradient: 'from-cyan to-electric',
    emoji: '📱',
  },
  {
    id: 'desk-accessories',
    name: 'Desk Accessories',
    description: 'Organizers, cable clips, pen holders, and tidy-up tools.',
    price: 6,
    imageGradient: 'from-navy via-navy-mid to-cyan',
    emoji: '🗂️',
  },
  {
    id: 'school-accessories',
    name: 'School Accessories',
    description: 'Bookmarks, rulers, clips, and handy tools for class.',
    price: 3,
    imageGradient: 'from-electric to-navy',
    emoji: '📚',
  },
  {
    id: 'custom-designs',
    name: 'Custom Designs',
    description: 'Bring your own idea — ask us about printing it in PLA or PETG.',
    price: 10,
    imageGradient: 'from-cyan to-navy',
    emoji: '✨',
  },
]

export const WHY_FEATURES = [
  {
    title: 'Local',
    description: 'Based in McKinney, Texas.',
    icon: 'map-pin' as const,
  },
  {
    title: 'Student Run',
    description: 'Created and operated by students.',
    icon: 'graduation-cap' as const,
  },
  {
    title: 'In Person',
    description: 'See and buy our products at local school stands.',
    icon: 'store' as const,
  },
  {
    title: '3D Printed',
    description: 'Every product is made using 3D-printing technology.',
    icon: 'printer-3d' as const,
  },
] as const

export const HOW_TO_BUY = [
  {
    step: 1,
    title: 'Find a Stand',
    description: 'Check the website to see when and where our next stand will be.',
    icon: 'map-pin' as const,
  },
  {
    step: 2,
    title: 'Visit Us',
    description: 'Come to the PrintX stand at the listed school.',
    icon: 'footprints' as const,
  },
  {
    step: 3,
    title: 'Pick Your Print',
    description: 'Choose from the products available at the stand and purchase it in person.',
    icon: 'hand-coins' as const,
  },
] as const

export const SCHOOL_OFFERINGS = [
  'School stands',
  'STEM activities',
  'Club events',
  'School events',
  'Custom school items',
] as const

export const ABOUT_VALUES = [
  'Creativity',
  'Entrepreneurship',
  'Technology',
  'Making',
  'Community',
] as const
