import { requireAdminPage } from '@/components/AdminAccess'
import { prisma } from '@/lib/prisma'
import { BannedWordManager, type BannedWordRow } from './BannedWordManager'

export const dynamic = 'force-dynamic'

export default async function AdminBannedWordsPage() {
  await requireAdminPage('/admin/banned-words', 'banned_word_manage')
  const rows = await prisma.bannedWord.findMany({
    orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      word: true,
      normalizedWord: true,
      enabled: true,
      priority: true,
      note: true,
      createdAt: true,
      updatedAt: true,
      createdBy: { select: { id: true, uid: true, nickname: true } },
    },
  })
  const initialWords: BannedWordRow[] = rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }))

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-7 sm:px-5 sm:py-9">
      <section className="rounded-[28px] border border-sky-100 bg-white/90 p-6 shadow-sm sm:p-8">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-brand-700">Content Safety</p>
        <h1 className="mt-2 text-3xl font-black text-brand-950 sm:text-4xl">违禁词管理</h1>
        <p className="mt-3 max-w-3xl text-sm font-bold leading-7 text-slate-600">
          统一管理服务端内容检测规则。新增、启用或停用词后会触发历史内容扫描；已标记为违规的内容不会因为词库变化自动恢复。
        </p>
      </section>
      <BannedWordManager initialWords={initialWords} />
    </main>
  )
}
