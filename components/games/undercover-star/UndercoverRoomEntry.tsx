import type { UndercoverRoomState } from '@/lib/undercover-star-protocol'
import { UndercoverAvatar } from './UndercoverAvatar'

export function UndercoverRoomEntry({ room, onJoin }: { room: UndercoverRoomState; onJoin: (room: UndercoverRoomState) => void }) {
  const host = room.players[0]
  return (
    <button type="button" onClick={() => onJoin(room)} className="flex items-center gap-3 border border-sky-100 bg-white p-4 text-left shadow-sm transition hover:border-brand-400">
      <UndercoverAvatar user={host || { name: '房主', avatarUrl: null }} small />
      <span className="min-w-0 flex-1">
        <strong className="block truncate text-sm font-black text-brand-950">{host?.name || '房主'} 的房间</strong>
        <small className="mt-1 block text-xs font-bold text-slate-500">{room.currentCount} / {room.maxPlayers} 人 · 房间 {room.roomCode}{room.hasPassword ? ' · 私密' : ''}</small>
      </span>
      <span className="text-xs font-black text-brand-700">加入</span>
    </button>
  )
}
