import { findMatchedBannedWords, getEnabledBannedWords, type ModerationWord } from '@/lib/content-moderation'
import { generateUniqueViolationNickname } from '@/lib/nickname-violation'
import { prisma } from '@/lib/prisma'

const BATCH_SIZE = 200

export type ModerationScanSummary = {
  username: number
  bio: number
  posts: number
  comments: number
  checkinMessages: number
  wallMessages: number
  other: number
  scannedAt: string
}

function emptySummary(): ModerationScanSummary {
  return {
    username: 0,
    bio: 0,
    posts: 0,
    comments: 0,
    checkinMessages: 0,
    wallMessages: 0,
    other: 0,
    scannedAt: new Date().toISOString(),
  }
}

function matched(text: string | null | undefined, words: ModerationWord[]) {
  return findMatchedBannedWords(text, words)
}

function storedWords(rows: ModerationWord[]) {
  return rows.length ? JSON.stringify(rows.map((row) => row.word)) : null
}

function violationData(rows: ModerationWord[]) {
  return {
    moderationStatus: 'VIOLATION' as const,
    moderationReason: 'BANNED_WORD',
    matchedBannedWords: storedWords(rows),
  }
}

async function scanUsers(words: ModerationWord[], summary: ModerationScanSummary) {
  for (let skip = 0; ; skip += BATCH_SIZE) {
    const users = await prisma.user.findMany({
      orderBy: { id: 'asc' },
      skip,
      take: BATCH_SIZE,
      select: {
        id: true,
        username: true,
        nickname: true,
        bio: true,
        nicknameModerationStatus: true,
        nicknameViolationDisplay: true,
        nicknameViolationCount: true,
        Profile: { select: { id: true, displayName: true, bio: true } },
      },
    })
    if (!users.length) break

    for (const user of users) {
      const usernameMatches = matched(user.username, words)
      const nicknameMatches = matched(user.nickname, words)
      const bioMatches = matched(user.bio, words)
      const profileDisplayMatches = matched(user.Profile?.displayName, words)
      const profileBioMatches = matched(user.Profile?.bio, words)
      const allMatches = [...usernameMatches, ...nicknameMatches, ...bioMatches, ...profileDisplayMatches, ...profileBioMatches]
      const uniqueMatches = [...new Map(allMatches.map((row) => [row.normalizedWord, row])).values()]

      const alreadyNicknameViolation = user.nicknameModerationStatus === 'VIOLATION'
      const nicknameNewlyViolated = nicknameMatches.length > 0 && !alreadyNicknameViolation

      if (usernameMatches.length || nicknameMatches.length || bioMatches.length) {
        const data: Record<string, unknown> = {
          ...(usernameMatches.length ? { usernameModerationStatus: 'VIOLATION' as const } : {}),
          ...(nicknameMatches.length ? { nicknameModerationStatus: 'VIOLATION' as const } : {}),
          ...(bioMatches.length ? { bioModerationStatus: 'VIOLATION' as const } : {}),
          ...(uniqueMatches.length ? {
            moderationReason: 'BANNED_WORD',
            matchedBannedWords: storedWords(uniqueMatches),
          } : {}),
        }

        // 昵称违规：仅对「新」违规生成唯一展示昵称 + 违规计数 + 记录；
        // 已处于违规状态的用户保留原有展示昵称，避免重复计数（需求 四）。
        if (nicknameNewlyViolated) {
          const count = (user.nicknameViolationCount || 0) + 1
          const display = await generateUniqueViolationNickname(prisma, Math.random)
          data.nicknameViolationDisplay = display
          data.nicknameViolationCount = count
        }

        await prisma.user.update({ where: { id: user.id }, data })

        if (nicknameNewlyViolated) {
          await prisma.nicknameViolationLog.create({
            data: {
              userId: user.id,
              originalNickname: user.nickname,
              reason: 'BANNED_WORD',
              generatedDisplayName: data.nicknameViolationDisplay as string,
              violationCount: data.nicknameViolationCount as number,
            },
          })
        }

        if (usernameMatches.length || nicknameMatches.length) summary.username += 1
        if (bioMatches.length) summary.bio += 1
      }

      if (user.Profile && (profileDisplayMatches.length || profileBioMatches.length)) {
        await prisma.profile.update({
          where: { id: user.Profile.id },
          data: {
            ...(profileDisplayMatches.length ? { displayNameModerationStatus: 'VIOLATION' as const } : {}),
            ...(profileBioMatches.length ? { bioModerationStatus: 'VIOLATION' as const } : {}),
            moderationReason: 'BANNED_WORD',
            matchedBannedWords: storedWords(uniqueMatches),
          },
        })
        if (profileBioMatches.length && !bioMatches.length) summary.bio += 1
        if (profileDisplayMatches.length && !nicknameMatches.length) summary.username += 1
      }
    }
  }
}

