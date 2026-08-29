import * as React from 'react'
import type { ReactNode } from 'react'
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

function renderInline(node: RichTextInlineNode, key: string) {
  if (node.type === 'hardBreak') return <br key={key} />
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
