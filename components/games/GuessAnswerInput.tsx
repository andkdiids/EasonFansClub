'use client'

import { useMemo, useState } from 'react'

export type GuessOption = {
  key: string
  label: string
}

type GuessAnswerInputProps = {
  options: GuessOption[]
  disabled: boolean
  played: boolean
  wrongPulse: number
  mode: 'CHOICE' | 'INPUT'
  onSubmit: (key: string) => void
}

export function GuessAnswerInput({ mode, options, disabled, played, wrongPulse, onSubmit }: Readonly<GuessAnswerInputProps>) {

  const [query, setQuery] = useState('')
  const [selectedKey, setSelectedKey] = useState('')

  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase('zh-CN')

    if (!keyword) return options

    return options.filter((option) =>
      option.label.toLocaleLowerCase('zh-CN').includes(keyword)
    )
  }, [options, query])


  function choose(option: GuessOption) {
    setSelectedKey(option.key)
    setQuery(option.label)
  }


  function submit() {
    if (!selectedKey) return
    onSubmit(selectedKey)
  }


  return (
    <div
      className={`guess-answer-input ${wrongPulse ? 'is-wrong' : ''}`}
      key={`answer-${wrongPulse}`}
    >

      {/* 专家模式输入 */}
      {mode === 'INPUT' ? (
        <label>
          <span>输入歌曲名称</span>

          <input
            value={query}
            disabled={disabled || !played}
            placeholder={
              played
                ? '输入歌曲名称…'
                : '请先播放音频'
            }
            autoComplete="off"
            onChange={(event) => {
              setQuery(event.target.value)
              setSelectedKey('')
            }}
          />
        </label>
      ) : null}



      {/* 普通模式四选一 */}
      {mode === 'CHOICE' && played && !disabled ? (
        <div className="guess-song-options answer-grid" data-testid="answer-grid">

{options.map((option) => (
  <button
    key={option.key}
    type="button"
    className={
      selectedKey === option.key
        ? 'selected'
        : ''
    }
    onClick={() => choose(option)}
  >

<span className="guess-option-text">
  {option.label}
</span>

  </button>
))}

        </div>
      ) : null}



      {/* 专家模式输入提示 */}
{/* 专家模式输入提示 */}
{mode === 'INPUT' && played && !disabled && query.trim() ? (
  <div className="guess-answer-suggestions">
    {filtered.map((option) => (
      <button
        key={option.key}
        type="button"
        onClick={() => choose(option)}
      >
        {option.label}
      </button>
    ))}
  </div>
) : null}



      {/* 确认按钮 */}

      <button
        type="button"
        className="guess-confirm-button"
        disabled={
          disabled ||
          !played ||
          !selectedKey
        }
        onClick={submit}
      >
        {mode === 'CHOICE'
          ? '确认答案'
          : '提交答案'}
      </button>


    </div>
  )
}
