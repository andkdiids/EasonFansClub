import Link from 'next/link'

const sections = [
  { href: '/music/albums', label: '专辑', eyebrow: 'ALBUMS' },
  { href: '/music/concerts', label: '演唱会现场', eyebrow: 'CONCERTS' },
  { href: '/music/reviews', label: '专辑鉴赏', eyebrow: 'ALBUM REVIEW' },
] as const

export function MusicSectionNavigation() {
  return <nav aria-label="EasMusic 分类导航" className="grid gap-2 sm:grid-cols-3">
    {sections.map((item) => <Link key={item.href} href={item.href} className="group rounded-[20px] border border-white/10 bg-white/[0.055] px-5 py-4 backdrop-blur-xl transition hover:-translate-y-0.5 hover:border-sky-300/30 hover:bg-white/[0.1]">
      <span className="block text-[10px] font-black tracking-[0.2em] text-sky-300/55">{item.eyebrow}</span>
      <strong className="mt-1 block text-sm font-black text-white">{item.label} <span className="text-sky-300/60 transition group-hover:translate-x-1">→</span></strong>
    </Link>)}
  </nav>
}
