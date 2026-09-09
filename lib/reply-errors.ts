type ReplyErrorBody = {
  message?: unknown
  errors?: { content?: unknown }
}

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null
}

/** Convert a reply API failure into a safe, actionable client message. */
export function getReplyErrorMessage(status: number, body: unknown) {
  if (status === 401) return '登录状态已失效，请重新登录'

  const candidate = body && typeof body === 'object' ? body as ReplyErrorBody : {}
  const message = text(candidate.message) || text(candidate.errors?.content)
  if (message) return message

  if (status === 404) return '该帖子已不存在，请刷新后重试'
  if (status === 409) return '该评论已不存在或正在处理中，请刷新后重试'
  if (status === 429) return '操作太频繁，请稍后再试'
  if (status >= 500) return '回复失败，请稍后重试'
  return '回复提交失败，请重试'
}
