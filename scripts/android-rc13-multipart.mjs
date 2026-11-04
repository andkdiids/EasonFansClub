import { open } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'

const PART_SIZE = 8 * 1024 * 1024
const PART_STREAM_CHUNK_SIZE = 64 * 1024
const MIN_INITIAL_CREDENTIAL_REMAINING_MS = 15 * 60 * 1000
const COMPLETE_CREDENTIAL_SAFETY_MS = 60 * 1000
const SAFE_HEADER = Object.freeze({ 'x-cos-forbid-overwrite': 'true' })
const SAFE_COS_CODES = new Set(['FileAlreadyExists', 'NoSuchUpload', 'AccessDenied', 'UserNetworkTooSlow', 'ECONNRESET', 'ETIMEDOUT', 'ESOCKETTIMEDOUT', 'SlowDown', 'InternalError', 'ServiceUnavailable'])
const SAFE_TRANSPORT_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ESOCKETTIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'EPIPE'])
const RETRYABLE_COS_CODES = new Set(['InternalError', 'SlowDown', 'ServiceUnavailable'])
const SAFE_INTERNAL_ERROR_CODES = new Set([
  'COS_MULTIPART_CANCELLATION_UNAVAILABLE',
  'COS_PART_ETAG_INVALID',
  'COS_COMPLETE_RESPONSE_INVALID',
  'COS_CONCURRENCY_INVALID',
  'COS_SOURCE_METADATA_INVALID',
  'TENCENT_STS_CREDENTIALS_INSUFFICIENT_LIFETIME',
  'COS_BUCKET_VERSIONING_UNVERIFIED',
  'COS_BUCKET_VERSIONING_UNSUPPORTED',
  'COS_UPLOAD_STALLED',
  'COS_SOURCE_READ_INCOMPLETE',
  'COS_PART_ETAG_MISSING',
  'COS_PART_ATTEMPTS_EXHAUSTED',
  'TENCENT_STS_CREDENTIALS_EXPIRED_BEFORE_COMPLETE',
  'COS_OBJECT_KEY_ALREADY_EXISTS',
  'COS_MULTIPART_INIT_UNCERTAIN',
  'COS_COMPLETE_UNCERTAIN',
  'COS_MULTIPART_UPLOAD_STALLED',
  'COS_MULTIPART_PART_NON_RETRYABLE_UserNetworkTooSlow',
  'COS_MULTIPART_PART_NON_RETRYABLE_AccessDenied',
  'COS_MULTIPART_PART_NON_RETRYABLE_FileAlreadyExists',
  'COS_MULTIPART_PART_NON_RETRYABLE_NoSuchUpload',
  'COS_MULTIPART_PART_NON_RETRYABLE_INVALID_ARGUMENT',
  'COS_MULTIPART_UPLOAD_FAILED',
])
const COS_TASK_REGISTRIES = new WeakMap()
const MAX_PART_ATTEMPTS = 3
const STALL_WARNING_MS = 60_000
const STALL_ABORT_MS = 300_000

function getHeaderValue(headers, name) {
  if (!headers || typeof headers !== 'object') return ''
  const target = name.toLowerCase()
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === target)
  return entry ? String(entry[1] ?? '') : ''
}

function* splitBuffer(buffer) {
  for (let offset = 0; offset < buffer.length; offset += PART_STREAM_CHUNK_SIZE) {
    yield buffer.subarray(offset, Math.min(buffer.length, offset + PART_STREAM_CHUNK_SIZE))
  }
}

function sanitizeCosResponseMessage(value) {
  if (typeof value !== 'string' || value.length === 0) return 'NO_COS_ERROR_MESSAGE'
  const sanitized = value
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[REDACTED_URL]')
    .replace(/\b(authorization|secret[-_ ]?(?:id|key)|security[-_ ]?token|session[-_ ]?token|access[-_ ]?token|bearer|q-signature|x-cos-security-token)\b\s*[:=]\s*(?:bearer\s+)?(?:"[^"]*"|'[^']*'|[^\s,;&<>]+)/gi, '$1=[REDACTED]')
    .replace(/\b(?:AKID|TMP)[A-Za-z0-9_/-]{8,}\b/gi, '[REDACTED_CREDENTIAL]')
    .replace(/\b[A-Za-z0-9+/=_-]{32,}\b/g, '[REDACTED_VALUE]')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180)
  return sanitized || 'NO_COS_ERROR_MESSAGE'
}

