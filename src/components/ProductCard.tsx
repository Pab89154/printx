import type { Product } from '../types/api'
import { resolveImageUrl } from '../lib/imageUrl'
import { WebIcon } from '../lib/webIcon'
import { Button } from './Button'

type Props = {
  product: Product
}

export function ProductCard({ product }: Props) {
  const imageUrl = resolveImageUrl(product.image)

  return (
    <article className="group flex h-full flex-col rounded-2xl border border-navy/8 bg-white shadow-sm transition-all duration-300 hover:-translate-y-1.5 hover:shadow-xl hover:shadow-electric/15">
      <div
        className={`relative flex h-44 items-center justify-center overflow-hidden rounded-t-2xl bg-gradient-to-br ${product.imageGradient}`}
      >
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={product.name}
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <WebIcon
            name={product.emoji}
            alt=""
            light
            className="h-16 w-16 drop-shadow-md transition-transform duration-500 group-hover:scale-110"
          />
        )}
        <div className="absolute inset-0 filament-pattern opacity-60" />
        {product.available && (
          <div className="absolute left-3 top-3 select-none rounded-full border border-emerald-200/80 bg-white/90 px-2.5 py-1 text-xs font-semibold text-emerald-700 backdrop-blur-sm transition-colors duration-150 hover:border-emerald-600 hover:bg-emerald-600 hover:text-white">
            Available at stands
          </div>
        )}
        {!product.available && (
          <div className="absolute left-3 top-3 select-none rounded-full border border-red-200/80 bg-white/90 px-2.5 py-1 text-xs font-semibold text-red-500 backdrop-blur-sm transition-colors duration-150 hover:border-red-600 hover:bg-red-600 hover:text-white">
            Currently unavailable
          </div>
        )}
        <div className="absolute bottom-3 right-3 select-none rounded-full border border-navy/10 bg-white/90 px-2.5 py-1 text-xs font-semibold text-navy backdrop-blur-sm transition-colors duration-150 hover:border-cyan hover:bg-cyan hover:text-white">
          ${product.price}
        </div>
      </div>
      <div className="flex flex-1 flex-col p-5">
        <h3 className="text-lg font-bold text-navy">{product.name}</h3>
        <p className="mt-1.5 flex-1 text-sm leading-relaxed text-muted">{product.description}</p>
        <div className="mt-4">
          <Button variant="ghost" size="sm" href="#stands">
            Find It at a Stand
          </Button>
        </div>
      </div>
    </article>
  )
}
