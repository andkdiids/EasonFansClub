import { getCountries, getCountryCallingCode, parsePhoneNumberFromString } from 'libphonenumber-js/min'
import type { CountryCode, PhoneNumber } from 'libphonenumber-js'

export type PhoneCountryCode = CountryCode

export const DEFAULT_PHONE_COUNTRY: PhoneCountryCode = 'CN'

type CountryName = { zh: string; en: string }

const countryNameOverrides: Partial<Record<PhoneCountryCode, CountryName>> = {
  CN: { zh: '中国大陆', en: 'China mainland' },
  HK: { zh: '中国香港', en: 'Hong Kong' },
  MO: { zh: '中国澳门', en: 'Macao' },
  TW: { zh: '中国台湾', en: 'Taiwan' },
  KR: { zh: '韩国', en: 'South Korea' },
  GB: { zh: '英国', en: 'United Kingdom' },
  US: { zh: '美国', en: 'United States' },
}

const popularCountryCodes: PhoneCountryCode[] = ['CN', 'HK', 'MO', 'TW', 'US', 'GB', 'JP', 'SG', 'KR', 'CA', 'AU']

function getIntlCountryName(locale: string, country: PhoneCountryCode) {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(country) || country
  } catch {
    return country
  }
}

function getCountryName(country: PhoneCountryCode): CountryName {
  return countryNameOverrides[country] || {
    zh: getIntlCountryName('zh-CN', country),
    en: getIntlCountryName('en', country),
  }
}

export type PhoneCountry = {
  code: PhoneCountryCode
  dialCode: string
  nameZh: string
  nameEn: string
  searchText: string
}

function buildPhoneCountries() {
  const priority = new Map(popularCountryCodes.map((country, index) => [country, index]))
  return getCountries()
    .map((code) => {
      const name = getCountryName(code)
      const dialCode = getCountryCallingCode(code)
      return {
        code,
        dialCode,
        nameZh: name.zh,
        nameEn: name.en,
        searchText: `${name.zh} ${name.en} ${code} ${dialCode} +${dialCode}`.toLocaleLowerCase(),
      }
    })
    .sort((left, right) => {
      const leftPriority = priority.get(left.code) ?? Number.MAX_SAFE_INTEGER
      const rightPriority = priority.get(right.code) ?? Number.MAX_SAFE_INTEGER
      if (leftPriority !== rightPriority) return leftPriority - rightPriority
      return left.nameZh.localeCompare(right.nameZh, 'zh-CN') || left.code.localeCompare(right.code)
    })
}

export const PHONE_COUNTRIES: PhoneCountry[] = buildPhoneCountries()

const phoneCountryCodes = new Set<PhoneCountryCode>(PHONE_COUNTRIES.map((country) => country.code))

export function isSupportedPhoneCountry(value: unknown): value is PhoneCountryCode {
  return typeof value === 'string' && phoneCountryCodes.has(value as PhoneCountryCode)
}

export function getPhoneCountry(country: PhoneCountryCode = DEFAULT_PHONE_COUNTRY) {
  return PHONE_COUNTRIES.find((item) => item.code === country) || PHONE_COUNTRIES[0]
}

export function getPhoneCountryName(country: PhoneCountryCode = DEFAULT_PHONE_COUNTRY) {
  return getPhoneCountry(country).nameZh
}

export function getPhoneCountryCallingCode(country: PhoneCountryCode = DEFAULT_PHONE_COUNTRY) {
  return `+${getPhoneCountry(country).dialCode}`
}

export function filterPhoneCountries(query: string) {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return PHONE_COUNTRIES
  const withoutLeadingPlus = normalized.replace(/^\+/, '')
  return PHONE_COUNTRIES.filter((country) => country.searchText.includes(normalized) || country.searchText.includes(withoutLeadingPlus))
}

function normalizePhoneText(value: string) {
  const normalized = value.normalize('NFKC').trim()
  return /^00\d/.test(normalized) ? `+${normalized.slice(2)}` : normalized
}

export function parseInternationalPhoneNumber(value: unknown, country: PhoneCountryCode = DEFAULT_PHONE_COUNTRY): PhoneNumber | null {
  if (typeof value !== 'string') return null
  const normalized = normalizePhoneText(value)
  if (!normalized) return null
  const fallbackCountry = isSupportedPhoneCountry(country) ? country : DEFAULT_PHONE_COUNTRY
  try {
    return (normalized.startsWith('+')
      ? parsePhoneNumberFromString(normalized)
      : parsePhoneNumberFromString(normalized, fallbackCountry)) ?? null
  } catch {
    return null
  }
}

export type NormalizedPhoneNumber = {
  country: PhoneCountryCode
  dialCode: string
  nationalNumber: string
  e164: string
}

export function normalizePhoneNumber(value: unknown, country: PhoneCountryCode = DEFAULT_PHONE_COUNTRY): NormalizedPhoneNumber | null {
  const parsed = parseInternationalPhoneNumber(value, country)
  if (!parsed || !parsed.isPossible() || !parsed.isValid()) return null
  const resolvedCountry = parsed.country && isSupportedPhoneCountry(parsed.country) ? parsed.country : country
  return {
    country: resolvedCountry,
    dialCode: getPhoneCountryCallingCode(resolvedCountry),
    nationalNumber: parsed.nationalNumber,
    e164: parsed.number,
  }
}

export function getPhoneLookupVariants(value: unknown, country: PhoneCountryCode = DEFAULT_PHONE_COUNTRY) {
  const raw = typeof value === 'string' ? value.trim().replace(/\s+/g, '') : ''
  const normalized = normalizePhoneNumber(value, country)
  if (!normalized) return raw ? [raw] : []
  const variants = [normalized.e164]
  // Existing mainland accounts may still contain the old national-only value.
  // No equivalent fallback is generated for overseas numbers because it would
  // be ambiguous across countries sharing a calling code.
  if (normalized.country === 'CN') variants.push(normalized.nationalNumber)
  return [...new Set(variants)]
}

export function getPhoneValidationMessage(country: PhoneCountryCode = DEFAULT_PHONE_COUNTRY) {
  return `请输入有效的${getPhoneCountryName(country)}手机号码`
}

export function getPhoneInputParts(value: unknown, fallbackCountry: PhoneCountryCode = DEFAULT_PHONE_COUNTRY) {
  const raw = typeof value === 'string' ? value.trim() : ''
  const normalized = normalizePhoneNumber(raw, fallbackCountry)
  if (!normalized) return { country: fallbackCountry, value: raw }
  return { country: normalized.country, value: normalized.nationalNumber }
}

export function isLikelyPhoneInput(value: string) {
  return /^\+?[\d\s().\-/]{7,}$/.test(value.trim()) && (value.match(/\d/g) || []).length >= 7
}
