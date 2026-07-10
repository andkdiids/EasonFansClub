import Link from 'next/link'

export function AuthFormShell({
  title,
  subtitle,
  children,
  footer,
}: Readonly<{
  title: string
  subtitle: string
  children: React.ReactNode
  footer: React.ReactNode
}>) {
  return (
    <main className="grid min-h-[100dvh] items-start justify-items-center overflow-y-auto px-4 py-5 sm:place-items-center sm:px-5 sm:py-10">
      <section className="w-full max-w-md rounded-2xl border border-sky-100 bg-white/78 p-6 shadow-2xl shadow-sky-900/10 backdrop-blur sm:p-7">
        <Link href="/" className="mb-8 inline-block text-xl font-black text-brand-950">
          私家E院
        </Link>
        <h1 className="text-3xl font-black text-brand-950">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">{subtitle}</p>
        <div className="mt-8">{children}</div>
        <div className="mt-7 border-t border-sky-100 pt-5 text-sm text-slate-600">{footer}</div>
      </section>
    </main>
  )
}
