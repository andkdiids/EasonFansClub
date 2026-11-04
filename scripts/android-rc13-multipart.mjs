import { open } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'

const PART_SIZE = 8 * 1024 * 1024
const MIN_INITIAL_CREDENTIAL_REMAINING_MS = 15 * 60 * 1000
const COMPLETE_CREDENTIAL_SAFETY_MS = 60 * 1000
const SAFE_HEADER = Object.freeze({ 'x-cos-forbid-overwrite': 'true' })
const SAFE_COS_CODES = new Set(['FileAlreadyExists', 'NoSuchUpload', 'AccessDenied', 'ECONNRESET', 'ETIMEDOUT', 'SlowDown', 'InternalError', 'ServiceUnavailable'])

// Only expose protocol error fields; messages and headers may contain credentials.
export function safeCosError(error) {
  const candidate = String(error?.code || error?.error?.Code || '')
  const code = SAFE_COS_CODES.has(candidate) ? candidate : 'UNKNOWN'
  const status = Number(error?.statusCode) || 0
  const requestId = String(error?.headers?.['x-cos-request-id'] || '')
  const safeRequestId = /^[A-Za-z0-9+/=_-]{24,128}$/.test(requestId) && !/^(AKID|TMP)/i.test(requestId) ? requestId : 'UNKNOWN'
  return `code=${code} status=${status} request_id=${safeRequestId}`
}

export async function completeOnce(cos, base, uploadId, parts, onRequest = () => {}) {
  const xmlParts = parts.map(({ PartNumber, ETag }) => {
    if (!Number.isInteger(PartNumber) || !/^"?[a-fA-F0-9-]+"?$/.test(ETag)) throw new Error('COS_PART_ETAG_INVALID')
    return `<Part><PartNumber>${PartNumber}</PartNumber><ETag>"${ETag.replaceAll('"', '')}"</ETag></Part>`
  }).join('')
  const body = Buffer.from(`<CompleteMultipartUpload>${xmlParts}</CompleteMultipartUpload>`)
  onRequest()
  const result = await cos.request({ ...base, Method: 'POST', Query: { uploadId }, Headers: { ...SAFE_HEADER, 'Content-Type': 'application/xml', 'Content-Length': body.length, 'Content-MD5': createHash('md5').update(body).digest('base64') }, Body: Readable.from(body) })
  if (result?.Error) {
    const responseError = new Error('COS_COMPLETE_RESPONSE_INVALID')
    const responseCode = String(result.Error?.Code || result.Error?.code || '')
    if (SAFE_COS_CODES.has(responseCode)) responseError.code = responseCode
    if (Number.isFinite(Number(result.statusCode))) responseError.statusCode = Number(result.statusCode)
    if (result.headers && typeof result.headers === 'object') responseError.headers = result.headers
    responseError.cosResponseError = true
    throw responseError
  }
  if (!result?.CompleteMultipartUploadResult?.ETag) throw new Error('COS_COMPLETE_RESPONSE_INVALID')
  return result
}

