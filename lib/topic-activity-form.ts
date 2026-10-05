export const TOPIC_ACTIVITY_FORM_VERSION = 1
export const TOPIC_ACTIVITY_FORM_MAX_FIELDS = 30
export const TOPIC_ACTIVITY_FORM_MAX_IMAGES = 9
export const TOPIC_ACTIVITY_REPLY_MAX_IMAGES = 9

export const TOPIC_ACTIVITY_FORM_FIELD_TYPES = ['TEXT', 'TEXTAREA', 'SINGLE_SELECT', 'MULTI_SELECT', 'IMAGE'] as const
export type TopicActivityFormFieldType = (typeof TOPIC_ACTIVITY_FORM_FIELD_TYPES)[number]

export type TopicActivityFormOption = Readonly<{ value: string; label: string }>
export type TopicActivityFormField = Readonly<{
  id: string
  label: string
  type: TopicActivityFormFieldType
  required: boolean
  placeholder: string | null
  options: TopicActivityFormOption[]
  multiple: boolean
  maxImages: number
}>
export type TopicActivityFormSchema = Readonly<{
  version: typeof TOPIC_ACTIVITY_FORM_VERSION
  fields: TopicActivityFormField[]
}>

export type TopicActivityRawAnswer = string | string[]
export type TopicActivityImageSnapshot = Readonly<{
  assetId: string
  storageKey: string
  mimeType: string
  width: number
  height: number
  size: number
}>
export type TopicActivityAnswerValue = string | string[] | TopicActivityImageSnapshot[]
export type TopicActivityAnswerSnapshot = Readonly<{
  fieldId: string
  label: string
  type: TopicActivityFormFieldType
  value: TopicActivityAnswerValue
}>

type Normalized<T> = { valid: true; value: T } | { valid: false; message: string }

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function text(value: unknown, max: number) {
  if (typeof value !== 'string') return ''
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max)
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value)
}

export function normalizeTopicActivityFormSchema(value: unknown, allowImages: boolean): Normalized<TopicActivityFormSchema> {
  const root = record(value)
  const rawFields = Array.isArray(value) ? value : root?.fields
  if (!Array.isArray(rawFields)) return { valid: false, message: '参与表单字段格式不正确' }
  if (rawFields.length > TOPIC_ACTIVITY_FORM_MAX_FIELDS) return { valid: false, message: `参与表单最多设置 ${TOPIC_ACTIVITY_FORM_MAX_FIELDS} 个字段` }

  const ids = new Set<string>()
  const fields: TopicActivityFormField[] = []
  for (let index = 0; index < rawFields.length; index += 1) {
    const raw = record(rawFields[index])
    if (!raw) return { valid: false, message: `第 ${index + 1} 个表单字段无效` }
    const id = validId(raw.id) ? raw.id : ''
    const label = text(raw.label ?? raw.title, 160)
    const type = typeof raw.type === 'string' && TOPIC_ACTIVITY_FORM_FIELD_TYPES.includes(raw.type as TopicActivityFormFieldType)
      ? raw.type as TopicActivityFormFieldType
      : null
    if (!id || ids.has(id)) return { valid: false, message: `第 ${index + 1} 个字段标识无效或重复` }
    if (!label) return { valid: false, message: `第 ${index + 1} 个字段标题不能为空` }
    if (!type) return { valid: false, message: `第 ${index + 1} 个字段类型不支持` }
    if (type === 'IMAGE' && !allowImages) return { valid: false, message: '请先开启表单图片附件' }
    ids.add(id)

    const rawOptions = Array.isArray(raw.options) ? raw.options : []
    const options: TopicActivityFormOption[] = []
    if (type === 'SINGLE_SELECT' || type === 'MULTI_SELECT') {
      if (rawOptions.length < 1 || rawOptions.length > 30) return { valid: false, message: `${label} 至少需要一个选项，最多 30 个` }
      const values = new Set<string>()
      for (const rawOptionValue of rawOptions) {
        const rawOption = record(rawOptionValue)
        const optionLabel = text(rawOption?.label, 120)
        const optionValue = text(rawOption?.value, 80)
        if (!optionLabel || !optionValue || values.has(optionValue)) return { valid: false, message: `${label} 包含无效或重复选项` }
        values.add(optionValue)
        options.push({ value: optionValue, label: optionLabel })
      }
    }

    const multiple = type === 'IMAGE' && raw.multiple === true
    const maxImages = type === 'IMAGE'
      ? Math.max(1, Math.min(multiple ? TOPIC_ACTIVITY_FORM_MAX_IMAGES : 1, Number.isFinite(Number(raw.maxImages)) ? Math.trunc(Number(raw.maxImages)) : 1))
      : 0
    fields.push({
      id,
      label,
      type,
      required: raw.required === true,
      placeholder: text(raw.placeholder, 200) || null,
      options,
      multiple,
      maxImages,
    })
  }

  return { valid: true, value: { version: TOPIC_ACTIVITY_FORM_VERSION, fields } }
}

