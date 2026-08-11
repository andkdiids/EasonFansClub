'use client'

import { useState, type FormEvent } from 'react'
import { getPaginationItems, parsePaginationJump, type PaginationItem } from '@/lib/pagination'

type PaginationProps = {
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
  disabled?: boolean
  ariaLabel?: string
  maxVisiblePages?: number
  className?: string
}

export function Pagination({
  currentPage,
  totalPages,
  onPageChange,
  disabled = false,
  ariaLabel = '分页',
  maxVisiblePages = 7,
  className = '',
}: Readonly<PaginationProps>) {
  const [jumpValue, setJumpValue] = useState('')
  const safeTotal = Math.max(1, Math.trunc(totalPages) || 1)
  const safeCurrent = Math.min(Math.max(1, Math.trunc(currentPage) || 1), safeTotal)
  const items = getPaginationItems(safeCurrent, safeTotal, maxVisiblePages)

  function handleJump(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const page = parsePaginationJump(jumpValue, safeTotal)
    if (page === null) return
    onPageChange(page)
    setJumpValue('')
  }

  function renderPageItem(item: PaginationItem, index: number) {
    if (item === 'ellipsis') {
      return <span key={`ellipsis-${index}`} aria-hidden className="pagination-ellipsis">…</span>
    }
    if (item === safeCurrent) {
      return <span key={item} aria-current="page" className="pagination-page is-current">{item}</span>
    }
    return (
      <button
        key={item}
        type="button"
        disabled={disabled}
        className="pagination-page"
        onClick={() => onPageChange(item)}
      >
        {item}
      </button>
    )
  }

  return (
    <div className={`pagination-wrap ${className}`.trim()}>
      <nav aria-label={ariaLabel} className="pagination-nav">
        <button
          type="button"
          disabled={disabled || safeCurrent <= 1}
          className="pagination-edge"
          onClick={() => onPageChange(safeCurrent - 1)}
        >
          上一页
        </button>
        <div className="pagination-pages">{items.map(renderPageItem)}</div>
        <button
          type="button"
          disabled={disabled || safeCurrent >= safeTotal}
          className="pagination-edge"
          onClick={() => onPageChange(safeCurrent + 1)}
        >
          下一页
        </button>
      </nav>
      <form className="pagination-jump" onSubmit={handleJump}>
        <label htmlFor={`${ariaLabel}-jump`}>跳至</label>
        <input
          id={`${ariaLabel}-jump`}
          value={jumpValue}
          onChange={(event) => setJumpValue(event.target.value)}
          inputMode="numeric"
          pattern="[0-9]*"
          placeholder={String(safeCurrent)}
          aria-label="页码"
          disabled={disabled}
        />
        <span>页</span>
        <button type="submit" disabled={disabled || !jumpValue.trim()}>跳转</button>
      </form>
    </div>
  )
}