async function scanPosts(words: ModerationWord[], summary: ModerationScanSummary) {
  for (let skip = 0; ; skip += BATCH_SIZE) {
    const posts = await prisma.post.findMany({
      orderBy: { id: 'asc' },
      skip,
      take: BATCH_SIZE,
      select: { id: true, title: true, content: true, User: { select: { role: true } } },
    })
    if (!posts.length) break
    for (const post of posts) {
      if (post.User.role === 'ADMIN' || post.User.role === 'SUPER_ADMIN') continue
      const rows = matched(`${post.title}\n${post.content}`, words)
      if (!rows.length) continue
      await prisma.post.update({ where: { id: post.id }, data: violationData(rows), select: { id: true } })
      summary.posts += 1
    }
  }
}

async function scanCheckinMessages(words: ModerationWord[], summary: ModerationScanSummary) {
  for (let skip = 0; ; skip += BATCH_SIZE) {
    const messages = await prisma.dailyMessage.findMany({ orderBy: { id: 'asc' }, skip, take: BATCH_SIZE, select: { id: true, content: true } })
    if (!messages.length) break
    for (const message of messages) {
      const rows = matched(message.content, words)
      if (!rows.length) continue
      await prisma.dailyMessage.update({ where: { id: message.id }, data: violationData(rows) })
      summary.checkinMessages += 1
    }
  }
}

async function scanComments(words: ModerationWord[], summary: ModerationScanSummary) {
  for (let skip = 0; ; skip += BATCH_SIZE) {
    const [replies, dailyComments] = await Promise.all([
      prisma.reply.findMany({ orderBy: { id: 'asc' }, skip, take: BATCH_SIZE, select: { id: true, content: true } }),
      prisma.dailyMessageComment.findMany({ orderBy: { id: 'asc' }, skip, take: BATCH_SIZE, select: { id: true, content: true } }),
    ])
    if (!replies.length && !dailyComments.length) break
    for (const reply of replies) {
      const rows = matched(reply.content, words)
      if (rows.length) {
        await prisma.reply.update({ where: { id: reply.id }, data: violationData(rows) })
        summary.comments += 1
      }
    }
    for (const comment of dailyComments) {
      const rows = matched(comment.content, words)
      if (rows.length) {
        await prisma.dailyMessageComment.update({ where: { id: comment.id }, data: violationData(rows) })
        summary.comments += 1
      }
    }
  }
}

async function scanWall(words: ModerationWord[], summary: ModerationScanSummary) {
  for (let skip = 0; ; skip += BATCH_SIZE) {
    const messages = await prisma.profileWallMessage.findMany({ orderBy: { id: 'asc' }, skip, take: BATCH_SIZE, select: { id: true, content: true } })
    if (!messages.length) break
    for (const message of messages) {
      const rows = matched(message.content, words)
      if (!rows.length) continue
      await prisma.profileWallMessage.update({ where: { id: message.id }, data: violationData(rows) })
      summary.wallMessages += 1
    }
  }
}