export function validateTopicActivityFormAnswers(
  schema: TopicActivityFormSchema,
  rawAnswers: unknown,
): Normalized<{ answers: Array<Omit<TopicActivityAnswerSnapshot, 'value'> & { value: string | string[] | { assetIds: string[] } }>; assetIds: string[] }> {
  const raw = record(rawAnswers)
  if (!raw) return { valid: false, message: '请填写参与表单' }
  const known = new Set(schema.fields.map((field) => field.id))
  if (Object.keys(raw).some((key) => !known.has(key))) return { valid: false, message: '表单包含无效字段' }

  const answers: Array<Omit<TopicActivityAnswerSnapshot, 'value'> & { value: string | string[] | { assetIds: string[] } }> = []
  const assetIds: string[] = []
  for (const field of schema.fields) {
    const input = raw[field.id]
    if (field.type === 'IMAGE') {
      const ids = Array.isArray(input)
        ? input.filter((item): item is string => typeof item === 'string')
        : typeof input === 'string' && input ? [input] : []
      if (ids.length !== (Array.isArray(input) ? input.length : (input ? 1 : 0)) || ids.some((id) => !validId(id))) {
        return { valid: false, message: `${field.label} 图片信息无效` }
      }
      if (new Set(ids).size !== ids.length) return { valid: false, message: `${field.label} 图片不能重复` }
      if (ids.length > field.maxImages) return { valid: false, message: `${field.label} 最多上传 ${field.maxImages} 张图片` }
      if (field.required && !ids.length) return { valid: false, message: `请完成必填项：${field.label}` }
      assetIds.push(...ids)
      answers.push({ fieldId: field.id, label: field.label, type: field.type, value: { assetIds: ids } })
      continue
    }

    if (field.type === 'MULTI_SELECT') {
      const values = Array.isArray(input) ? input.filter((item): item is string => typeof item === 'string') : []
      if (Array.isArray(input) && values.length !== input.length) return { valid: false, message: `${field.label} 选项无效` }
      const allowed = new Set(field.options.map((option) => option.value))
      if (values.some((item) => !allowed.has(item)) || new Set(values).size !== values.length) return { valid: false, message: `${field.label} 选项无效` }
      if (field.required && !values.length) return { valid: false, message: `请完成必填项：${field.label}` }
      answers.push({ fieldId: field.id, label: field.label, type: field.type, value: values })
      continue
    }

    const answer = text(input, field.type === 'TEXTAREA' ? 8_000 : 500)
    if (field.required && !answer) return { valid: false, message: `请完成必填项：${field.label}` }
    if (field.type === 'SINGLE_SELECT' && answer && !field.options.some((option) => option.value === answer)) return { valid: false, message: `${field.label} 选项无效` }
    answers.push({ fieldId: field.id, label: field.label, type: field.type, value: answer })
  }

  if (new Set(assetIds).size !== assetIds.length) return { valid: false, message: '同一张图片不能重复用于多个字段' }
  return { valid: true, value: { answers, assetIds } }
}
