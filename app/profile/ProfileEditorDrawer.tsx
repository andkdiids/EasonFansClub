'use client'

import { createPortal } from 'react-dom'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ProfileSettingsForm } from './ProfileSettingsForm'
import type { UserLocation } from '@/lib/user-location'
import type { GenderValue } from '@/lib/gender'
import type { NicknameChangeView } from '@/lib/nickname-change'

type InitialProfile = {
  nickname: string
  nicknameChange: NicknameChangeView
  nicknameViolation: boolean
  avatarUrl: string
  defaultAvatarOptions: Array<{ id: string; url: string }>
  backgroundUrl: string
  bio: string
  gender: GenderValue | null
  customGender: string
  bioViolation: boolean
  location: UserLocation | null
  email: string
  phone: string
  emailVerifiedAt: string | null
  phoneVerifiedAt: string | null
  wallVisibility: 'PUBLIC' | 'FRIENDS' | 'CLOSED'
  birthMonth: number | null
  birthDay: number | null
  birthdaySetAt: string | null
  birthdateSelfEditCount: number
  canEditBirthdate: boolean
  birthdayPublic: boolean
  showBadgeActivity: boolean
  showBadgeProgressNotifications: boolean
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
  const [isOpen, setIsOpen] = useState(initialOpen)
  const [mounted, setMounted] = useState(false)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const editQueryConsumedRef = useRef(false)

  const replaceEditQuery = useCallback((open: boolean) => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    if (open) url.searchParams.set('edit', '1')
    else url.searchParams.delete('edit')
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }, [])

  const closeEditor = useCallback(() => {
    setIsOpen(false)
    replaceEditQuery(false)
  }, [replaceEditQuery])

  const cancelEditor = useCallback(() => {
    if (window.confirm('放弃未保存的资料修改吗？')) closeEditor()
  }, [closeEditor])

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (!initialOpen) {
      editQueryConsumedRef.current = false
      return
    }
    if (editQueryConsumedRef.current) return

    // `?edit=1` is an entry command, not the source of truth for the drawer.
    // Consume it once so a route refresh/query cleanup cannot reset an already
    // open editor back to false.
    editQueryConsumedRef.current = true
    setIsOpen(true)
    replaceEditQuery(false)
  }, [initialOpen, replaceEditQuery])

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
    replaceEditQuery(true)
  }

  const drawer = mounted && isOpen
    ? createPortal(
      <div className="profile-editor-overlay fixed inset-0 z-[var(--layer-dialog)] overflow-hidden bg-slate-950/65">
        <aside
          role="dialog"
          aria-modal="true"
          aria-labelledby="profile-editor-title"
          className="profile-editor-drawer ml-auto flex h-full min-h-0 w-full flex-col overflow-hidden md:max-w-2xl"
        >
          <div className="profile-editor-header flex shrink-0 items-center justify-between border-b px-5 py-4">
            <div className="min-w-0">
              <p className="profile-editor-eyebrow text-xs font-black tracking-[0.18em] text-sky-700">个人资料编辑器</p>
              <h2 id="profile-editor-title" className="mt-1 text-xl font-black text-brand-950">编辑资料</h2>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={cancelEditor}
              className="relative z-10 min-h-11 shrink-0 rounded-sm border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-black text-[var(--primary)] hover:bg-[var(--surface-subtle)]"
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
        <button type="button" onClick={openEditor} className="h-11 rounded-sm border border-white/25 bg-slate-950/30 px-4 text-center text-sm font-black text-white transition hover:bg-slate-950/42">
          编辑资料
        </button>
      )}
      {drawer}
    </>
  )
}
