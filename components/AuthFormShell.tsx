import Link from 'next/link'
import { publicImageUrl } from '@/lib/images'

export function AuthFormShell({
  title,
  subtitle,
  siteName = '私家E院',
  backgroundUrl,
  children,
  footer,
}: Readonly<{
  title: string
  subtitle: string
  siteName?: string
  backgroundUrl?: string | null
  children: React.ReactNode
  footer: React.ReactNode
}>) {
  const background = publicImageUrl(backgroundUrl)

  return (
    <main
      className="grid min-h-screen place-items-center bg-cover bg-center px-4 py-6 sm:px-5"
      style={
  background
    ? {
        backgroundImage: `url(${background})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }
    : undefined
}
    >
      <section className="w-full max-w-md rounded-2xl border border-white/40 bg-white/20 p-4 shadow-2xl backdrop-blur-2xl sm:p-7">
        <Link
  href="/"
  className="mb-8 inline-block text-xl font-black text-white drop-shadow-md"
>
  {siteName}
</Link>
        <h1 className="text-3xl font-black text-white drop-shadow-lg">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-white/90 drop-shadow">{subtitle}</p>
        <div className="mt-8">{children}</div>
        <div className="mt-7 border-t border-white/20 pt-5 text-sm text-white/80">
          {footer}
        </div>
      </section>
    </main>
  )
}
