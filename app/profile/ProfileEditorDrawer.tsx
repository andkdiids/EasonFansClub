'use client'

import { createPortal } from 'react-dom'
import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { ProfileSettingsForm } from './ProfileSettingsForm'

type InitialProfile = {
  username: string
  usernameChange: {
    lastChangedAt: string | null
    nextAllowedAt: string | null
    canChange: boolean
  }
  nickname: string
  avatarUrl: string
  defaultAvatarOptions: Array<{ id: string; url: string }>
  backgroundUrl: string
  bio: string
  email: string
  phone: string
  emailVerifiedAt: string | null
  phoneVerifiedAt: string | null
  wallVisibility: 'PUBLIC' | 'FRIENDS' | 'CLOSED'
  birthMonth: number | null
  birthDay: number | null
  birthdaySetAt: string | null
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
  const [mounted, setMounted] = useState(false)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  const closeEditor = useCallback(() => {
    setIsOpen(false)
    router.replace(pathname, { scroll: false })
  }, [pathname, router])

  const cancelEditor = useCallback(() => {
    if (window.confirm('放弃未保存的资料修改吗？')) closeEditor()
  }, [closeEditor])

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    setIsOpen(initialOpen)
  }, [initialOpen])

  useEffect(() => {
    if (!isOpen) return
    const root = document.documentElement
    const body = document.body
    const scrollY = window.scrollY
    const rootOverflow = root.style.overflow
    const bodyOverflow = body.style.overflow
    const bodyPosition = body.style.position
    const bodyTop = body.style.top
    const bodyWidth = body.style.width

    root.dataset.profileEditorOpen = 'true'
    root.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.width = '100%'
    window.requestAnimationFrame(() => closeButtonRef.current?.focus())

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancelEditor()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      delete root.dataset.profileEditorOpen
      root.style.overflow = rootOverflow
      body.style.overflow = bodyOverflow
      body.style.position = bodyPosition
      body.style.top = bodyTop
      body.style.width = bodyWidth
      window.scrollTo({ top: scrollY, left: 0, behavior: 'auto' })
    }
  }, [cancelEditor, isOpen])

  function openEditor() {
    setIsOpen(true)
    router.replace(`${pathname}?edit=1`, { scroll: false })
  }

  const drawer = mounted && isOpen
    ? createPortal(
      <div className="profile-editor-overlay fixed inset-0 z-[var(--layer-dialog)] overflow-hidden bg-slate-950/65 backdrop-blur-sm">
        <aside
          role="dialog"
          aria-modal="true"
          aria-labelledby="profile-editor-title"
          className="profile-editor-drawer ml-auto flex h-full min-h-0 w-full flex-col overflow-hidden shadow-2xl md:max-w-2xl"
        >
          <div className="profile-editor-header flex shrink-0 items-center justify-between border-b px-5 py-4">
            <div className="min-w-0">
              <p className="text-xs font-black tracking-[0.18em] text-sky-700">个人资料编辑器</p>
              <h2 id="profile-editor-title" className="mt-1 text-xl font-black text-brand-950">编辑资料</h2>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={cancelEditor}
              className="relative z-10 min-h-11 shrink-0 rounded-full bg-sky-50 px-4 py-2 text-sm font-black text-brand-700 hover:bg-sky-100"
            >
              关闭
            </button>
          </div>
          <div className="profile-editor-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-4 py-5 sm:px-6">
            <ProfileSettingsForm initialProfile={initialProfile} onCancel={cancelEditor} onSaved={closeEditor} />
          </div>
        </aside>
      </div>,
      document.body,
    )
    : null

  return (
    <>
      {hideTrigger ? null : (
        <button type="button" onClick={openEditor} className="h-11 rounded-xl border border-white/25 bg-slate-950/30 px-4 text-center text-sm font-black text-white shadow-lg shadow-slate-950/20 backdrop-blur-xl transition hover:bg-slate-950/42">
          编辑资料
        </button>
      )}
      {drawer}
    </>
  )
}
