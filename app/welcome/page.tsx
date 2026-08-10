import Link from 'next/link'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { BrandMark } from '@/components/BrandMark'
import { HeroBackground } from '@/components/HeroBackground'
import { ThemeToggle } from '@/components/ThemeToggle'
import { getCurrentUser } from '@/lib/auth'
import { publicImageUrl } from '@/lib/images'
import { getSiteAppearance } from '@/lib/site-config'

export const dynamic = 'force-dynamic'

function isPhoneRequest(userAgent: string, clientHint: string | null) {
  return clientHint === '?1' || /Android.*Mobile|iPhone|iPod|Windows Phone/i.test(userAgent)
}

export default async function WelcomePage() {
  const [user, config, requestHeaders] = await Promise.all([getCurrentUser(), getSiteAppearance(), headers()])
  if (!user) redirect('/login?redirect=%2Fwelcome')

  const visual = config.heroVisuals.welcome
  const fallbackImageUrl = config.images.checkinBackgroundUrl || config.images.loginBackgroundUrl
  const hasBackground = Boolean(
    visual.enabled && (visual.mediaUrl || visual.imageUrl || visual.posterUrl || fallbackImageUrl),
  )
  const logoUrl = publicImageUrl(config.images.navLogoUrl || config.images.logoUrl)
  const positionMode = isPhoneRequest(requestHeaders.get('user-agent') || '', requestHeaders.get('sec-ch-ua-mobile')) ? 'mobile' : 'desktop'

  return (
    <main className="welcome-page">
      <HeroBackground visual={visual} fallbackImageUrl={fallbackImageUrl} priority positionMode={positionMode} />
      {!hasBackground ? <div className="welcome-hero-fallback" /> : null}
      <div className="welcome-overlay" />
      <header className="welcome-header">
        <BrandMark logoUrl={logoUrl} inverse />
        <ThemeToggle className="hero-icon-button" />
      </header>
      <section className="welcome-copy" aria-labelledby="welcome-title">
        <p className="hero-kicker">WELCOME TO</p>
        <h1 id="welcome-title">私家E院</h1>
        <p className="hero-community">听见 <span>Eason</span>，也听见自己</p>
        <p className="hero-slogan">NOW IS THE ONLY REALITY.</p>
        <p className="hero-script">C’mon in~</p>
        <Link href="/community" className="hero-primary-button" aria-label="进入社区首页">进入社区 <span aria-hidden>›</span></Link>
      </section>
    </main>
  )
}