const SAFE_HTTP_MESSAGES = new Set(['Forbidden', 'Bad Request', 'Unauthorized', 'Not Found', 'Request Timeout', 'Conflict', 'Too Many Requests', 'Internal Server Error', 'Bad Gateway', 'Service Unavailable', 'Gateway Timeout'])

// COS SDK errors may include an XML Error object, transport details, and response headers.
// Emit only bounded protocol fields; never serialize a raw error, URL, authorization header, or credential.
export function safeCosError(error, { requestType = 'Unknown', method = 'UNKNOWN' } = {}) {
  const responseError = error?.error && typeof error.error === 'object' ? error.error : null
  const rawCosCode = String(responseError?.Code || responseError?.code || '')
  const sdkCode = String(error?.code || '')
  const cosCodeCandidate = rawCosCode || (SAFE_COS_CODES.has(sdkCode) ? sdkCode : '')
  const cosCode = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(cosCodeCandidate) ? cosCodeCandidate : 'UNKNOWN'
  const safeSdkCode = SAFE_TRANSPORT_CODES.has(sdkCode) ? sdkCode
    : /^\d{3}$/.test(sdkCode) ? `HTTP_${sdkCode}`
      : 'UNKNOWN'
  const statusValue = Number(error?.statusCode ?? error?.status)
  const status = Number.isInteger(statusValue) && statusValue >= 100 && statusValue <= 599 ? statusValue : 0
  const requestId = getHeaderValue(error?.headers, 'x-cos-request-id')
    || String(responseError?.RequestId || error?.RequestId || '')
  const safeRequestId = /^[A-Za-z0-9+/=_-]{24,128}$/.test(requestId) && !/^(AKID|TMP)/i.test(requestId) ? requestId : 'UNKNOWN'
  const safeRequestType = /^[A-Za-z][A-Za-z0-9_-]{0,47}$/.test(requestType) ? requestType : 'UNKNOWN'
  const safeMethod = ['GET', 'HEAD', 'PUT', 'POST', 'DELETE'].includes(String(method).toUpperCase()) ? String(method).toUpperCase() : 'UNKNOWN'
  const responseMessage = typeof responseError?.Message === 'string'
    ? sanitizeCosResponseMessage(responseError.Message)
    : SAFE_HTTP_MESSAGES.has(String(error?.message || '')) ? String(error.message)
      : 'NO_COS_ERROR_XML'
  return `request_type=${safeRequestType} method=${safeMethod} http_status=${status || 'UNKNOWN'} cos_code=${cosCode} sdk_code=${safeSdkCode} request_id=${safeRequestId} response=${responseMessage}`
}

function getCosErrorCode(error) {
  return String(error?.error?.Code || error?.error?.code || error?.code || '')
}

function safeInternalErrorCode(error) {
  const message = String(error?.message || '')
  return SAFE_INTERNAL_ERROR_CODES.has(message) ? message : 'UNKNOWN'
}

function isRetryablePartError(error) {
  const code = getCosErrorCode(error)
  if (code === 'UserNetworkTooSlow') return false
  if (SAFE_TRANSPORT_CODES.has(code) || RETRYABLE_COS_CODES.has(code)) return true
  const status = Number(error?.statusCode ?? error?.status)
  if (status >= 400 && status < 500) return false
  return status >= 500 && status <= 599
}

