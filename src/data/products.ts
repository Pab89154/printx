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

/** Soft chip + hover fill — full Tailwind classes so JIT can see them. */
export const SCHOOL_OFFERINGS = [
  {
    label: 'School stands',
    className:
      'border-cyan/25 bg-cyan/5 text-cyan hover:border-cyan hover:bg-cyan hover:text-white',
  },
  {
    label: 'STEM activities',
    className:
      'border-violet-300/60 bg-violet-50 text-violet-700 hover:border-violet-600 hover:bg-violet-600 hover:text-white',
  },
  {
    label: 'Club events',
    className:
      'border-amber-300/60 bg-amber-50 text-amber-700 hover:border-amber-600 hover:bg-amber-600 hover:text-white',
  },
  {
    label: 'School events',
    className:
      'border-electric/25 bg-electric/5 text-electric hover:border-electric hover:bg-electric hover:text-white',
  },
  {
    label: 'Custom school items',
    className:
      'border-orange-300/60 bg-orange-50 text-orange-700 hover:border-orange-500 hover:bg-orange-500 hover:text-white',
  },
] as const

/** About value chips — each color matches the feeling of the word. */
export const ABOUT_VALUES = [
  {
    label: 'Creativity',
    className:
      'border-violet-300/60 bg-violet-50 text-violet-700 hover:border-violet-600 hover:bg-violet-600 hover:text-white',
  },
  {
    label: 'Entrepreneurship',
    className:
      'border-amber-300/60 bg-amber-50 text-amber-700 hover:border-amber-600 hover:bg-amber-600 hover:text-white',
  },
  {
    label: 'Technology',
    className:
      'border-cyan/30 bg-cyan/5 text-cyan hover:border-cyan hover:bg-cyan hover:text-white',
  },
  {
    label: 'Making',
    className:
      'border-orange-300/60 bg-orange-50 text-orange-700 hover:border-orange-500 hover:bg-orange-500 hover:text-white',
  },
  {
    label: 'Community',
    className:
      'border-emerald-300/60 bg-emerald-50 text-emerald-700 hover:border-emerald-600 hover:bg-emerald-600 hover:text-white',
  },
] as const
