import { NextResponse } from 'next/server'
import { publicImageUrl } from '@/lib/images'
import { uploadToCos, deleteFromCos, getCosUrl } from '@/lib/tencent-cos'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/security'
import { invalidateCurrentUserCache } from '@/lib/auth'
import { isDefaultAvatarUrl } from '@/lib/default-avatars'

export const runtime = 'nodejs'

const avatarMaxFileSize = 10 * 1024 * 1024
const backgroundMaxFileSize = 8 * 1024 * 1024

const avatarTypes = new Map([
  ['image/webp', 'webp'],
  ['image/jpeg', 'jpg'],
])

const backgroundTypes = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
])

function createCompatibleId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}


function cosPathFromUrl(url?: string | null) {
  if (!url) return null

  const bucket = process.env.TENCENT_COS_BUCKET
  const region = process.env.TENCENT_COS_REGION

  if (!bucket || !region) return null

  const prefix = `https://${bucket}.cos.${region}.myqcloud.com/`

  if (!url.startsWith(prefix)) return null

  return decodeURIComponent(url.replace(prefix, ''))
}


export async function POST(request: Request) {
  const guard = await requireUser()

  if (!guard.user) {
    return guard.response
  }


  const formData = await request.formData().catch(() => null)

  const file = formData?.get('file')

  const kind =
    String(formData?.get('kind') || 'avatar') === 'background'
      ? 'background'
      : 'avatar'


  if (!(file instanceof File)) {
    return NextResponse.json(
      { message: '请选择要上传的图片' },
      { status: 400 }
    )
  }


  if (kind === 'avatar') {

    if (!avatarTypes.has(file.type)) {
      return NextResponse.json(
        { message: '头像仅支持 JPG、WebP 图片' },
        { status: 400 }
      )
    }


    if (file.size > avatarMaxFileSize) {
      return NextResponse.json(
        { message: '头像不能超过10MB' },
        { status: 400 }
      )
    }

  } else {


    if (!backgroundTypes.has(file.type)) {
      return NextResponse.json(
        { message: '背景图仅支持 JPG、PNG、WebP' },
        { status: 400 }
      )
    }


    if (file.size > backgroundMaxFileSize) {
      return NextResponse.json(
        { message: '背景图不能超过8MB' },
        { status: 413 }
      )
    }

  }


  const extension =
    kind === 'avatar'
      ? avatarTypes.get(file.type)
      : backgroundTypes.get(file.type)


  const objectPath =
    kind === 'avatar'
      ? `avatars/${guard.user.id}/${createCompatibleId()}.${extension}`
      : `profiles/${guard.user.id}/background-${createCompatibleId()}.${extension}`



  let url: string

  try {

    await uploadToCos({
      key: objectPath,
      body: Buffer.from(await file.arrayBuffer()),
      contentType: file.type,
    })


    url = getCosUrl(objectPath)

  } catch (error) {

    console.error('[profile-image] COS upload failed', error)

    return NextResponse.json(
      {
        message:
          kind === 'avatar'
            ? '头像上传失败，请稍后再试'
            : '背景图上传失败，请稍后再试',
      },
      {
        status: 502,
      }
    )
  }



  const safeUrl = publicImageUrl(url)

  if (!safeUrl) {

    return NextResponse.json(
      { message: '图片 URL 无效' },
      { status: 500 }
    )

  }



  const current = await prisma.user.findUnique({

    where:{
      id:guard.user.id
    },

    select:{
      avatarUrl:true,
      backgroundUrl:true,
      Profile:{
        select:{
          avatarUrl:true,
          backgroundUrl:true
        }
      }
    }

  })




  try {

    await prisma.$transaction([

      prisma.user.update({

        where:{
          id:guard.user.id
        },

        data:
          kind === 'avatar'
            ? {avatarUrl:safeUrl}
            : {backgroundUrl:safeUrl}

      }),


      prisma.profile.upsert({

        where:{
          userId:guard.user.id
        },


        update:
          kind === 'avatar'
            ? {avatarUrl:safeUrl}
            : {backgroundUrl:safeUrl},


        create:{

          userId:guard.user.id,

          displayName:guard.user.nickname,

          avatarUrl:
            kind === 'avatar'
              ? safeUrl
              : null,

          backgroundUrl:
            kind === 'background'
              ? safeUrl
              : null

        }

      })

    ])


  } catch(error){

    console.error('[profile-image] database update failed',error)


    await deleteFromCos(objectPath).catch(()=>{})


    return NextResponse.json(
      {
        message:'资料更新失败，请稍后再试'
      },
      {
        status:500
      }
    )

  }



  invalidateCurrentUserCache(
    guard.user.id
  )



  if(kind==='avatar'){


    const oldAvatar =
      current?.Profile?.avatarUrl ||
      current?.avatarUrl



    if(
      oldAvatar &&
      !isDefaultAvatarUrl(oldAvatar)
    ){

      const oldPath =
        cosPathFromUrl(oldAvatar)


      const newPath =
        objectPath



      if(oldPath && oldPath!==newPath){

        void deleteFromCos(oldPath)

      }

    }

  }



  return NextResponse.json({
    url:safeUrl
  })

}