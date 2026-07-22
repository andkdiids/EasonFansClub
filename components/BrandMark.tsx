import Image from 'next/image'

export function BrandMark({ logoUrl, inverse = false, compact = false }: { logoUrl?: string | null; inverse?: boolean; compact?: boolean }) {
  return (
    <span className={`ecfc-brand ${inverse ? 'ecfc-brand-inverse' : ''} ${compact ? 'ecfc-brand-compact' : ''}`}>
      <span className="ecfc-brand-icon" aria-hidden={logoUrl ? undefined : true}>
        {logoUrl ? <Image src={logoUrl} alt="私家E院标志" fill sizes="40px" className="object-contain" /> : <span>Ｅ</span>}
      </span>
      <span className="ecfc-brand-copy">
        <strong>私家E院</strong>
        <small>EasonFansClub</small>
      </span>
    </span>
  )
}
