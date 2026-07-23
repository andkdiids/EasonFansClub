import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { BrandMark } from '@/components/BrandMark'
import { ThemeToggle } from '@/components/ThemeToggle'
import { getCurrentUser } from '@/lib/auth'
import { publicImageUrl } from '@/lib/images'
import { getSiteAppearance } from '@/lib/site-config'

export const dynamic = 'force-dynamic'

export default async function WelcomePage() {
  const [user, config] = await Promise.all([getCurrentUser(), getSiteAppearance()])
  if (!user) redirect('/login?redirect=%2Fwelcome')
  const hero = config.heroSlides.filter((slide) => slide.isVisible).sort((a, b) => a.sortOrder - b.sortOrder)[0]
  const heroUrl = publicImageUrl(hero?.imageUrl || config.images.checkinBackgroundUrl || config.images.loginBackgroundUrl)
  const logoUrl = publicImageUrl(config.images.navLogoUrl || config.images.logoUrl)

  return (
    <main className="welcome-page">
      {heroUrl ? <Image src={heroUrl} alt="EasonFansClub 欢迎主视觉" fill priority sizes="100vw" className="welcome-hero-image" /> : <div className="welcome-hero-fallback" />}
      <div className="welcome-overlay" />
      <header className="welcome-header">
        <BrandMark logoUrl={logoUrl} inverse />
        <ThemeToggle className="hero-icon-button" />
      </header>
      <section className="welcome-copy" aria-labelledby="welcome-title">
        <p className="hero-kicker">WELCOME TO</p>
        <h1>
  私家E院
</h1>
        <p className="hero-community">
  听见 <span>Eason</span>，也听见自己
</p>

<p className="hero-slogan">
  NOW IS THE ONLY REALITY.
</p>

<p className="hero-script">C’mon in~</p>
        <Link href="/community" className="hero-primary-button" aria-label="进入社区首页">进入社区 <span aria-hidden>›</span></Link>
      </section>
    </main>
  )
}
