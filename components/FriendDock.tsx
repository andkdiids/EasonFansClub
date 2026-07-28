'use client'

import { useEffect, useState } from 'react'
import { SafeAvatar } from '@/components/SafeAvatar'
import { publicImageUrl } from '@/lib/images'
import { formatUid } from '@/lib/uid'

type Friend = { id: string; uid: number; nickname: string; avatarUrl: string | null; level: number; isOnline: boolean; profile: { displayName: string | null; avatarUrl: string | null } | null }
type Message = { id: string; content: string; senderId: string; createdAt: string }

export function FriendDock({ currentUserId }: { currentUserId: string }) {
  const [open, setOpen] = useState(false)
  const [friends, setFriends] = useState<Friend[]>([])
  const [query, setQuery] = useState('')
  const [conversationId, setConversationId] = useState('')
  const [chatFriend, setChatFriend] = useState<Friend | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [content, setContent] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [unreadCount, setUnreadCount] = useState(0)

  useEffect(() => {
    setOpen(window.sessionStorage.getItem('friend-dock:open') === '1')
    fetch('/api/direct-conversations', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => setUnreadCount(Array.isArray(data?.conversations) ? data.conversations.reduce((sum: number, item: { unreadCount?: number }) => sum + (item.unreadCount || 0), 0) : 0))
      .catch(() => null)
  }, [])
  useEffect(() => {
    window.sessionStorage.setItem('friend-dock:open', open ? '1' : '0')
    if (!open) return
    const params = new URLSearchParams({ q: query, pageSize: '15' })
    const controller = new AbortController()
    fetch(`/api/friends/list?${params}`, { signal: controller.signal, cache: 'no-store' })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data) => setFriends(Array.isArray(data.friends) ? data.friends : []))
      .catch(() => null)
    return () => controller.abort()
  }, [open, query])

  async function openChat(friend: Friend) {
    setError('')
    const response = await fetch('/api/direct-conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetUid: friend.uid }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      setError(data.message || '无法打开会话')
      return
    }
    setChatFriend(friend)
    setUnreadCount(0)
    setConversationId(data.conversation.id)
    const messagesResponse = await fetch(`/api/direct-conversations/${data.conversation.id}/messages`, { cache: 'no-store' })
    const messagesData = await messagesResponse.json().catch(() => ({}))
    setMessages(Array.isArray(messagesData.messages) ? messagesData.messages : [])
  }

  async function send() {
    if (!conversationId || !content.trim() || sending) return
    setSending(true)
    setError('')
    const response = await fetch(`/api/direct-conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })
    const data = await response.json().catch(() => ({}))
    setSending(false)
    if (!response.ok) {
      setError(data.message || '发送失败')
      return
    }
    setMessages((current) => [...current, data.message])
    setContent('')
  }

  return (
    <div className="friend-dock">
      {open ? (
        <section className={`friend-dock-panel ${chatFriend ? 'is-chat' : 'is-list'}`} aria-label="好友与私信">
          <header className="flex min-h-12 items-center justify-between border-b border-sky-100 px-3">
            <strong>{chatFriend ? `与 ${chatFriend.profile?.displayName || chatFriend.nickname} 私信` : '好友'}</strong>
            <div className="flex gap-2">
              {chatFriend ? <button type="button" onClick={() => { setChatFriend(null); setConversationId('') }} aria-label="返回好友列表">返回</button> : null}
              <button type="button" onClick={() => setOpen(false)} aria-label="关闭好友窗口">关闭</button>
            </div>
          </header>
          {chatFriend ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex-1 space-y-2 overflow-y-auto p-3">
                {messages.map((message) => <p key={message.id} className={`max-w-[85%] border border-sky-100 px-3 py-2 text-sm ${message.senderId === currentUserId ? 'ml-auto bg-brand-50' : 'bg-white'}`}>{message.content}</p>)}
                {!messages.length ? <p className="text-center text-sm font-bold text-slate-500">还没有消息，打个招呼吧。</p> : null}
              </div>
              <div className="border-t border-sky-100 p-3">
                <textarea value={content} onChange={(event) => setContent(event.target.value.slice(0, 1000))} className="min-h-16 w-full resize-none border border-sky-100 p-2 text-sm outline-none" />
                <button type="button" disabled={sending || !content.trim()} onClick={() => void send()} className="mt-2 min-h-10 w-full bg-brand-950 text-sm font-black text-white disabled:opacity-50">{sending ? '发送中…' : '发送'}</button>
              </div>
            </div>
          ) : (
            <>
              <div className="p-3"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索好友" className="h-10 w-full border border-sky-100 px-3 text-sm outline-none" /></div>
              <div className="friend-dock-list min-h-0 px-3 pb-3">
                {friends.map((friend) => {
                  const name = friend.profile?.displayName || friend.nickname
                  const avatar = publicImageUrl(friend.profile?.avatarUrl || friend.avatarUrl)
                  return <button key={friend.id} type="button" onClick={() => void openChat(friend)} className="flex min-h-14 w-full items-center gap-3 border-b border-sky-100 text-left">
                    <span className="grid h-9 w-9 place-items-center overflow-hidden bg-sky-50"><SafeAvatar src={avatar} name={name} className="h-full w-full" /></span>
                    <span className="min-w-0"><strong className="block truncate text-sm">{name}</strong><small className="block truncate text-slate-500">UID {formatUid(friend.uid)} · Lv.{friend.level}</small></span>
                  </button>
                })}
                {!friends.length ? <p className="p-4 text-center text-sm font-bold text-slate-500">暂无好友</p> : null}
              </div>
            </>
          )}
          {error ? <p className="border-t border-red-100 bg-red-50 p-2 text-xs font-black text-red-600">{error}</p> : null}
        </section>
      ) : null}
      <button type="button" className="friend-dock-toggle" onClick={() => setOpen((value) => !value)} aria-label={open ? '收起好友窗口' : '打开好友窗口'}>好友{unreadCount ? ` ${unreadCount}` : ''}</button>
    </div>
  )
}
