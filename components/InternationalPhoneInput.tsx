'use client'

import { useEffect, useId, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import {
  DEFAULT_PHONE_COUNTRY,
  filterPhoneCountries,
  getPhoneCountry,
  normalizePhoneNumber,
  type PhoneCountryCode,
} from '@/lib/phone-number'

type InternationalPhoneInputProps = {
  value: string
  country?: PhoneCountryCode
  onChange: (value: string) => void
  onCountryChange: (country: PhoneCountryCode) => void
  id?: string
  name?: string
  required?: boolean
  disabled?: boolean
  autoComplete?: string
  placeholder?: string
  inputClassName?: string
  countryInputClassName?: string
  'data-register-field'?: string
}

export function InternationalPhoneInput({
  value,
  country = DEFAULT_PHONE_COUNTRY,
  onChange,
  onCountryChange,
  id,
  name = 'phone',
  required = false,
  disabled = false,
  autoComplete = 'tel-national',
  placeholder = '请输入本地手机号码',
  inputClassName = '',
  countryInputClassName = '',
  'data-register-field': dataRegisterField,
}: Readonly<InternationalPhoneInputProps>) {
  const rootRef = useRef<HTMLDivElement>(null)
  const optionRefs = useRef(new Map<PhoneCountryCode, HTMLButtonElement>())
  const generatedId = useId()
  const listId = `phone-country-list-${generatedId.replace(/:/g, '')}`
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const selectedCountry = getPhoneCountry(country)
  const filteredCountries = useMemo(() => filterPhoneCountries(query), [query])
  const safeActiveIndex = Math.min(activeIndex, Math.max(filteredCountries.length - 1, 0))

  useEffect(() => {
    function closeOnOutsidePointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer)
  }, [])

  useEffect(() => {
    if (!open || !filteredCountries[safeActiveIndex]) return
    optionRefs.current.get(filteredCountries[safeActiveIndex].code)?.scrollIntoView({ block: 'nearest' })
  }, [filteredCountries, open, safeActiveIndex])

  function openCountryList() {
    if (disabled) return
    setOpen(true)
    setQuery('')
    setActiveIndex(0)
  }

  function chooseCountry(nextCountry: PhoneCountryCode) {
    onCountryChange(nextCountry)
    setOpen(false)
    setQuery('')
    setActiveIndex(0)
  }

  function handleCountryKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActiveIndex((current) => open ? Math.min(current + 1, Math.max(filteredCountries.length - 1, 0)) : 0)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      setActiveIndex((current) => open ? Math.max(current - 1, 0) : 0)
    } else if (event.key === 'Enter') {
      const active = filteredCountries[safeActiveIndex]
      if (open && active) {
        event.preventDefault()
        chooseCountry(active.code)
      }
    } else if (event.key === 'Escape') {
      setOpen(false)
      setQuery('')
    } else if (event.key === 'Tab') {
      setOpen(false)
      setQuery('')
    }
  }

  function handlePhoneChange(nextValue: string) {
    const trimmed = nextValue.trim()
    const parsed = (trimmed.startsWith('+') || trimmed.startsWith('00'))
      ? normalizePhoneNumber(trimmed, country)
      : null
    if (parsed) {
      onCountryChange(parsed.country)
      onChange(parsed.nationalNumber)
      return
    }
    onChange(nextValue)
  }

  function handlePhonePaste(event: ClipboardEvent<HTMLInputElement>) {
    const pasted = event.clipboardData.getData('text')
    if (!pasted.trim().startsWith('+') && !pasted.trim().startsWith('00')) return
    const parsed = normalizePhoneNumber(pasted, country)
    if (!parsed) return
    event.preventDefault()
    onCountryChange(parsed.country)
    onChange(parsed.nationalNumber)
  }

  return (
    <div className="flex min-w-0 gap-2">
      <div ref={rootRef} className="relative w-[112px] shrink-0">
        <input
          type="text"
          value={open ? query : `+${selectedCountry.dialCode}`}
          onFocus={openCountryList}
          onClick={openCountryList}
          onChange={(event) => {
            setOpen(true)
            setQuery(event.target.value)
            setActiveIndex(0)
          }}
          onKeyDown={handleCountryKeyDown}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && filteredCountries[safeActiveIndex] ? `${listId}-${filteredCountries[safeActiveIndex].code}` : undefined}
          disabled={disabled}
          autoComplete="off"
          placeholder={`+${selectedCountry.dialCode}`}
          className={`mt-1 w-full min-w-0 rounded-lg border border-sky-100 bg-white px-2 py-2 pr-6 text-center text-sm outline-none focus:ring-4 focus:ring-brand-500/20 ${countryInputClassName}`}
          aria-label="国家或地区区号"
        />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400" aria-hidden="true">⌄</span>
        {open ? (
          <div
            id={listId}
            role="listbox"
            aria-label="国家或地区列表"
            className="phone-country-options absolute left-0 top-[calc(100%+4px)] z-40 w-[min(280px,calc(100vw-2rem))] rounded-lg border border-sky-100 bg-white p-1 shadow-xl"
          >
            {filteredCountries.length ? filteredCountries.map((item, index) => (
              <button
                key={item.code}
                id={`${listId}-${item.code}`}
                ref={(element) => {
                  if (element) optionRefs.current.set(item.code, element)
                  else optionRefs.current.delete(item.code)
                }}
                type="button"
                role="option"
                aria-selected={item.code === country}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => chooseCountry(item.code)}
                className={`flex min-h-10 w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-xs font-bold ${index === safeActiveIndex ? 'bg-sky-50 text-brand-700' : 'text-slate-700 hover:bg-slate-50'}`}
              >
                <span className="min-w-0 truncate">{item.nameZh}<span className="ml-1 text-[10px] font-medium text-slate-400">{item.nameEn}</span></span>
                <span className="shrink-0 font-black">+{item.dialCode}</span>
              </button>
            )) : <p className="px-3 py-4 text-center text-xs font-bold text-slate-400">没有匹配的地区或区号</p>}
          </div>
        ) : null}
      </div>
      <input
        id={id}
        name={name}
        value={value}
        onChange={(event) => handlePhoneChange(event.target.value)}
        onPaste={handlePhonePaste}
        type="tel"
        inputMode="tel"
        autoComplete={autoComplete}
        required={required}
        disabled={disabled}
        className={`mt-1 min-w-0 flex-1 rounded-lg border border-sky-100 bg-white px-3 py-2 outline-none ring-brand-500/20 focus:ring-4 ${inputClassName}`}
        placeholder={placeholder}
        data-register-field={dataRegisterField}
        aria-label="手机号"
      />
    </div>
  )
}
