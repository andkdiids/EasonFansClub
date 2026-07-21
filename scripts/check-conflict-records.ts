import { prisma } from '../lib/prisma'

async function main() {
  const id = 'cmrp4xa600011vbghhx9m5hd7'

  const row = await prisma.checkIn.findUnique({
    where: { id },
    select: {
      id: true,
      checkinDateKey: true,
      checkDate: true,
      createdAt: true,
      mood: true,
      message: true,
    },
  })

  console.log('准备删除的重复签到记录：')
  console.dir(row, { depth: null })

  if (!row) {
    console.log('记录不存在，未执行删除。')
    return
  }

  await prisma.checkIn.delete({
    where: { id },
  })

  console.log(`已删除重复记录：${id}`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())