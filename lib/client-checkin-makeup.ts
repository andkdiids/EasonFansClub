'use client'

import { redirectToLoginAfterConfirmedSessionInvalid } from '@/lib/client-auth'

export const CHECK_IN_MAKEUP_REQUEST_TIMEOUT_MS = 15_000

type ErrorBody = { message?: unknown; code?: unknown }

export class CheckInMakeupClientError extends Error {
  constructor(message: string, public readonly code = 'MAKEUP_REQUEST_FAILED', public readonly status?: number) {
    super(message)
    this.name = 'CheckInMakeupClientError'
  }
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError'
}

function readErrorBody(body: unknown) {
  if (!body || typeof body !== 'object') return { message: '', code: '' }
  const candidate = body as ErrorBody
  return {
    message: typeof candidate.message === 'string' ? candidate.message.trim() : '',
    code: typeof candidate.code === 'string' ? candidate.code.slice(0, 80) : '',
  }
}

function statusFallback(status: number, fallback: string) {
  if (status === 403) return '请求来源校验失败，请刷新页面后重试。'
  if (status === 404) return '补签日期或挑战不存在，请刷新后重试。'
  if (status === 429) return '补签请求过于频繁，请稍后再试。'
  if (status >= 500) return '补签暂时失败，请稍后重试。'
  return fallback
}

/**
 * All makeup mutations use one bounded request path. A failed response is
 * converted into a recoverable client error instead of leaving a modal busy.
 */
export async function fetchCheckInMakeupJson<T>(url: string, init: RequestInit, fallbackMessage: string) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), CHECK_IN_MAKEUP_REQUEST_TIMEOUT_MS)
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')

  try {
    let response: Response
    try {
      response = await fetch(url, {
        ...init,
        credentials: init.credentials || 'same-origin',
        headers,
        signal: controller.signal,
      })
    } catch (error) {
      if (isAbortError(error)) {
        throw new CheckInMakeupClientError('补签请求超时，请稍后重试。', 'MAKEUP_REQUEST_TIMEOUT')
      }
      throw new CheckInMakeupClientError('补签请求失败，请检查网络后重试。', 'MAKEUP_NETWORK_ERROR')
    }

    const body = await response.json().catch(() => null) as unknown
    if (!response.ok) {
      if (response.status === 401) {
        const confirmedInvalid = await redirectToLoginAfterConfirmedSessionInvalid(response, '/checkin')
        throw new CheckInMakeupClientError(
          confirmedInvalid ? '登录状态已失效，请重新登录。' : '登录状态暂时无法确认，请稍后重试。',
          confirmedInvalid ? 'SESSION_INVALID' : 'AUTH_SESSION_UNCERTAIN',
          response.status,
        )
      }

      const errorBody = readErrorBody(body)
      throw new CheckInMakeupClientError(
        errorBody.message || statusFallback(response.status, fallbackMessage),
        errorBody.code || 'MAKEUP_REQUEST_FAILED',
        response.status,
      )
    }

    return body as T
  } catch (error) {
    if (error instanceof CheckInMakeupClientError) throw error
    if (isAbortError(error)) throw new CheckInMakeupClientError('补签请求超时，请稍后重试。', 'MAKEUP_REQUEST_TIMEOUT')
    throw new CheckInMakeupClientError(fallbackMessage, 'MAKEUP_REQUEST_FAILED')
  } finally {
    clearTimeout(timeoutId)
  }
}
