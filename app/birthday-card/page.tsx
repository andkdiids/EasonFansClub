import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getTodayMonthDay } from '@/lib/today'
import { BirthdayCard } from '@/components/birthday/BirthdayCard'

export const dynamic = 'force-dynamic'

export default async function BirthdayCardPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login?next=/birthday-card')

  // 生日卡片仅本人可看，且仅在生日当天开启；生日公开开关只控制是否展示生日日期，不影响卡片打开。
  // 生日资料查询不 catch：数据库异常应返回 500，绝不能当「未登录」跳登录页
  const fresh = await prisma.user
    .findUnique({
      where: { id: user.id },
      select: {
        nickname: true,
        avatarUrl: true,
        uid: true,
        birthMonth: true,
        birthDay: true,
        birthdayPublic: true,
      },
    })
  if (!fresh) redirect('/login?next=/birthday-card')

  const { month, day } = getTodayMonthDay()
  const isBirthday = fresh.birthMonth === month && fresh.birthDay === day

  if (!isBirthday) {
    return (
      <main className="birthday-card-page">
        <div className="birthday-card-locked">
          <div className="birthday-card-locked-emoji">🎂</div>
          <p className="birthday-card-locked-text">今天不是你的生日哦，生日卡片将在生日当天开启 ❤️</p>
        </div>
      </main>
    )
  }

  const blessing = `今天是 ${fresh.nickname} 的生日纪念日，愿新的一岁，继续被喜欢的音乐陪伴，被温柔的人遇见。`
  const dateText =
    fresh.birthdayPublic && fresh.birthMonth && fresh.birthDay
      ? `${fresh.birthMonth}月${fresh.birthDay}日`
      : null

  return (
    <main className="birthday-card-page">
      <h1 className="birthday-card-page-title">🎂 我的生日卡片</h1>
      <BirthdayCard
        nickname={fresh.nickname}
        uid={fresh.uid}
        avatarUrl={fresh.avatarUrl}
        blessing={blessing}
        dateText={dateText}
      />
    </main>
  )
}
