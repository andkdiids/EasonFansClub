import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('默认头像池复用 SiteSetting 和 User.avatarUrl，不修改 Prisma 结构', () => {
  const service = read('lib/default-avatars.ts')
  const schema = read('prisma/schema.prisma')
  assert.match(service, /users\.defaultAvatarPool/)
  assert.match(service, /siteSetting\.upsert/)
  assert.match(service, /data: \{ avatarUrl:/)
  assert.doesNotMatch(schema, /defaultAvatarId/)
})

test('注册时从启用头像池随机选择并固定写入用户头像', () => {
  const register = read('app/api/auth/register/route.ts')
  const service = read('lib/default-avatars.ts')
  assert.match(register, /chooseDefaultAvatar\(tx\)/)
  assert.match(register, /avatarUrl: defaultAvatarUrl/)
  assert.match(service, /filter\(\(item\) => item\.enabled && !isSupabaseStorageUrl\(item\.url\)\)/)
  assert.match(service, /Math\.floor\(Math\.random\(\) \* enabled\.length\)/)
})

test('后台头像支持 WebP 转换、启停和安全移出头像池', () => {
  const route = read('app/api/admin/default-avatars/route.ts')
  const manager = read('app/admin/default-avatars/DefaultAvatarManager.tsx')
  assert.match(route, /\.rotate\(\)/)
  assert.match(route, /\.flatten\(\{ background: '#ffffff' \}\)/)
  assert.match(route, /\.webp\(\{ quality: 86 \}\)/)
  assert.match(route, /export async function PATCH/)
  assert.match(route, /export async function DELETE/)
  assert.match(route, /不删除存储对象/)
  assert.match(route, /retired: true/)
  assert.match(read('lib/default-avatars.ts'), /includeRetired/)
  assert.match(manager, /image\/jpeg,image\/png,image\/webp/)
})

test('用户上传自定义头像不会删除多人共用的系统默认头像', () => {
  const upload = read('app/api/uploads/profile-image/route.ts')
  assert.match(upload, /isDefaultAvatarUrl\(oldAvatar\)/)
  assert.match(upload, /cosPathFromUrl/)
  assert.match(upload, /oldPath && oldPath!==newPath/)
})

test('默认头像上传失败时返回具体原因，不允许静默失败', () => {
  const route = read('app/api/admin/default-avatars/route.ts')
  const manager = read('app/admin/default-avatars/DefaultAvatarManager.tsx')
  const cos = read('lib/tencent-cos.ts')
  // 配置缺失 / 表单解析 / 文件为空 / 格式 / sharp / COS / 保存头像池分别给出明确原因
  assert.match(route, /missingCosConfig\(\)/)
  assert.match(route, /腾讯云 COS 配置缺失/)
  assert.match(route, /表单解析失败/)
  assert.match(route, /文件为空或未收到 file 字段/)
  assert.match(route, /sharp 转换 WebP 失败/)
  assert.match(route, /COS 上传失败：\$\{describeCosError\(error\)\}/)
  assert.match(route, /保存头像池失败/)
  // 前端展示 API 返回的真实错误
  assert.match(manager, /setError\(data\.message \|\| '上传失败'\)/)
  // COS lib 校验全部四项配置并支持 TENCENT_COS_* 与 COS_* 两套变量名
  assert.match(cos, /TENCENT_COS_SECRET_ID', 'COS_SECRET_ID/)
  assert.match(cos, /TENCENT_COS_BUCKET', 'COS_BUCKET/)
  assert.match(cos, /腾讯云 COS 配置缺失/)
})

test('无头像池时统一头像组件使用 UID 首字符而非用户名首字', () => {
  const avatar = read('components/SafeAvatar.tsx')
  assert.match(avatar, /String\(uid\)\.padStart\(5, '0'\)\.slice\(0, 1\)/)
  assert.doesNotMatch(avatar, /name\.trim\(\)\.slice/)
})
