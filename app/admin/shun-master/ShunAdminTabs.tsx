'use client'

import { useState, type ReactNode } from 'react'

/** 顺大师后台分页：道具管理 / 道具发放（无发放权限时只显示道具管理）。 */
export function ShunAdminTabs({ items, grants }: { items: ReactNode; grants: ReactNode | null }) {
  const [tab, setTab] = useState<'items' | 'grants'>('items')
  const tabs = grants
    ? [['items', '道具管理'], ['grants', '道具发放']] as const
    : [['items', '道具管理']] as const
  return <>
    <div className="mx-auto mt-4 flex max-w-6xl gap-2" role="tablist" aria-label="顺大师后台分页">
      {tabs.map(([key, label]) => <button
        key={key} type="button" role="tab" aria-selected={tab === key}
        className={`border px-3 py-1 ${tab === key ? 'bg-black text-white' : ''}`}
        onClick={() => setTab(key)}>{label}</button>)}
    </div>
    <div hidden={tab !== 'items'}>{items}</div>
    {grants ? <div hidden={tab !== 'grants'}>{grants}</div> : null}
  </>
}
