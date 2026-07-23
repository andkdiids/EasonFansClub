import Link from 'next/link'
import { publicImageUrl } from '@/lib/images'
import { BrandMark } from '@/components/BrandMark'
import { ThemeToggle } from '@/components/ThemeToggle'
import { HeroBackground } from '@/components/HeroBackground'
import type { SiteHeroVisualConfig } from '@/lib/hero-visuals'

export function AuthFormShell({
  title,
  subtitle,
  siteName = '私家E院',
  backgroundUrl,
  heroVisual,
  logoUrl,
  children,
  footer,
}: Readonly<{
  title: string
  subtitle: string
  siteName?: string
  backgroundUrl?: string | null
  heroVisual?: SiteHeroVisualConfig | null
  logoUrl?: string | null
  children: React.ReactNode
  footer: React.ReactNode
}>) {
  return (
    <main className="auth-page">
      <HeroBackground visual={heroVisual} fallbackImageUrl={backgroundUrl} priority />
      <div className="auth-page-overlay" />
      <header className="auth-page-header"><Link href="/" aria-label={siteName}><BrandMark logoUrl={publicImageUrl(logoUrl)} inverse compact /></Link><ThemeToggle className="hero-icon-button" /></header>
      <div className="auth-page-layout">
        <section className="auth-brand-copy" aria-label="网站介绍"><p>WELCOME TO</p>

<h2>私家E院</h2>

<span>
  听见 Eason，也听见自己
</span>

<em>
  NOW IS THE ONLY REALITY.
</em></section>
        <section className="auth-form-panel">
          <div className="auth-form-heading"><p>MEMBER ACCESS</p><h1>{title}</h1><span>{subtitle}</span></div>
          <div className="auth-form-content">{children}</div>
          <div className="auth-form-footer">{footer}</div>
        </section>
      </div>
    </main>
  )
}
