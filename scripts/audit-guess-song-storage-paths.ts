import { loadEnvFile } from 'node:process'

type StorageRow = {
  id: string
  value: string | null
}

type StorageFinding = {
  completeUrlIds: string[]
  emptyStringIds: string[]
  abnormalPrefixIds: string[]
  illegalPathIds: string[]
}

const DEFAULT_AUDIO_PREFIX = 'guess-song'

function normalizePrefix(value: string | undefined) {
  return (value || DEFAULT_AUDIO_PREFIX).trim().replace(/^\/+|\/+$/g, '') || DEFAULT_AUDIO_PREFIX
}

function isCompleteUrl(value: string) {
  return /^https?:\/\//i.test(value)
}

function hasIllegalPathShape(value: string) {
  return value.includes('..')
    || value.includes('\\')
    || value.startsWith('/')
    || /[?#\u0000-\u001f\u007f]/.test(value)
}

function inspectRows(rows: StorageRow[], expectedPrefix: string): StorageFinding {
  const completeUrlIds: string[] = []
  const emptyStringIds: string[] = []
  const abnormalPrefixIds: string[] = []
  const illegalPathIds: string[] = []
  const expectedPathPrefix = `${expectedPrefix}/`

  for (const row of rows) {
    const value = row.value
    if (value === null || value.trim() === '') {
      if (value !== null) emptyStringIds.push(row.id)
      continue
    }

    const normalized = value.trim()
    if (isCompleteUrl(normalized)) completeUrlIds.push(row.id)
    if (!normalized.startsWith(expectedPathPrefix)) abnormalPrefixIds.push(row.id)
    if (hasIllegalPathShape(normalized)) illegalPathIds.push(row.id)
  }

  return { completeUrlIds, emptyStringIds, abnormalPrefixIds, illegalPathIds }
}

function summarize(rows: StorageRow[], expectedPrefix: string) {
  const finding = inspectRows(rows, expectedPrefix)
  return {
    total: rows.length,
    nullCount: rows.filter((row) => row.value === null).length,
    emptyStringCount: finding.emptyStringIds.length,
    completeUrlCount: finding.completeUrlIds.length,
    abnormalPrefixCount: finding.abnormalPrefixIds.length,
    illegalPathCount: finding.illegalPathIds.length,
    ids: finding,
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    try {
      loadEnvFile('.env')
    } catch {
      // Let Prisma produce the normal connection error below if no env file exists.
    }
  }

  const { prisma } = await import('../lib/prisma')
  const expectedPrefix = normalizePrefix(process.env.TENCENT_COS_AUDIO_PREFIX)

  try {
    const [musicSongs, questions, variants] = await Promise.all([
      prisma.musicSong.findMany({ select: { id: true, sourceAudioPath: true } }),
      prisma.guessSongQuestion.findMany({ select: { id: true, sourceAudioPath: true } }),
      prisma.guessSongAudioVariant.findMany({ select: { id: true, storagePath: true } }),
    ])

    console.info(JSON.stringify({
      mode: 'read-only',
      expectedAudioPrefix: expectedPrefix,
      collections: {
        MusicSong_sourceAudioPath: summarize(musicSongs.map((row) => ({ id: row.id, value: row.sourceAudioPath })), expectedPrefix),
        GuessSongQuestion_sourceAudioPath: summarize(questions.map((row) => ({ id: row.id, value: row.sourceAudioPath })), expectedPrefix),
        GuessSongAudioVariant_storagePath: summarize(variants.map((row) => ({ id: row.id, value: row.storagePath })), expectedPrefix),
      },
      note: '只输出统计与记录 ID；未输出对象路径内容，未修改数据库。',
    }, null, 2))
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(() => {
  console.error('[guess-song-storage-audit] 只读审计失败；未修改数据库。')
  process.exitCode = 1
})
