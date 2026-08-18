import type { UndercoverRoomState } from '@/lib/undercover-star-protocol'
import { UndercoverRoomEntry } from './UndercoverRoomEntry'

export function UndercoverPublicRooms({ rooms, onJoinRoom, onRefresh, loading }: { rooms: UndercoverRoomState[]; onJoinRoom: (room: UndercoverRoomState) => void; onRefresh: () => void; loading?: boolean }) {
  return (
    <section className="border border-sky-100 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-black text-brand-950">公开房间</h2>
        <button type="button" onClick={onRefresh} disabled={loading} className="inline-flex items-center gap-1 border border-sky-200 px-3 py-2 text-xs font-black text-brand-700 disabled:opacity-50">
          <span aria-hidden="true">↻</span> 刷新
        </button>
      </div>
      <p className="mt-2 text-xs font-bold text-slate-500">仅显示等待中的公开房</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {rooms.map((item) => <UndercoverRoomEntry key={item.roomId} room={item} onJoin={onJoinRoom} />)}
        {!rooms.length ? <p className="border border-dashed border-sky-200 p-6 text-sm font-bold text-slate-500 sm:col-span-2">暂时没有公开等候房，创建一间吧。</p> : null}
      </div>
    </section>
  )
}
