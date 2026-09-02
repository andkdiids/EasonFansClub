import * as React from 'react'
import type { ReactNode } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import {
  legacyHtmlToRichContent,
  plainTextToRichContent,
  richTextColorClass,
  richTextFontSizeClass,
  validateRichPostContent,
  type RichTextBlockNode,
  type RichTextInlineNode,
  type RichTextMark,
} from '@/lib/rich-text'
import { formatUid } from '@/lib/uid'

type RichPostContentProps = {
  richContent?: unknown | null
  fallbackContent: string
  className?: string
}

function renderMarks(content: ReactNode, marks: RichTextMark[] | undefined, key: string) {
  return (marks || []).reduce<ReactNode>((current, mark, index) => {
    if (mark.type === 'bold') return <strong key={key + '-bold-' + index}>{current}</strong>
    if (mark.type === 'italic') return <em key={key + '-italic-' + index}>{current}</em>
    if (mark.type === 'strike') return <s key={key + '-strike-' + index}>{current}</s>
    if (mark.type === 'code') return <code key={key + '-code-' + index}>{current}</code>
    if (mark.type === 'link') {
      return (
        <a key={key + '-link-' + index} href={mark.attrs.href} target="_blank" rel="noopener noreferrer">
          {current}
        </a>
      )
    }
    if (mark.type === 'textColor') {
      return <span key={key + '-color-' + index} className={richTextColorClass(mark.attrs.token)}>{current}</span>
    }
    return <span key={key + '-size-' + index} className={richTextFontSizeClass(mark.attrs.token)}>{current}</span>
  }, content)
}

function formatReferenceDate(value: string | undefined) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function renderInline(node: RichTextInlineNode, key: string) {
  if (node.type === 'hardBreak') return <br key={key} />
  if (node.type === 'musicReference') {
    return (
      <Link
        key={key}
        href={`/music/song/${encodeURIComponent(node.attrs.songId)}`}
        className="rich-text-music-reference"
        aria-label={`查看歌曲：${node.attrs.title || '歌曲引用'}`}
      >
        <span className="rich-text-music-reference-icon" aria-hidden="true">♪</span>
        <span className="rich-text-music-reference-copy">
          <strong>{node.attrs.title || '歌曲引用'}</strong>
          {node.attrs.artist || node.attrs.album ? <small>{[node.attrs.artist, node.attrs.album ? `《${node.attrs.album}》` : ''].filter(Boolean).join(' · ')}</small> : null}
        </span>
      </Link>
    )
  }
  if (node.type === 'postReference') {
    const unavailable = node.attrs.available === false
    const title = unavailable ? '该引用帖子已不可用' : node.attrs.title || '引用帖子'
    const author = unavailable ? '' : node.attrs.authorName || '未知作者'
    const uid = unavailable || node.attrs.authorUid === undefined ? '' : `UID ${formatUid(node.attrs.authorUid)}`
    const card = (
      <>
        <span className="rich-text-post-reference-icon" aria-hidden="true">↗</span>
        <span className="rich-text-post-reference-copy">
          <strong>引用帖子</strong>
          <span>《{title}》</span>
          <small>{[author, uid].filter(Boolean).join(' · ')}</small>
        </span>
      </>
    )
    if (unavailable) {
      return <span key={key} className="rich-text-post-reference is-unavailable" aria-label="该引用帖子已不可用">{card}</span>
    }
    return (
      <Link
        key={key}
        href={`/posts/${encodeURIComponent(node.attrs.postId)}`}
        className="rich-text-post-reference"
        aria-label={`查看引用帖子：${title}`}
      >
        {card}
      </Link>
    )
  }
  if (node.type === 'activityReference') {
    const unavailable = node.attrs.available === false
    const title = unavailable ? '该引用活动已不可用' : node.attrs.title || node.attrs.titleSnapshot || '引用活动'
    const cover = node.attrs.coverUrl || node.attrs.bannerUrl
    const dateText = [formatReferenceDate(node.attrs.startsAt), formatReferenceDate(node.attrs.endsAt)].filter(Boolean).join(' - ')
    const details = [dateText, node.attrs.locationName, node.attrs.statusLabel].filter(Boolean).join(' · ')
    const card = (
      <>
        <span className="rich-text-activity-reference-icon" aria-hidden="true">
          {cover ? <Image src={cover} alt="" width={40} height={40} className="rich-text-reference-media" /> : '活动'}
        </span>
        <span className="rich-text-activity-reference-copy">
          <strong>引用活动</strong>
          <span>{title}</span>
          {details ? <small>{details}</small> : null}
        </span>
      </>
    )
    if (unavailable) {
      return <span key={key} className="rich-text-activity-reference is-unavailable" aria-label="该引用活动已不可用">{card}</span>
    }
    return (
      <Link
        key={key}
        href={`/activities/${encodeURIComponent(node.attrs.activityId)}`}
        className="rich-text-activity-reference"
        aria-label={`查看引用活动：${title}`}
      >
        {card}
      </Link>
    )
  }
  if (node.type === 'materialReference') {
    const unavailable = node.attrs.available === false
    const title = unavailable ? '该引用物料已不可用' : node.attrs.title || node.attrs.titleSnapshot || '引用物料'
    const details = [
      node.attrs.cost === undefined ? '' : `挂号费 ${node.attrs.cost}`,
      node.attrs.stockRemaining === undefined ? '' : `库存 ${node.attrs.stockRemaining}`,
      node.attrs.stateLabel,
      node.attrs.linkedActivityTitle,
    ].filter(Boolean).join(' · ')
    const card = (
      <>
        <span className="rich-text-material-reference-icon" aria-hidden="true">
          {node.attrs.coverImageUrl ? <Image src={node.attrs.coverImageUrl} alt="" width={40} height={40} className="rich-text-reference-media" /> : '物料'}
        </span>
        <span className="rich-text-material-reference-copy">
          <strong>引用物料</strong>
          <span>{title}</span>
          {details ? <small>{details}</small> : null}
        </span>
      </>
    )
    if (unavailable) {
      return <span key={key} className="rich-text-material-reference is-unavailable" aria-label="该引用物料已不可用">{card}</span>
    }
    return (
      <Link
        key={key}
        href={`/material-redemptions/${encodeURIComponent(node.attrs.materialId)}`}
        className="rich-text-material-reference"
        aria-label={`查看引用物料：${title}`}
      >
        {card}
      </Link>
    )
  }
  if (node.type === 'userMention') {
    const displayName = node.attrs.available === false ? '用户已不可用' : node.attrs.displayName || '用户已不可用'
    const label = `@${displayName}`
    if (node.attrs.available === false || node.attrs.uid === undefined) {
      return <span key={key} className="rich-text-user-mention is-unavailable">{label}</span>
    }
    return (
      <Link
        key={key}
        href={`/user/${formatUid(node.attrs.uid)}`}
        className="rich-text-user-mention"
        aria-label={`查看用户：${displayName}`}
      >
        {label}
      </Link>
    )
  }
  if (node.type !== 'text') return null
  return <span key={key}>{renderMarks(node.text, node.marks, key)}</span>
}

