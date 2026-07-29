'use client'

import { useMemo, useState } from 'react'

export type GuessOption = { key: string; label: string }

export function GuessAnswerInput({ options, disabled, played, wrongPulse, onSubmit }: Readonly<{
  options: GuessOption[]
  disabled: boolean
  played: boolean
  wrongPulse: number
  onSubmit: (key: string) => void
}>) {
  const [query, setQuery] = useState('')
  const [selectedKey, setSelectedKey] = useState('')
  const [focused, setFocused] = useState(false)
  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase('zh-CN')
    return keyword ? options.filter((option) => option.label.toLocaleLowerCase('zh-CN').includes(keyword)) : options
  }, [options, query])

  function choose(option: GuessOption) {
    setQuery(option.label)
    setSelectedKey(option.key)
  }

  return (
    <div className={`guess-answer-input ${wrongPulse ? 'is-wrong' : ''}`} key={`answer-${wrongPulse}`}>
      <label>
        <span>输入或选择歌曲</span>
        <input
          value={query}
          disabled={disabled || !played}
          placeholder={played ? '输入歌曲名称…' : '请先播放音频'}
          autoComplete="off"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(event) => {
            setQuery(event.target.value)
            setSelectedKey('')
          }}
        />
      </label>
      {played && !disabled && focused ? (
        <div className="guess-answer-suggestions">
          {filtered.map((option) => (
            <button key={option.key} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => choose(option)}>
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
      <button type="button" disabled={disabled || !played || !selectedKey} onClick={() => onSubmit(selectedKey)}>提交答案</button>
    </div>
  )
}
