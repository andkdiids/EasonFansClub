import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { uploadToCos } from '../lib/tencent-cos'

const prisma = new PrismaClient()

const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, '')

if (!SUPABASE_URL) {
  throw new Error('缺少 SUPABASE_URL')
}

function isSupabaseUrl(url?: string | null) {
  return !!url && url.includes('supabase.co')
}

function getExtension(url: string) {
  if (url.includes('.png')) return 'png'
  if (url.includes('.webp')) return 'webp'
  return 'jpg'
}

async function migrateImage(
  url: string,
  path: string
) {
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`下载失败 ${response.status}`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())

  return uploadToCos({
    key: path,
    body: buffer,
    contentType: response.headers.get('content-type') || 'image/jpeg',
  })
}


async function main() {

  const users = await prisma.user.findMany({
    where:{
      OR:[
        {
          avatarUrl:{
            contains:'supabase'
          }
        },
        {
          backgroundUrl:{
            contains:'supabase'
          }
        }
      ]
    },
    select:{
      id:true,
      avatarUrl:true,
      backgroundUrl:true
    }
  })


  console.log(`发现 ${users.length} 个用户需要迁移`)


  for(const user of users){

    const data: { avatarUrl?: string; backgroundUrl?: string } = {}


    if(isSupabaseUrl(user.avatarUrl)){

      try{

        const ext=getExtension(user.avatarUrl!)

        const newUrl=await migrateImage(
          user.avatarUrl!,
          `avatars/${user.id}.${ext}`
        )

        data.avatarUrl=newUrl

        console.log(
          '头像迁移成功',
          user.id
        )

      }catch(e){

        console.error(
          '头像失败',
          user.id,
          e
        )
      }
    }



    if(isSupabaseUrl(user.backgroundUrl)){

      try{

        const ext=getExtension(user.backgroundUrl!)

        const newUrl=await migrateImage(
          user.backgroundUrl!,
          `profiles/${user.id}/background.${ext}`
        )

        data.backgroundUrl=newUrl

        console.log(
          '背景迁移成功',
          user.id
        )

      }catch(e){

        console.error(
          '背景失败',
          user.id,
          e
        )
      }
    }



    if(Object.keys(data).length){

      await prisma.user.update({
        where:{
          id:user.id
        },
        data
      })

    }

  }


  console.log('迁移完成')

}


main()
.then(()=>{
 prisma.$disconnect()
})
.catch(e=>{
 console.error(e)
 prisma.$disconnect()
})