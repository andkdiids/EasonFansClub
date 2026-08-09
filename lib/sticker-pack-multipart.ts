import busboy from 'busboy'
import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { STICKER_MAX_FILE_SIZE } from '@/lib/sticker-upload'

const MAX_STICKER_FILES = 60
const MAX_FILE_PARTS = MAX_STICKER_FILES + 1
const MAX_FORM_FIELDS = MAX_STICKER_FILES + 10
const MAX_FORM_PARTS = MAX_FILE_PARTS + MAX_FORM_FIELDS + 5

export type StickerMultipartErrorCode =
  | 'INVALID_MULTIPART'
  | 'FILE_TOO_LARGE'
  | 'TOO_MANY_FILES'
  | 'PARSER_ERROR'

export class StickerMultipartError extends Error {
  constructor(
    public readonly code: StickerMultipartErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message)
    this.name = 'StickerMultipartError'
    this.cause = cause
  }
}

export type ParsedStickerMultipartFile = {
  fieldName: string
  filename: string
  mimeType: string
  path: string
  size: number
  ordinal: number
}

export type ParsedStickerMultipartRequest = {
  fields: Map<string, string[]>
  files: ParsedStickerMultipartFile[]
  tempDirectory: string
}

/**
 * Parse an upload-pack request without the built-in Web Request form parser.
 * File parts are streamed to disk and are read by the route one at a time
 * after parsing has finished, so the multipart body is never buffered in full.
 */
export async function parseStickerPackMultipart(request: Request): Promise<ParsedStickerMultipartRequest> {
  const contentType = request.headers.get('content-type') || ''
  if (!/^multipart\/form-data\s*;/i.test(contentType)) {
    throw new StickerMultipartError('INVALID_MULTIPART', '上传请求格式无效')
  }
  if (!request.body) {
    throw new StickerMultipartError('INVALID_MULTIPART', '上传请求内容为空')
  }

  const tempDirectory = await mkdtemp(join(tmpdir(), 'eason-sticker-pack-'))
  const fields = new Map<string, string[]>()
  const files: ParsedStickerMultipartFile[] = []
  const pendingFileWrites: Array<Promise<void>> = []
  let parserError: unknown = null

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false

      const rejectOnce = (error: unknown) => {
        if (settled) return
        settled = true
        reject(error)
      }

      let parser: ReturnType<typeof busboy>
      try {
        parser = busboy({
          headers: { 'content-type': contentType },
          limits: {
            fileSize: STICKER_MAX_FILE_SIZE,
            files: MAX_FILE_PARTS,
            fields: MAX_FORM_FIELDS,
            parts: MAX_FORM_PARTS,
            fieldNameSize: 128,
            fieldSize: 4096,
          },
        })
      } catch {
        rejectOnce(new StickerMultipartError('INVALID_MULTIPART', '上传请求格式无效'))
        return
      }

      parser.on('field', (fieldName, value, info) => {
        if (info.valueTruncated) {
          parserError = new StickerMultipartError('PARSER_ERROR', '上传参数过长')
          return
        }
        const values = fields.get(fieldName) || []
        values.push(value)
        fields.set(fieldName, values)
      })

      parser.on('file', (fieldName, file, info) => {
        const ordinal = files.length + pendingFileWrites.length
        const tempPath = join(tempDirectory, `${ordinal}-${randomUUID()}.part`)
        let size = 0
        let fileSizeExceeded = false

        file.on('data', (chunk: Buffer) => {
          size += chunk.length
        })
        file.on('limit', () => {
          fileSizeExceeded = true
        })

        const writeTask = pipeline(file, createWriteStream(tempPath)).then(() => {
          if (fileSizeExceeded || file.truncated || size > STICKER_MAX_FILE_SIZE) {
            throw new StickerMultipartError('FILE_TOO_LARGE', '文件超过20MB限制')
          }
          files.push({
            fieldName,
            filename: info.filename || `sticker-${ordinal}`,
            mimeType: info.mimeType || 'application/octet-stream',
            path: tempPath,
            size,
            ordinal,
          })
        })
        pendingFileWrites.push(writeTask)
      })

      parser.on('filesLimit', () => {
        parserError = new StickerMultipartError('TOO_MANY_FILES', '表情文件数量超过限制')
      })
      parser.on('fieldsLimit', () => {
        parserError = new StickerMultipartError('PARSER_ERROR', '上传参数数量超过限制')
      })
      parser.on('partsLimit', () => {
        parserError = new StickerMultipartError('PARSER_ERROR', '上传内容数量超过限制')
      })
      parser.on('error', (error) => {
        parserError = new StickerMultipartError('PARSER_ERROR', '上传请求格式无效', error)
      })
      parser.on('close', () => {
        void Promise.all(pendingFileWrites)
          .then(() => {
            if (parserError) {
              rejectOnce(parserError)
              return
            }
            if (!settled) {
              settled = true
              resolve()
            }
          })
          .catch(rejectOnce)
      })

      const body = Readable.fromWeb(
        request.body as unknown as import('node:stream/web').ReadableStream<Uint8Array>,
      )
      body.on('error', (error) => {
        parserError = error
        parser.destroy(error instanceof Error ? error : new Error('multipart body stream failed'))
      })
      body.pipe(parser)
    })

    return {
      fields,
      files: files.sort((left, right) => left.ordinal - right.ordinal),
      tempDirectory,
    }
  } catch (error) {
    await rm(tempDirectory, { recursive: true, force: true })
    if (error instanceof StickerMultipartError) throw error
    throw new StickerMultipartError('PARSER_ERROR', '上传请求格式无效')
  }
}

export async function removeStickerMultipartTempDirectory(tempDirectory: string) {
  await rm(tempDirectory, { recursive: true, force: true })
}
