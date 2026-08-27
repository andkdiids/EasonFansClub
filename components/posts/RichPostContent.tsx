import type { ReactNode } from 'react'
import {
  richTextColorClass,
  richTextFontSizeClass,
  validateRichPostContent,
  type RichTextInlineNode,
  type RichTextMark,
  type RichTextParagraphNode,
} from '@/lib/rich-text'

type RichPostContentProps = {
  richContent?: unknown | null
  fallbackContent: string
  className?: string
}

function renderMarks(content: ReactNode, marks: RichTextMark[] | undefined, key: string) {
  return (marks || []).reduce<ReactNode>((current, mark, index) => {
    if (mark.type === 'bold') return <strong key={key + '-bold-' + index}>{current}</strong>
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

function renderParagraph(paragraph: RichTextParagraphNode, key: string) {
  return <p key={key}>{(paragraph.content || []).map((node, index) => renderInline(node, key + '-' + index))}</p>
}

export function RichPostContent({ richContent, fallbackContent, className = '' }: RichPostContentProps) {
  const result = validateRichPostContent(richContent)
  const wrapperClassName = className ? 'rich-post-content ' + className : 'rich-post-content'

  if (!result.valid || (!result.plainText && fallbackContent)) {
    return <div className={wrapperClassName + ' whitespace-pre-wrap break-words'}>{fallbackContent}</div>
  }

  return (
    <div className={wrapperClassName}>
      {result.value.content.map((paragraph, index) => renderParagraph(paragraph, 'paragraph-' + index))}
    </div>
  )
}
