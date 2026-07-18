import Image from 'next/image'

type MusicCoverProps = { src?: string | null; alt: string; className?: string; sizes?: string }

export function MusicCover({ src, alt, className = '', sizes = '(max-width: 640px) 100vw, 400px' }: Readonly<MusicCoverProps>) {
  return <div className={`relative overflow-hidden bg-gradient-to-br from-sky-100 via-white to-brand-100 ${className}`}>
    {src ? <Image src={src} alt={alt} fill sizes={sizes} loading="lazy" className="object-cover" /> : <div className="grid h-full w-full place-items-center" aria-label={`${alt}暂无封面`}><span className="text-5xl text-brand-700/70" aria-hidden="true">♪</span></div>}
  </div>
}
