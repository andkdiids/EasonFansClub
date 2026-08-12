import Image from 'next/image'
import { publicImageVariantUrl, type ImageVariant } from '@/lib/image-variants'

type MusicCoverProps = { src?: string | null; alt: string; className?: string; sizes?: string; variant?: ImageVariant; priority?: boolean }

export function MusicCover({ src, alt, className = '', sizes = '(max-width: 640px) 100vw, 400px', variant = 'thumb-md', priority = false }: Readonly<MusicCoverProps>) {
  const imageSrc = publicImageVariantUrl(src, variant)
  return <div className={`relative overflow-hidden bg-gradient-to-br from-sky-100 via-white to-brand-100 ${className}`}>
    {imageSrc ? <Image src={imageSrc} alt={alt} fill sizes={sizes} priority={priority} loading={priority ? undefined : 'lazy'} className="object-cover" /> : <div className="grid h-full w-full place-items-center" aria-label={`${alt}暂无封面`}><span className="text-5xl text-brand-700/70" aria-hidden="true">♪</span></div>}
  </div>
}
