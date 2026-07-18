type MusicCoverProps = {
  src?: string | null
  alt: string
  className?: string
}

export function MusicCover({ src, alt, className = '' }: Readonly<MusicCoverProps>) {
  return (
    <div className={`relative overflow-hidden bg-gradient-to-br from-sky-100 via-white to-brand-100 ${className}`}>
      {src ? <img src={src} alt={alt} className="h-full w-full object-cover" /> : (
        <div className="grid h-full w-full place-items-center" aria-label={`${alt}暂无封面`}>
          <span className="text-5xl text-brand-700/70" aria-hidden="true">♪</span>
        </div>
      )}
    </div>
  )
}
