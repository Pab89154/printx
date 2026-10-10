import { Link } from 'react-router-dom'
import { ScrollReveal } from './ScrollReveal'
import { SectionHeading } from './SectionHeading'
import { Button } from './Button'

export function WhatWePrint() {
  return (
    <section id="shop-cta" className="bg-surface py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <ScrollReveal>
          <SectionHeading
            title="What We Print"
            subtitle="Order from our online catalog — pick a design and color, pay online, we print it."
          />
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <Button href="/shop" size="lg">
              Open shop catalog
            </Button>
            <Link to="/shop" className="text-sm font-semibold text-electric hover:underline">
              Shop approved designs →
            </Link>
          </div>
        </ScrollReveal>
      </div>
    </section>
  )
}
