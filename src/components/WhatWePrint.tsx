import { usePublicData } from '../context/PublicDataContext'
import { ProductCard } from './ProductCard'
import { ScrollReveal } from './ScrollReveal'
import { SectionHeading } from './SectionHeading'

export function WhatWePrint() {
  const { data } = usePublicData()
  const products = data?.products ?? []

  return (
    <section id="products" className="bg-surface py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <ScrollReveal>
          <SectionHeading
            title="What We Print"
            subtitle="Browse our products — available in person at PrintX stands around McKinney."
          />
        </ScrollReveal>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((product, i) => (
            <ScrollReveal key={product.id} delay={i * 80}>
              <ProductCard product={product} />
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  )
}
