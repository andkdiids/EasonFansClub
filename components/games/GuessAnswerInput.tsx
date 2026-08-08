'use client'

import { useEffect, useState } from 'react'

export type GuessOption = {
  key: string
  label: string
}

export type GuessSongCandidate = {
  id: string
  title: string
  artist: string
  albumTitle: string
}

export type GuessAnswerSubmission = {
  optionKey: string | null
  songId: string | null
  answerText: string | null
}

type GuessAnswerInputProps = {
  options: GuessOption[]
  disabled: boolean
  played: boolean
  wrongPulse: number
  mode: 'CHOICE' | 'INPUT'
  searchCandidates?: (query: string, signal: AbortSignal) => Promise<GuessSongCandidate[]>
  onSubmit: (answer: GuessAnswerSubmission) => void
}

export function GuessAnswerInput({
  mode,
  options,
  disabled,
  played,
  wrongPulse,
  searchCandidates,
  onSubmit,
}: Readonly<GuessAnswerInputProps>) {
  const [query, setQuery] = useState('')
  const [selectedKey, setSelectedKey] = useState('')
  const [candidates, setCandidates] = useState<GuessSongCandidate[]>([])
  useEffect(() => {
    if (mode !== 'INPUT' || !played || disabled || selectedKey || !searchCandidates) {
      setCandidates([])
      return
    }
    const keyword = query.trim()
    if (!keyword) {
      setCandidates([])
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void searchCandidates(keyword, controller.signal)
        .then((result) => setCandidates(result))
        .catch((error: unknown) => {
          if (!(error instanceof DOMException && error.name === 'AbortError')) setCandidates([])
        })
    }, 180)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [disabled, mode, played, query, searchCandidates, selectedKey])

  function chooseOption(option: GuessOption) {
    setSelectedKey(option.key)
  }

  function chooseCandidate(candidate: GuessSongCandidate) {
    setSelectedKey(candidate.id)
    setQuery(candidate.title)
    setCandidates([])
  }

  function submit() {
    if (mode === 'CHOICE') {
      if (!selectedKey) return
      onSubmit({ optionKey: selectedKey, songId: null, answerText: null })
      return
    }
    const answerText = query.trim()
    if (!answerText) return
    onSubmit({ optionKey: null, songId: selectedKey || null, answerText })
  }

  return (
    <div className={`guess-answer-input ${wrongPulse ? 'is-wrong' : ''}`} key={`answer-${wrongPulse}`}>
      {mode === 'INPUT' ? (
        <label>
          <span>输入歌曲名称</span>
          <input
            value={query}
            disabled={disabled || !played}
            placeholder={played ? '输入歌曲名称…' : '请先播放音频'}
            autoComplete="off"
            onChange={(event) => {
              setQuery(event.target.value)
              setSelectedKey('')
            }}
          />
        </label>
      ) : null}

      {mode === 'CHOICE' && played && !disabled ? (
        <div className="guess-song-options answer-grid" data-testid="answer-grid">
          {options.map((option) => (
            <button
              key={option.key}
              type="button"
              className={selectedKey === option.key ? 'selected' : ''}
              onClick={() => chooseOption(option)}
            >
              <span className="guess-option-text">{option.label}</span>
            </button>
          ))}
        </div>
      ) : null}

      {mode === 'INPUT' && played && !disabled && candidates.length > 0 ? (
        <div className="guess-answer-suggestions" role="listbox" aria-label="歌曲候选">
          {candidates.map((candidate) => (
            <button key={candidate.id} type="button" onClick={() => chooseCandidate(candidate)}>
              <strong>{candidate.title}</strong>
              <small>{candidate.albumTitle} · {candidate.artist}</small>
            </button>
          ))}
        </div>
      ) : null}

      <button
        type="button"
        className="guess-confirm-button"
        disabled={disabled || !played || (mode === 'CHOICE' ? !selectedKey : !query.trim())}
        onClick={submit}
      >
        {mode === 'CHOICE' ? '确认答案' : '提交答案'}
      </button>
    </div>
  )
}
