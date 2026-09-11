import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { artistPath, creatorPath, normalizeArtistSlug } from '../lib/studio/artists'

const root = path.resolve(__dirname, '..')
const read = (file: string) => readFileSync(path.join(root, file), 'utf8')

test('艺术家 slug 与独立主页路径保持稳定且不混用用户主页', () => {
  assert.equal(normalizeArtistSlug(' Beethoven '), 'beethoven')
  assert.equal(normalizeArtistSlug('eason-fans'), 'eason-fans')
  assert.equal(normalizeArtistSlug('贝多芬'), null)
  assert.equal(normalizeArtistSlug('bad slug'), null)
  assert.equal(artistPath('beethoven'), '/artists/beethoven')
  assert.equal(creatorPath(42), '/artist/00042')
  assert.equal(creatorPath('00042'), '/artist/00042')

  const page = read('app/artists/[slug]/page.tsx')
  const component = read('components/studio/ArtistProfile.tsx')
  assert.match(page, /getPublicArtistPage/)
  assert.match(component, new RegExp('studio/project'))
  assert.doesNotMatch(component, /关注|好友|私信|UserDisplayName/)
})

test('拼豆作品的 ARTIST 使用上传用户，并进入用户作品主页', () => {
  const schema = read('prisma/schema.prisma')
  const migration = read('prisma/migrations/20260910190000_add_studio_artists/migration.sql')
  const detailPage = read('app/studio/project/[projectId]/page.tsx')
  const publicService = read('lib/studio/public.ts')
  const detail = read('components/studio/StudioPublicProject.tsx')
  const gallery = read('components/studio/StudioGallery.tsx')
  const creatorPage = read('app/artist/[userId]/page.tsx')
  const creatorComponent = read('components/studio/CreatorProfile.tsx')
  assert.match(schema, /model Artist \{/)
  assert.match(schema, /artistId\s+String\?/)
  assert.match(schema, /Artist\s+Artist\?/)
  assert.match(migration, /CREATE TABLE `Artist`/)
  assert.match(migration, /SET `artistId` = 'beethoven'/)
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE/i)
  assert.match(detailPage, /project\.User/)
  assert.match(detailPage, /publicCreatorSummary/)
  assert.doesNotMatch(detailPage, /project\.Artist/)
  assert.match(publicService, /User: \{ select: publicCreatorSelect \}/)
  assert.match(publicService, /userId: creator\.id/)
  assert.match(detail, /creatorPath\(project\.creator\.uid\)/)
  assert.match(detail, /<small>ARTIST<\/small>/)
  assert.doesNotMatch(detail, /创作者/)
  assert.doesNotMatch(detail, /project\.artist/)
  assert.match(gallery, /作者：\{project\.author\}/)
  assert.doesNotMatch(gallery, /project\.artist|艺术家\$\{project\.artist/)
  assert.match(creatorPage, /getPublicCreatorPage/)
  assert.match(creatorPage, /params: Promise<\{ userId: string \}>/)
  assert.match(creatorComponent, /CreatorProfile/)
  assert.match(creatorComponent, /creator\.name/)
})

test('公开搜索、广场和后台都提供艺术家入口或维护能力', () => {
  assert.match(read('app/search/page.tsx'), /prisma\.artist\.findMany/)
  assert.match(read('components/studio/StudioGallery.tsx'), /作者：\{project\.author\}/)
  assert.doesNotMatch(read('components/studio/StudioGallery.tsx'), /galleryArtistLink/)
  assert.match(read('app/api/admin/studio/artists/route.ts'), /requireAdmin\('studio_manage'\)/)
  assert.match(read('app/api/admin/studio/projects/[projectId]/artist/route.ts'), /artistId/)
  assert.match(read('app/admin/studio/StudioAdminPanel.tsx'), /艺术家管理/)
})