// COS SDK 3.0.0's low-level multipartUpload only registers an abort listener
// when TaskId is provided. It does not expose a public per-request handle for
// this API, so this scoped registry uses the internal event implemented by the
// pinned SDK v3.0.0 to abort only the active part request. The HTTP integration
// test guards this behavior against the exact locked SDK.
function registerCancelablePartRequest(cos) {
  if (typeof cos?._isRunningTask !== 'function' || typeof cos?.emit !== 'function') return undefined
  let registry = COS_TASK_REGISTRIES.get(cos)
  if (!registry) {
    const active = new Set()
    const originalIsRunningTask = cos._isRunningTask.bind(cos)
    const patchedIsRunningTask = (taskId) => active.has(taskId) || originalIsRunningTask(taskId)
    cos._isRunningTask = patchedIsRunningTask
    if (cos._isRunningTask !== patchedIsRunningTask) throw new Error('COS_MULTIPART_CANCELLATION_UNAVAILABLE')
    registry = { active }
    COS_TASK_REGISTRIES.set(cos, registry)
  }
  const taskId = `rc13-part-${randomUUID()}`
  registry.active.add(taskId)
  let cancelled = false
  let rejectCancelled
  const cancelledRequest = new Promise((_, reject) => { rejectCancelled = reject })
  return {
    taskId,
    cancelledRequest,
    cancel() {
      if (cancelled || !registry.active.has(taskId)) return false
      cancelled = true
      cos.emit('inner-kill-task', { TaskId: taskId, toState: 'canceled' })
      rejectCancelled(new Error('COS_PART_REQUEST_CANCELLED'))
      return true
    },
    release() { registry.active.delete(taskId) },
  }
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
  let previousBytes = 0
  let previousTime = started
  let retries = 0
  let terminalPartError
  const activePartRequests = new Map()
  const cancelActivePartRequests = (reason) => {
    let cancelled = 0
    for (const [partNumber, request] of activePartRequests) {
      if (request.task?.cancel()) {
        cancelled++
        log(`COS_PART_CANCEL_REQUESTED part=${partNumber} reason=${reason}`)
      }
    }
    return cancelled
  }
  const abortOwned = async () => {
    if (abortPromise) return abortPromise
    abortPromise = cos.multipartAbort({ ...base, UploadId: uploadId }).then(
      () => log('COS_MULTIPART_ABORT=COMPLETE'),
      (error) => {
        const code = String(error?.code || error?.error?.Code || '')
        if (code === 'NoSuchUpload') log('COS_MULTIPART_ABORT=ALREADY_ABSENT')
        else log(`COS_MULTIPART_ABORT=FAILED ${safeCosError(error)}`)
      },
    )
    return abortPromise
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
    const bodyStreamEmitted = new Array(count).fill(0)
    let next = 0
    const inFlight = new Array(count).fill(0)
    timer = clock.setInterval(() => {
      const elapsed = Math.max(1, clock.now() - started)
      const sdkCallbackInFlightBytes = inFlight.reduce((sum, value) => sum + value, 0)
      const bodyStreamBytes = bodyStreamEmitted.reduce((sum, value) => sum + value, 0)
      const current = Math.min(size, uploaded + sdkCallbackInFlightBytes)
      const recentBps = Math.max(0, Math.floor((current - previousBytes) * 1000 / Math.max(1, clock.now() - previousTime)))
      log(`COS_UPLOAD_PROGRESS progress_source=SDK_SOCKET_CALLBACK reported_bytes=${current} sdk_callback_inflight_bytes=${sdkCallbackInFlightBytes} body_stream_emitted_bytes=${bodyStreamBytes} cos_acknowledged_part_bytes=${uploaded} total=${size} remaining_bytes=${size - current} percent=${Math.floor(current * 100 / size)} elapsed_ms=${elapsed} average_bps=${Math.floor(current * 1000 / elapsed)} recent_bps=${recentBps} completed_parts=${parts.filter(Boolean).length} total_parts=${count} retries=${retries}${clock.now() - lastProgress >= STALL_WARNING_MS ? ' STALLED=YES' : ''}`)
      previousBytes = current
      previousTime = clock.now()
      if (!failed && clock.now() - lastProgress >= STALL_ABORT_MS) {
        failed = new Error('COS_UPLOAD_STALLED')
        // Terminate active SDK HTTP requests first. Abort the owned MPU only
        // after all request callbacks settle, so late parts cannot race cleanup.
        log(`COS_UPLOAD_STALLED_CANCEL=START active_parts=${activePartRequests.size}`)
        cancelActivePartRequests('stall')
      }
    }, 5000)
    const worker = async () => {
      try {
        while (!failed) {
          const index = next++
          if (index >= count) return
          const length = Math.min(PART_SIZE, size - index * PART_SIZE)
          const buffer = Buffer.alloc(length)
          const { bytesRead } = await file.read(buffer, 0, length, index * PART_SIZE)
          if (bytesRead !== length) throw new Error('COS_SOURCE_READ_INCOMPLETE')
          let partCompleted = false
          for (let attempt = 1; attempt <= MAX_PART_ATTEMPTS && !failed; attempt++) {
            const body = Readable.from(splitBuffer(buffer), { objectMode: false })
            body.on('data', (chunk) => { bodyStreamEmitted[index] += chunk.length })
            const task = registerCancelablePartRequest(cos)
            if (cos?.options && typeof cos?.multipartUpload === 'function' && !task) throw new Error('COS_MULTIPART_CANCELLATION_UNAVAILABLE')
            activePartRequests.set(index + 1, { task, body })
            try {
              const partRequest = cos.multipartUpload({ ...base, UploadId: uploadId, PartNumber: index + 1, Body: body, ContentLength: length, Headers: { 'Content-Length': String(length) }, TaskId: task?.taskId, onProgress: ({ loaded }) => {
                const callbackBytes = Number.isFinite(loaded) ? Math.max(0, Math.min(length, loaded)) : 0
                if (callbackBytes > inFlight[index]) lastProgress = clock.now()
                inFlight[index] = callbackBytes
              } })
              const result = task ? await Promise.race([partRequest, task.cancelledRequest]) : await partRequest
              if (!result?.ETag) throw new Error('COS_PART_ETAG_MISSING')
              parts[index] = { PartNumber: index + 1, ETag: result.ETag }
              inFlight[index] = 0
              uploaded += length
              lastProgress = clock.now()
              partCompleted = true
              break
            } catch (error) {
              inFlight[index] = 0
              const retryable = isRetryablePartError(error)
              const cosCode = getCosErrorCode(error)
              log(`COS_PART_FAILURE part=${index + 1} attempt=${attempt} retry_class=${retryable ? 'RETRYABLE' : 'NON_RETRYABLE'} cos_code=${/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(cosCode) ? cosCode : 'UNKNOWN'} ${safeCosError(error)}`)
              if (failed) return
              if (!retryable) {
                failed = error
                terminalPartError = error
                cancelActivePartRequests(cosCode || 'terminal-part-error')
                return
              }
              if (attempt < MAX_PART_ATTEMPTS) retries++
              else {
                failed = error
                cancelActivePartRequests('retry-limit')
              }
            } finally {
              activePartRequests.delete(index + 1)
              task?.release()
              body.destroy()
            }
          }
          if (failed) return
          if (!partCompleted) throw new Error('COS_PART_ATTEMPTS_EXHAUSTED')
        }
      } catch (error) {
        if (!failed) failed = error
        cancelActivePartRequests('worker-failure')
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
    log(`COS_MULTIPART_FAILURE reason=${safeInternalErrorCode(error)} ${safeCosError(error)} complete_attempted=${completeAttempted}`)
    const statusCode = Number(error?.statusCode)
    const conflict = (completeAttempted || (initAttempted && !uploadId)) && (statusCode === 409 || error?.code === 'FileAlreadyExists' || error?.error?.Code === 'FileAlreadyExists')
    const completeRejected = completeAttempted && (error?.cosResponseError === true || (statusCode >= 400 && statusCode < 500))
    if (uploadId && !completed && (!completeAttempted || conflict || completeRejected)) await abortOwned()
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
    if (error?.message === 'COS_UPLOAD_STALLED') throw new Error('COS_MULTIPART_UPLOAD_STALLED')
    if (terminalPartError) {
      const code = getCosErrorCode(terminalPartError)
      const safeCode = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(code) ? `_${code}` : ''
      throw new Error(`COS_MULTIPART_PART_NON_RETRYABLE${safeCode}`)
    }
    if (error?.message === 'TENCENT_STS_CREDENTIALS_INSUFFICIENT_LIFETIME'
      || error?.message === 'TENCENT_STS_CREDENTIALS_EXPIRED_BEFORE_COMPLETE') throw error
    throw new Error('COS_MULTIPART_UPLOAD_FAILED')
  } finally {
    if (timer) clock.clearInterval(timer)
    if (file) await file.close()
  }
}
