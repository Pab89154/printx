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
          <div className="mt-2 flex justify-center">
            <Button href="/shop" size="lg" className="!min-h-14 !px-10 !text-lg sm:!min-h-16 sm:!px-12 sm:!text-xl">
              Open shop catalog
            </Button>
          </div>
        </ScrollReveal>
      </div>
    </section>
  )
}
