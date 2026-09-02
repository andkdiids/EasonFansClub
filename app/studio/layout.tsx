import type { ReactNode } from 'react'
import { getSessionUserFromCookie } from '@/lib/auth'
import { StudioNav } from '@/components/studio/StudioNav'
import styles from '@/components/studio/studio.module.css'

export const dynamic = 'force-dynamic'

export default async function StudioLayout({ children }: Readonly<{ children: ReactNode }>) {
  const sessionUser = await getSessionUserFromCookie()
  return <div className={styles.root}><StudioNav isAuthenticated={Boolean(sessionUser)} />{children}</div>
}
