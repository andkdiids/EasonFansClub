'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'

export class CommentSectionBoundary extends Component<
  Readonly<{ children: ReactNode }>,
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[post:comments:render-failed]', { error, componentStack: info.componentStack })
  }

  render() {
    if (this.state.failed) {
      return (
        <section className="border border-amber-200 bg-amber-50 p-5" aria-label="评论加载状态">
          <h2 className="text-xl font-black text-amber-950">评论暂时无法显示</h2>
          <p className="mt-2 text-sm font-bold text-amber-800">帖子正文不受影响。请刷新页面后重试评论区。</p>
          <button type="button" onClick={() => this.setState({ failed: false })} className="mt-4 bg-amber-900 px-4 py-2 text-sm font-black text-white">
            重试评论区
          </button>
        </section>
      )
    }
    return this.props.children
  }
}
