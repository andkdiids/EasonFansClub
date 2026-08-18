'use client'

import { useState } from 'react'
import type { UndercoverDifficulty } from '@prisma/client'

type EntryTab = 'create' | 'join'

export function UndercoverEntryPanel({ roomCode, password, createPassword, createDifficulty, busy, onRoomCode, onPassword, onCreatePassword, onDifficulty, onCreate, onJoin }: {
  roomCode: string
  password: string
  createPassword: string
  createDifficulty: UndercoverDifficulty
  busy: boolean
  onRoomCode: (value: string) => void
  onPassword: (value: string) => void
  onCreatePassword: (value: string) => void
  onDifficulty: (value: UndercoverDifficulty) => void
  onCreate: () => void
  onJoin: (event: React.FormEvent) => void
}) {
  const [tab, setTab] = useState<EntryTab>('create')
  return (
    <section className="border border-sky-100 bg-white p-5 shadow-sm sm:p-7">
      <h2 className="text-2xl font-black text-brand-950">进入游戏</h2>
      <p className="mt-2 text-sm font-bold leading-7 text-slate-500">平民拿到相同词语，卧底拿到相近但不同的词语。描述不能直接说词，所有身份、词语与胜负都由服务端保护和判定。</p>
      <div className="mt-5 flex gap-2" role="tablist" aria-label="进入游戏方式">
        <button type="button" role="tab" aria-selected={tab === 'create'} onClick={() => setTab('create')} className={`flex-1 border px-4 py-2 text-sm font-black ${tab === 'create' ? 'border-brand-950 bg-brand-950 text-white' : 'border-sky-100 text-brand-700'}`}>创建房间</button>
        <button type="button" role="tab" aria-selected={tab === 'join'} onClick={() => setTab('join')} className={`flex-1 border px-4 py-2 text-sm font-black ${tab === 'join' ? 'border-brand-950 bg-brand-950 text-white' : 'border-sky-100 text-brand-700'}`}>加入房间</button>
      </div>
      {tab === 'create' ? (
        <div className="mt-5 space-y-4">
          <label className="block text-xs font-black text-slate-500">游戏难度
            <select value={createDifficulty} onChange={(event) => onDifficulty(event.target.value as UndercoverDifficulty)} className="mt-2 block w-full border border-sky-100 px-3 py-3 text-sm font-bold">
              <option value="EASY">简单</option>
              <option value="NORMAL">普通</option>
              <option value="HARD">困难</option>
            </select>
          </label>
          <label className="block text-xs font-black text-slate-500">房间密码（留空为公开房）
            <input value={createPassword} onChange={(event) => onCreatePassword(event.target.value)} maxLength={32} className="mt-2 block w-full border border-sky-100 px-3 py-3 text-sm font-bold outline-none focus:border-brand-400" placeholder="留空为公开房" />
          </label>
          <button type="button" onClick={onCreate} disabled={busy} className="w-full bg-brand-950 px-5 py-3 text-sm font-black text-white disabled:opacity-50">创建房间</button>
        </div>
      ) : (
        <form onSubmit={onJoin} className="mt-5 space-y-3">
          <input required value={roomCode} onChange={(event) => onRoomCode(event.target.value)} inputMode="numeric" maxLength={6} className="block w-full border border-sky-100 px-3 py-3 text-sm font-bold" placeholder="6 位房间号" />
          <input value={password} onChange={(event) => onPassword(event.target.value)} type="password" maxLength={32} className="block w-full border border-sky-100 px-3 py-3 text-sm font-bold" placeholder="密码房请输入密码" />
          <button disabled={busy} className="w-full bg-sky-700 px-5 py-3 text-sm font-black text-white disabled:opacity-50">加入房间</button>
        </form>
      )}
    </section>
  )
}
