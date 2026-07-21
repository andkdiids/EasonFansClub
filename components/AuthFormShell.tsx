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
      className="grid min-h-screen place-items-center bg-cover bg-center px-5 py-10 sm:px-5 sm:py-6"
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
      <section className="w-full max-w-xs rounded-3xl border border-white/40 bg-white/20 p-5 shadow-2xl backdrop-blur-2xl sm:max-w-md sm:rounded-2xl sm:p-7">
        <Link
          href="/"
          className="mb-4 inline-block text-base font-black text-white drop-shadow-md sm:text-lg"
        >
          {siteName}
        </Link>

        <h1 className="text-xl font-black text-white drop-shadow-lg sm:text-3xl">
          {title}
        </h1>

        <p className="mt-2 text-sm leading-5 text-white/90 drop-shadow">
          {subtitle}
        </p>

        <div className="mt-5">
          {children}
        </div>

        <div className="mt-5 border-t border-white/20 pt-4 text-sm text-white/80">
          {footer}
        </div>
      </section>
    </main>
  )
}