import { WHY_FEATURES } from '../data/products'
import { FeatureCard } from './FeatureCard'
import { ScrollReveal } from './ScrollReveal'
import { SectionHeading } from './SectionHeading'

export function WhyPrintX() {
  return (
    <section className="bg-surface py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <ScrollReveal>
          <SectionHeading title="Why PrintX?" />
        </ScrollReveal>

        <div className="grid items-stretch gap-6 py-1 sm:grid-cols-2 lg:grid-cols-4">
          {WHY_FEATURES.map((feature, i) => (
            <ScrollReveal key={feature.title} delay={i * 80} className="h-full">
              <FeatureCard
                title={feature.title}
                description={feature.description}
                icon={feature.icon}
              />
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  )
}
