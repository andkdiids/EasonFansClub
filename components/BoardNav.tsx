import Link from 'next/link'

type Board = {
  id: string
  name: string
  slug: string
  description: string | null
  postCount: number
}

export function BoardNav({ boards, activeSlug }: Readonly<{ boards: Board[]; activeSlug?: string }>) {
  return (
    <aside className="rounded-xl border border-sky-100 bg-white/78 p-4 shadow-sm">
      <h2 className="mb-4 text-lg font-black text-brand-950">板块</h2>
      <div className="grid gap-2">
        {boards.map((board) => (
          <Link
            key={board.id}
            href={`/boards/${board.slug}`}
            className={`rounded-lg px-4 py-2 transition ${
              activeSlug === board.slug ? 'bg-brand-700 text-white' : 'bg-sky-50/70 text-slate-700 hover:bg-sky-100'
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="font-black">{board.name}</span>
              <span className="text-xs opacity-75">{board.postCount}</span>
            </div>
            {board.description ? <p className="mt-1 text-xs opacity-75">{board.description}</p> : null}
          </Link>
        ))}
      </div>
    </aside>
  )
}
