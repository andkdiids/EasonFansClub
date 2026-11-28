import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

function read(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

test('live photo upload is validated on the server, never trusted from the client', () => {
  const service = read('lib/live-photo-service.ts')
  // Real container detection comes from bytes, not from the reported MIME type.
  assert.match(service, /probeLivePhotoUpload\(/, 'server must probe the real container')
  assert.doesNotMatch(service, /body\.type === 'image/, 'client MIME type must not decide the media kind')
  assert.match(service, /LIVE_PHOTO_TOO_LARGE|maxUploadBytes/, 'upload size must be enforced server side')
})

test('transcoding runs as a bounded async task outside the post request', () => {
  const posts = read('app/api/posts/route.ts')
  assert.doesNotMatch(posts, /ffmpeg|runFfmpeg|transcodeAsset/, 'posting must not transcode inline')
  const transcode = read('lib/live-photo-transcode.ts')
  assert.match(transcode, /config\.transcodeConcurrency/, 'concurrency must be capped by config')
  assert.match(transcode, /runFfmpeg\(/, 'ffmpeg must go through the controlled runner')
  assert.doesNotMatch(transcode, /exec\(|execSync\(/, 'no shell string execution allowed')
  assert.match(transcode, /'-map_metadata', '-1'/, 'GPS metadata must be stripped')
})

test('unapproved media stays private and is only served through the guarded route', () => {
  const service = read('lib/live-photo-service.ts')
  assert.match(service, /Post\.moderationStatus === 'APPROVED'/, 'public visibility requires approval')
  assert.match(service, /Post\.publicationStatus === 'PUBLISHED'/, 'public visibility requires publication')
  const storage = read('lib/live-photo-storage.ts')
  assert.match(storage, /ACL: 'private'/, 'objects must be uploaded as private')
  const delivery = read('lib/live-photo-delivery.ts')
  assert.match(delivery, /canViewLivePhotoAsset\(/, 'delivery must check ownership and review state')
  assert.match(delivery, /const cacheControl = isPublic/, 'cache policy must branch on visibility')
  assert.match(delivery, /'private, no-store, max-age=0'/, 'unapproved media must not be publicly cached')
})

test('admin configuration exposes the reversible live photo switches with audit', () => {
  const panel = read('app/admin/live-photo/LivePhotoAdminPanel.tsx')
  for (const key of ['enabled', 'keepAudio', 'maxDurationSeconds', 'maxUploadBytes', 'maxVideoEdge', 'maxFps', 'quality', 'transcodeConcurrency']) {
    assert.match(panel, new RegExp(key), `admin must expose ${key}`)
  }
  const route = read('app/api/admin/live-photo/route.ts')
  assert.match(route, /requireRequestAdmin\(request, 'site_config_manage'\)/, 'config changes require permission')
  const store = read('lib/live-photo-config-store.ts')
  assert.match(store, /createAdminActionAudit\(/, 'config changes must be audited')
  const cleanup = read('app/api/admin/live-photo/cleanup/route.ts')
  assert.match(cleanup, /requireRequestAdmin\(request, 'site_config_manage'\)/, 'cleanup requires permission')
  assert.match(cleanup, /LIVE_PHOTO_CLEANUP/, 'cleanup must be audited')
})

test('cleanup never removes media that is still referenced', () => {
  const service = read('lib/live-photo-service.ts')
  assert.match(service, /if \(active\.has\(asset\.id\) \|\| asset\.PostMedia\.length\) continue/, 'referenced or active media is skipped')
  assert.match(service, /draftReferencesAsset\(asset\.id, asset\.ownerId\)/, 'drafts keep their media alive')
  assert.match(service, /const references = await prisma\.postMedia\.count/, 'deletion re-checks live references')
})

test('legacy clients keep reading the static cover', () => {
  const posts = read('app/api/posts/route.ts')
  // PostMedia.url stays the plain cover URL so old apps can render it as an image.
  assert.match(posts, /type: 'LIVE_PHOTO'/, 'live photo rows are tagged')
  assert.match(posts, /url:/, 'a plain URL must stay available for old clients')
  const markers = read('lib/live-photo-markers.ts')
  assert.match(markers, /toLivePhotoMarker|livePhotoIdFromMarker/, 'marker helpers must stay backward compatible')
})

test('moderation centre receives playback metadata, not only the cover', () => {
  const review = read('app/api/admin/review/route.ts')
  // The review query must not filter to IMAGE only, otherwise live photos vanish.
  assert.doesNotMatch(review, /PostMedia: \{ where: \{ type: 'IMAGE'/, 'review query must not drop live photos')
  assert.match(review, /videoUrl/, 'review must expose the video for review')
  const legacyReview = read('app/api/admin/posts/review/route.ts')
  assert.match(legacyReview, /videoUrl/, 'legacy review endpoint must expose the video too')
  const centre = read('app/admin/review/ReviewCenter.tsx')
  assert.match(centre, /livePhoto|videoUrl/, 'review UI must be able to play the clip')
})

test('guarded delivery refuses with a non-cacheable response', async () => {
  const { deliverLivePhoto } = await import('../lib/live-photo-delivery.ts')
  const response = await deliverLivePhoto(
    new Request('https://ecfc.fans/api/media/live-photo/ab/cover'),
    'ab',
    'cover',
  )
  assert.equal(response.status, 400)
  // These two read paths are opened in middleware and therefore lose its
  // default no-store wrapper; a cached refusal would outlive the approval that
  // is supposed to make the very same URL readable.
  assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0')

  const delivery = read('lib/live-photo-delivery.ts')
  assert.match(delivery, /const refusal = /, 'every refusal path must share the no-store wrapper')
  assert.doesNotMatch(delivery, /NextResponse\.json\(\{ code: '[A-Z_]+', message: '[^']*' \}, \{ status: \d+ \}\)/, 'no refusal may bypass the wrapper')
})

test('the shared image picker detects native live photos instead of a manual entry', () => {
  const uploader = read('components/ContentImageUploader.tsx')
  // The product decision changed: users pick a photo once, never a cover + clip.
  assert.doesNotMatch(uploader, /添加实况照片/, 'the separate live photo entry must be gone')
  assert.doesNotMatch(uploader, /配对动态视频/, 'no manual pairing field may remain')
  assert.doesNotMatch(uploader, /layer-modal/, 'the misplaced dialog must not come back')

  const addFiles = uploader.slice(uploader.indexOf('async function addFiles'))
  const detectAt = addFiles.indexOf('await detectSelectedMedia(')
  const uploadAt = addFiles.indexOf('await uploadItem(item)')
  assert.ok(detectAt >= 0, 'classification must run inside the shared picker')
  assert.ok(uploadAt > detectAt, 'classification must finish before any upload/compression starts')
  assert.match(uploader, /kind === 'live-photo'/, 'a live photo is one media slot, not two')
})

test('native upload and pairing APIs stay available for the apps', () => {
  const route = read('app/api/media/live-photo/route.ts')
  assert.match(route, /manual/, 'the server keeps accepting a paired cover + video from native clients')
  const browser = read('lib/live-photo-browser.ts')
  assert.match(browser, /uploadLivePhotoMedia/, 'the shared uploader stays reusable by the apps')
  assert.match(browser, /detectSelectedMedia/, 'detection is shared, not inlined in a component')
})

test('a taken-down live photo cannot stay cached forever', () => {
  const delivery = read('lib/live-photo-delivery.ts')
  // `immutable` made a takedown unreachable for anyone who already opened the
  // media; the public branch must stay revalidatable, the private one uncached.
  assert.doesNotMatch(delivery, /immutable/, 'public media must remain revalidatable after a takedown')
  assert.match(delivery, /max-age=86400/, 'a browser must re-check within a day')
  assert.match(delivery, /if-none-match/i, 'revalidation must be answerable with a cheap 304')
  assert.match(delivery, /private, no-store, max-age=0/)
  assert.match(delivery, /asset\.PostMedia\.some/, 'the public flag comes from the access-checked relation')
})
