'use client'

import { useState, type InputHTMLAttributes } from 'react'
import { UiIcon } from '@/components/UiIcon'

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  showLabel?: string
  hideLabel?: string
}

export function PasswordInput({
  className = '',
  showLabel = '显示密码',
  hideLabel = '隐藏密码',
  ...inputProps
}: Readonly<PasswordInputProps>) {
  const [isVisible, setIsVisible] = useState(false)
  const toggleLabel = isVisible ? hideLabel : showLabel

  return (
    <span className="password-input-shell">
      <input
        {...inputProps}
        type={isVisible ? 'text' : 'password'}
        className={`password-input-field ${className}`.trim()}
      />
      <button
        type="button"
        className="password-input-toggle"
        aria-label={toggleLabel}
        aria-pressed={isVisible}
        title={toggleLabel}
        onClick={() => setIsVisible((current) => !current)}
      >
        <UiIcon
          name={isVisible ? 'eye-off' : 'eye'}
          className="password-input-icon"
        />
      </button>
    </span>
  )
}
