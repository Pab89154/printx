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
    description: 'Based in the DFW area.',
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
    className:
      'border-cyan/20 hover:border-cyan hover:bg-cyan hover:text-white hover:shadow-cyan/20',
  },
  {
    step: 2,
    title: 'Visit Us',
    description: 'Come to the PrintX stand at the listed school.',
    icon: 'footprints' as const,
    className:
      'border-electric/20 hover:border-electric hover:bg-electric hover:text-white hover:shadow-electric/20',
  },
  {
    step: 3,
    title: 'Pick Your Print',
    description: 'Choose from the products available at the stand and purchase it in person.',
    icon: 'hand-coins' as const,
    className:
      'border-violet-300/50 hover:border-violet-600 hover:bg-violet-600 hover:text-white hover:shadow-violet-600/20',
  },
] as const

/** Offering cards — soft default + color fill on hover. */
export const SCHOOL_OFFERINGS = [
  {
    label: 'School stands',
    description: 'A pop-up stand where students can browse and buy prints in person.',
    icon: 'store' as const,
    cardClassName: 'border-cyan/20 hover:border-cyan hover:bg-cyan hover:shadow-cyan/20',
    iconClass: 'bg-cyan/10 text-cyan',
    iconHoverClass: 'group-hover:bg-white/20 group-hover:text-white',
  },
  {
    label: 'STEM activities',
    description: 'Hands-on demos that show how 3D printing turns ideas into real objects.',
    icon: 'flask' as const,
    cardClassName:
      'border-violet-300/50 hover:border-violet-600 hover:bg-violet-600 hover:shadow-violet-600/20',
    iconClass: 'bg-violet-100 text-violet-700',
    iconHoverClass: 'group-hover:bg-white/20 group-hover:text-white',
  },
  {
    label: 'Club events',
    description: 'Visit a club meeting with sample prints and talk about making + entrepreneurship.',
    icon: 'users' as const,
    cardClassName:
      'border-amber-300/50 hover:border-amber-600 hover:bg-amber-600 hover:shadow-amber-600/20',
    iconClass: 'bg-amber-100 text-amber-700',
    iconHoverClass: 'group-hover:bg-white/20 group-hover:text-white',
  },
  {
    label: 'School events',
    description: 'Fit right into fairs, open houses, and special school days.',
    icon: 'calendar' as const,
    cardClassName:
      'border-electric/20 hover:border-electric hover:bg-electric hover:shadow-electric/20',
    iconClass: 'bg-electric/10 text-electric',
    iconHoverClass: 'group-hover:bg-white/20 group-hover:text-white',
  },
  {
    label: 'Custom school items',
    description: 'Ask about school logos, club merch, and one-off classroom prints.',
    icon: 'sparkles' as const,
    cardClassName:
      'border-orange-300/50 hover:border-orange-500 hover:bg-orange-500 hover:shadow-orange-500/20',
    iconClass: 'bg-orange-100 text-orange-700',
    iconHoverClass: 'group-hover:bg-white/20 group-hover:text-white',
  },
] as const

export const SCHOOL_HOST_STEPS = [
  {
    step: 1,
    title: 'Email us',
    description: 'Share your school, preferred dates, and the kind of event you have in mind.',
  },
  {
    step: 2,
    title: 'Pick a plan',
    description:
      'We’ll confirm space needs and timing — stands can’t run during school hours (9:00 AM – 4:30 PM).',
  },
  {
    step: 3,
    title: 'We show up',
    description: 'PrintX brings the stand, the prints, and runs it so staff can stay hands-off.',
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
