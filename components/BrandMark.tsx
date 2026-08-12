import Image from 'next/image'
import { publicImageVariantUrl } from '@/lib/image-variants'

export function BrandMark({ logoUrl, inverse = false, compact = false }: { logoUrl?: string | null; inverse?: boolean; compact?: boolean }) {
  const renderLogoUrl = publicImageVariantUrl(logoUrl, 'thumb-sm')
  return (
    <span className={`ecfc-brand ${inverse ? 'ecfc-brand-inverse' : ''} ${compact ? 'ecfc-brand-compact' : ''}`}>
      <span className="ecfc-brand-icon" aria-hidden={logoUrl ? undefined : true}>
        {renderLogoUrl ? <Image src={renderLogoUrl} alt="私家E院标志" fill sizes="40px" loading="eager" className="object-contain" /> : <span>Ｅ</span>}
      </span>
      <span className="ecfc-brand-copy">
        <strong>私家E院</strong>
        <small>EasonFansClub</small>
      </span>
    </span>
  )
}
