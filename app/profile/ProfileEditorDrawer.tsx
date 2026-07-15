'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { ProfileSettingsForm } from './ProfileSettingsForm'

type InitialProfile = {
  nickname: string
  avatarUrl: string
  backgroundUrl: string
  bio: string
  email: string
  phone: string
  emailVerifiedAt: string | null
  phoneVerifiedAt: string | null
  wallVisibility: 'PUBLIC' | 'FRIENDS' | 'CLOSED'
}

export function ProfileEditorDrawer({
  initialOpen = false,
  initialProfile,
  hideTrigger = false,
}: {
  initialOpen?: boolean
  initialProfile: InitialProfile
  hideTrigger?: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [isOpen, setIsOpen] = useState(initialOpen)

  useEffect(() => {
    setIsOpen(initialOpen)
  }, [initialOpen])

  function openEditor() {
    setIsOpen(true)
    router.replace(`${pathname}?edit=1`, { scroll: false })
  }

  function closeEditor() {
    setIsOpen(false)
    router.replace(pathname, { scroll: false })
  }

  function cancelEditor() {
    if (window.confirm('放弃未保存的资料修改吗？')) {
      closeEditor()
    }
  }

  return (
    <>
      {hideTrigger ? null : (
        <button type="button" onClick={openEditor} className="h-11 rounded-xl border border-white/25 bg-slate-950/30 px-4 text-center text-sm font-black text-white shadow-lg shadow-slate-950/20 backdrop-blur-xl transition hover:bg-slate-950/42">
          编辑资料
        </button>
      )}

      {isOpen ? (
        <div className="fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-sm">
          <aside className="ml-auto flex h-full w-full flex-col bg-white shadow-2xl md:max-w-2xl">
            <div className="flex items-center justify-between border-b border-sky-100 px-5 py-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-sky-700">Profile Editor</p>
                <h2 className="mt-1 text-xl font-black text-brand-950">编辑资料</h2>
              </div>
              <button type="button" onClick={cancelEditor} className="rounded-full bg-sky-50 px-4 py-2 text-sm font-black text-brand-700 hover:bg-sky-100">
                关闭
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto bg-sky-50/40 px-4 py-5 sm:px-6">
              <ProfileSettingsForm initialProfile={initialProfile} onCancel={cancelEditor} onSaved={closeEditor} />
            </div>
          </aside>
        </div>
      ) : null}
    </>
  )
}
