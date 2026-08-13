import { requireAdminPage } from '@/components/AdminAccess'

import { getDefaultAvatarPool } from '@/lib/default-avatars'
import { publicImageUrl } from '@/lib/images'
import { DefaultAvatarManager } from './DefaultAvatarManager'

export const dynamic = 'force-dynamic'

export default async function DefaultAvatarsAdminPage() {
  const user = await requireAdminPage('/admin/default-avatars', 'site_config_manage')
  const avatars = (await getDefaultAvatarPool()).map((avatar) => ({
    ...avatar,
    url: publicImageUrl(avatar.url) || avatar.url,
  }))
  return (
    <>
      
      <main className="mx-auto max-w-5xl px-5 py-8">
        <DefaultAvatarManager initialAvatars={avatars} />
      </main>
    </>
  )
}