function renderInlineContent(content: RichTextInlineNode[] | undefined, key: string) {
  return (content || []).map((node, index) => renderInline(node, key + '-' + index))
}

function renderBlock(block: RichTextBlockNode, key: string): ReactNode {
  if (block.type === 'paragraph') {
    return <p key={key}>{renderInlineContent(block.content, key)}</p>
  }
  if (block.type === 'heading') {
    const tag = ('h' + block.attrs.level) as 'h1' | 'h2' | 'h3'
    const Heading = tag
    return <Heading key={key}>{renderInlineContent(block.content, key)}</Heading>
  }
  if (block.type === 'bulletList') {
    return <ul key={key}>{(block.content || []).map((item, index) => renderBlock(item, key + '-item-' + index))}</ul>
  }
  if (block.type === 'orderedList') {
    const start = block.attrs?.start && block.attrs.start > 1 ? block.attrs.start : undefined
    return <ol key={key} start={start}>{(block.content || []).map((item, index) => renderBlock(item, key + '-item-' + index))}</ol>
  }
  if (block.type === 'listItem') {
    return <li key={key}>{(block.content || []).map((child, index) => renderBlock(child, key + '-block-' + index))}</li>
  }
  if (block.type === 'blockquote') {
    return <blockquote key={key}>{(block.content || []).map((child, index) => renderBlock(child, key + '-block-' + index))}</blockquote>
  }
  if (block.type === 'horizontalRule') return <hr key={key} />
  return (
    <pre key={key}>
      <code>{(block.content || []).map((node) => node.text).join('')}</code>
    </pre>
  )
}

export function RichPostContent({ richContent, fallbackContent, className = '' }: RichPostContentProps) {
  const result = validateRichPostContent(richContent)
  const legacy = legacyHtmlToRichContent(fallbackContent)
  const fallbackDocument = legacy || (fallbackContent ? plainTextToRichContent(fallbackContent) : null)
  const document = result.valid && (result.value.content.length > 0 || !fallbackDocument)
    ? result.value
    : fallbackDocument
  const wrapperClassName = className ? 'rich-post-content ' + className : 'rich-post-content'

  if (!document) {
    return <div className={wrapperClassName + ' whitespace-pre-wrap break-words'}>{fallbackContent}</div>
  }

  return (
    <div className={wrapperClassName}>
      {document.content.map((block, index) => renderBlock(block, 'block-' + index))}
    </div>
  )
}
