export const FRIEND_REQUEST_REASON_MAX_LENGTH = 100

export type FriendRequestReasonErrorCode =
  | 'FRIEND_REQUEST_REASON_REQUIRED'
  | 'FRIEND_REQUEST_REASON_TOO_SHORT'
  | 'FRIEND_REQUEST_REASON_TOO_LONG'

export type FriendRequestReasonValidation =
  | { ok: true; reason: string }
  | { ok: false; code: FriendRequestReasonErrorCode; message: string }

/**
 * Friend-request messages are stored as plain text.  Keep the same small
 * validation function on both sides of the API so an empty request cannot be
 * created by bypassing the client dialog.
 */
export function validateFriendRequestReason(value: unknown): FriendRequestReasonValidation {
  if (typeof value !== 'string') {
    return { ok: false, code: 'FRIEND_REQUEST_REASON_REQUIRED', message: '请输入申请理由' }
  }

  const reason = value.trim()
  if (!reason) {
    return { ok: false, code: 'FRIEND_REQUEST_REASON_REQUIRED', message: '请输入申请理由' }
  }
  if (reason.length < 2) {
    return { ok: false, code: 'FRIEND_REQUEST_REASON_TOO_SHORT', message: '申请理由至少填写 2 个字' }
  }
  if (reason.length > FRIEND_REQUEST_REASON_MAX_LENGTH) {
    return {
      ok: false,
      code: 'FRIEND_REQUEST_REASON_TOO_LONG',
      message: `申请理由最多 ${FRIEND_REQUEST_REASON_MAX_LENGTH} 个字`,
    }
  }

  return { ok: true, reason }
}
