import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { artistPath, normalizeArtistSlug } from '../lib/studio/artists'

const root = path.resolve(__dirname, '..')
const read = (file: string) => readFileSync(path.join(root, file), 'utf8')

test('艺术家 slug 与独立主页路径保持稳定且不混用用户主页', () => {
  assert.equal(normalizeArtistSlug(' Beethoven '), 'beethoven')
  assert.equal(normalizeArtistSlug('eason-fans'), 'eason-fans')
  assert.equal(normalizeArtistSlug('贝多芬'), null)
  assert.equal(normalizeArtistSlug('bad slug'), null)
  assert.equal(artistPath('beethoven'), '/artists/beethoven')

  const page = read('app/artists/[slug]/page.tsx')
  const component = read('components/studio/ArtistProfile.tsx')
  assert.match(page, /getPublicArtistPage/)
  assert.match(component, new RegExp('studio/project'))
  assert.doesNotMatch(component, /关注|好友|私信|UserDisplayName/)
})

test('贝多芬作品通过 Artist 关系进入艺术家主页，保留 User 作者关系', () => {
  const schema = read('prisma/schema.prisma')
  const migration = read('prisma/migrations/20260910190000_add_studio_artists/migration.sql')
  const saveRoute = read('app/api/studio/projects/route.ts')
  const detailPage = read('app/studio/project/[projectId]/page.tsx')
  assert.match(schema, /model Artist \{/)
  assert.match(schema, /artistId\s+String\?/)
  assert.match(schema, /Artist\s+Artist\?/)
  assert.match(migration, /CREATE TABLE `Artist`/)
  assert.match(migration, /SET `artistId` = 'beethoven'/)
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE/i)
  assert.match(saveRoute, /BEETHOVEN_ARTIST_ID/)
  assert.match(detailPage, /project\.Artist/)
  assert.match(read('components/studio/StudioPublicProject.tsx'), /artists\/\$\{encodeURIComponent\(project\.artist\.slug\)\}/)
})

test('公开搜索、广场和后台都提供艺术家入口或维护能力', () => {
  assert.match(read('app/search/page.tsx'), /prisma\.artist\.findMany/)
  assert.match(read('components/studio/StudioGallery.tsx'), /galleryArtistLink/)
  assert.match(read('app/api/admin/studio/artists/route.ts'), /requireAdmin\('studio_manage'\)/)
  assert.match(read('app/api/admin/studio/projects/[projectId]/artist/route.ts'), /artistId/)
  assert.match(read('app/admin/studio/StudioAdminPanel.tsx'), /艺术家管理/)
})
