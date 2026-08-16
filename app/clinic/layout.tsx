import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '阿士匹灵门诊部 | 私家E院',
  robots: { index: false, follow: false },
}

export default function ClinicLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children
}