export async function multipartUpload({ cos, bucket, region, key, filePath, size, sha256, concurrency = 3, credentialsExpiredTime, log = console.log, clock = { now: Date.now, setInterval, clearInterval } }) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error('COS_CONCURRENCY_INVALID')
  if (!Number.isSafeInteger(size) || size <= 0 || !/^[a-fA-F0-9]{64}$/.test(sha256)) throw new Error('COS_SOURCE_METADATA_INVALID')
  const base = { Bucket: bucket, Region: region, Key: key }
  const expiresAtMs = credentialsExpiredTime === undefined ? undefined : Number(credentialsExpiredTime) * 1000
  if (expiresAtMs !== undefined && (!Number.isFinite(expiresAtMs) || expiresAtMs - clock.now() < MIN_INITIAL_CREDENTIAL_REMAINING_MS)) {
    throw new Error('TENCENT_STS_CREDENTIALS_INSUFFICIENT_LIFETIME')
  }
  // The COS forbid-overwrite header is ineffective with bucket versioning enabled.
  let versioning
  try { versioning = await cos.getBucketVersioning({ Bucket: bucket, Region: region }) } catch (error) {
    log(`COS_BUCKET_VERSIONING_FAILURE ${safeCosError(error)}`)
    throw new Error('COS_BUCKET_VERSIONING_UNVERIFIED')
  }
  if (!versioning?.VersioningConfiguration || versioning.VersioningConfiguration.Status) throw new Error('COS_BUCKET_VERSIONING_UNSUPPORTED')
  const started = clock.now()
  let lastProgress = started
  let uploaded = 0
  let uploadId
  let initAttempted = false
  let completeAttempted = false
  let completed = false
  let file
  let timer
  let failed
  let abortPromise
  let abortAttempts = 0
  let previousBytes = 0
  let previousTime = started
  let retries = 0
  const abortOwned = async ({ afterWorkersSettle = false } = {}) => {
    if (abortPromise) await abortPromise
    if (abortAttempts > 0 && !afterWorkersSettle) return
    abortAttempts++
    abortPromise = cos.multipartAbort({ ...base, UploadId: uploadId }).then(
      () => log(`COS_MULTIPART_ABORT=COMPLETE attempt=${abortAttempts}`),
      (error) => {
        const code = String(error?.code || error?.error?.Code || '')
        if (code === 'NoSuchUpload') log(`COS_MULTIPART_ABORT=ALREADY_ABSENT attempt=${abortAttempts}`)
        else log(`COS_MULTIPART_ABORT=FAILED attempt=${abortAttempts} ${safeCosError(error)}`)
      },
    ).finally(() => { abortPromise = undefined })
    await abortPromise
  }
  try {
    file = await open(filePath, 'r')
    // A stream disables the SDK's automatic replay if initialization loses its response.
    if (expiresAtMs !== undefined && expiresAtMs - clock.now() < MIN_INITIAL_CREDENTIAL_REMAINING_MS) {
      throw new Error('TENCENT_STS_CREDENTIALS_INSUFFICIENT_LIFETIME')
    }
    initAttempted = true
    const init = await cos.request({ ...base, Method: 'POST', Action: 'uploads', Headers: { ...SAFE_HEADER, 'Content-Length': 0, 'Content-Type': 'application/vnd.android.package-archive', 'Cache-Control': 'public, max-age=31536000, immutable', 'x-cos-meta-sha256': sha256 }, Body: Readable.from(Buffer.alloc(0)) })
    uploadId = init?.InitiateMultipartUploadResult?.UploadId
    if (!uploadId || typeof uploadId !== 'string') throw new Error('COS_UPLOAD_ID_MISSING')
    log(`COS_MULTIPART_INIT ${safeCosError(init)}`)
    const count = Math.ceil(size / PART_SIZE)
    const parts = new Array(count)
    let next = 0
    const inFlight = new Array(count).fill(0)
    timer = clock.setInterval(() => {
      const elapsed = Math.max(1, clock.now() - started)
      const current = Math.min(size, uploaded + inFlight.reduce((sum, value) => sum + value, 0))
      const recentBps = Math.max(0, Math.floor((current - previousBytes) * 1000 / Math.max(1, clock.now() - previousTime)))
      log(`COS_UPLOAD_PROGRESS bytes=${current} total=${size} remaining=${size - current} percent=${Math.floor(current * 100 / size)} elapsed_ms=${elapsed} average_bps=${Math.floor(current * 1000 / elapsed)} recent_bps=${recentBps} completed_parts=${parts.filter(Boolean).length} total_parts=${count} retries=${retries}${clock.now() - lastProgress >= 60000 ? ' STALLED=YES' : ''}`)
      previousBytes = current
      previousTime = clock.now()
      if (!failed && clock.now() - lastProgress >= 300000) {
        failed = new Error('COS_UPLOAD_STALLED')
        // Cancel the upload promptly, then repeat cleanup after every active
        // part request settles so a late part cannot leave an MPU behind.
        log('COS_UPLOAD_STALLED_ABORT=START')
        void abortOwned()
      }
    }, 5000)
    const worker = async () => {
      while (!failed) {
        const index = next++
        if (index >= count) return
        const length = Math.min(PART_SIZE, size - index * PART_SIZE)
        const buffer = Buffer.alloc(length)
        const { bytesRead } = await file.read(buffer, 0, length, index * PART_SIZE)
        if (bytesRead !== length) { failed = new Error('COS_SOURCE_READ_INCOMPLETE'); return }
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const result = await cos.multipartUpload({ ...base, UploadId: uploadId, PartNumber: index + 1, Body: Readable.from(buffer), ContentLength: length, onProgress: ({ loaded }) => {
              if (Number.isFinite(loaded) && loaded > inFlight[index]) lastProgress = clock.now()
              if (Number.isFinite(loaded)) inFlight[index] = Math.max(0, Math.min(length, loaded))
            } })
            if (!result?.ETag) throw new Error('COS_PART_ETAG_MISSING')
            parts[index] = { PartNumber: index + 1, ETag: result.ETag }
            inFlight[index] = 0
            uploaded += length
            lastProgress = clock.now()
            break
          } catch (error) {
            inFlight[index] = 0
            log(`COS_PART_FAILURE part=${index + 1} attempt=${attempt} ${safeCosError(error)}`)
            if (failed) return
            if (attempt < 3) retries++
            if (attempt === 3) failed = error
          }
        }
      }
    }
    const results = await Promise.allSettled(Array.from({ length: Math.min(concurrency, count) }, worker))
    failed ||= results.find((result) => result.status === 'rejected')?.reason
    if (failed) throw failed
    const finalVersioning = await cos.getBucketVersioning({ Bucket: bucket, Region: region })
    if (!finalVersioning?.VersioningConfiguration || finalVersioning.VersioningConfiguration.Status) throw new Error('COS_BUCKET_VERSIONING_UNSUPPORTED')
    if (expiresAtMs !== undefined && expiresAtMs - clock.now() <= COMPLETE_CREDENTIAL_SAFETY_MS) {
      throw new Error('TENCENT_STS_CREDENTIALS_EXPIRED_BEFORE_COMPLETE')
    }
    const result = await completeOnce(cos, base, uploadId, parts, () => { completeAttempted = true })
    completed = true
    log(`COS_MULTIPART_COMPLETE elapsed_ms=${clock.now() - started} bytes=${uploaded} ${safeCosError(result)}`)
  } catch (error) {
    log(`COS_MULTIPART_FAILURE ${safeCosError(error)} complete_attempted=${completeAttempted}`)
    const statusCode = Number(error?.statusCode)
    const conflict = (completeAttempted || (initAttempted && !uploadId)) && (statusCode === 409 || error?.code === 'FileAlreadyExists' || error?.error?.Code === 'FileAlreadyExists')
    const completeRejected = completeAttempted && (error?.cosResponseError === true || (statusCode >= 400 && statusCode < 500))
    if (uploadId && !completed && (!completeAttempted || conflict || completeRejected)) {
      await abortOwned({ afterWorkersSettle: error?.message === 'COS_UPLOAD_STALLED' })
    }
    if (conflict) throw new Error('COS_OBJECT_KEY_ALREADY_EXISTS')
    if (initAttempted && !uploadId) {
      log('COS_INIT_UNCERTAIN=UPLOAD_ID_UNKNOWN')
      throw new Error('COS_MULTIPART_INIT_UNCERTAIN')
    }
    if (completeAttempted && !completed) {
      // A failed response does not establish whether COS committed the object.
      try { const head = await cos.headObject(base); log(`COS_COMPLETE_UNCERTAIN head_status=${Number(head?.statusCode) || 0}`) } catch (headError) { log(`COS_COMPLETE_UNCERTAIN ${safeCosError(headError)}`) }
      throw new Error('COS_COMPLETE_UNCERTAIN')
    }
    if (error?.message === 'TENCENT_STS_CREDENTIALS_INSUFFICIENT_LIFETIME'
      || error?.message === 'TENCENT_STS_CREDENTIALS_EXPIRED_BEFORE_COMPLETE') throw error
    throw new Error('COS_MULTIPART_UPLOAD_FAILED')
  } finally {
    if (timer) clock.clearInterval(timer)
    if (file) await file.close()
  }
}