async function scanOther(words: ModerationWord[], summary: ModerationScanSummary) {
  for (let skip = 0; ; skip += BATCH_SIZE) {
    const [directMessages, feedbacks, feedbackReplies, stickerPacks, stickers, todayEvents, cultureComments, friendActivities] = await Promise.all([
      prisma.directMessage.findMany({ orderBy: { id: 'asc' }, skip, take: BATCH_SIZE, select: { id: true, content: true } }),
      prisma.feedback.findMany({ orderBy: { id: 'asc' }, skip, take: BATCH_SIZE, select: { id: true, title: true, content: true } }),
      prisma.feedbackReply.findMany({ orderBy: { id: 'asc' }, skip, take: BATCH_SIZE, select: { id: true, content: true } }),
      prisma.stickerPack.findMany({ orderBy: { id: 'asc' }, skip, take: BATCH_SIZE, select: { id: true, name: true, description: true } }),
      prisma.sticker.findMany({ orderBy: { id: 'asc' }, skip, take: BATCH_SIZE, select: { id: true, name: true } }),
      prisma.todayEvent.findMany({ orderBy: { id: 'asc' }, skip, take: BATCH_SIZE, select: { id: true, title: true, content: true } }),
      prisma.cultureComment.findMany({ orderBy: { id: 'asc' }, skip, take: BATCH_SIZE, select: { id: true, content: true } }),
      prisma.friendActivity.findMany({ orderBy: { id: 'asc' }, skip, take: BATCH_SIZE, select: { id: true, content: true } }),
    ])
    if (!directMessages.length && !feedbacks.length && !feedbackReplies.length && !stickerPacks.length && !stickers.length && !todayEvents.length && !cultureComments.length && !friendActivities.length) break
    for (const message of directMessages) {
      const rows = matched(message.content, words)
      if (rows.length) {
        await prisma.directMessage.update({ where: { id: message.id }, data: violationData(rows) })
        summary.other += 1
      }
    }
    for (const feedback of feedbacks) {
      const rows = matched(`${feedback.title}\n${feedback.content}`, words)
      if (rows.length) {
        await prisma.feedback.update({ where: { id: feedback.id }, data: violationData(rows) })
        summary.other += 1
      }
    }
    for (const reply of feedbackReplies) {
      const rows = matched(reply.content, words)
      if (rows.length) {
        await prisma.feedbackReply.update({ where: { id: reply.id }, data: violationData(rows) })
        summary.other += 1
      }
    }
    for (const pack of stickerPacks) {
      const rows = matched(`${pack.name}\n${pack.description || ''}`, words)
      if (rows.length) {
        await prisma.stickerPack.update({ where: { id: pack.id }, data: violationData(rows) })
        summary.other += 1
      }
    }
    for (const sticker of stickers) {
      const rows = matched(sticker.name, words)
      if (rows.length) {
        await prisma.sticker.update({ where: { id: sticker.id }, data: violationData(rows) })
        summary.other += 1
      }
    }
    for (const event of todayEvents) {
      const rows = matched(`${event.title}\n${event.content}`, words)
      if (rows.length) {
        await prisma.todayEvent.update({ where: { id: event.id }, data: violationData(rows) })
        summary.other += 1
      }
    }
    for (const comment of cultureComments) {
      const rows = matched(comment.content, words)
      if (rows.length) {
        await prisma.cultureComment.update({ where: { id: comment.id }, data: violationData(rows) })
        summary.other += 1
      }
    }
    for (const activity of friendActivities) {
      const rows = matched(activity.content, words)
      if (rows.length) {
        await prisma.friendActivity.update({ where: { id: activity.id }, data: violationData(rows) })
        summary.other += 1
      }
    }
  }
}

/** Mark matching historical rows only. A later word deletion/disable never restores a row. */
export async function scanAllContentForModeration(): Promise<ModerationScanSummary> {
  const words = await getEnabledBannedWords()
  const summary = emptySummary()
  if (!words.length) return summary

  await scanUsers(words, summary)
  await scanPosts(words, summary)
  await scanCheckinMessages(words, summary)
  await scanComments(words, summary)
  await scanWall(words, summary)
  await scanOther(words, summary)
  summary.scannedAt = new Date().toISOString()
  return summary
}
