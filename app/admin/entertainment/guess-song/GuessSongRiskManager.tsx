'use client'

import { useEffect, useState } from 'react'

type RiskReason = {
  code: string
  label: string
  points: number
}

type RiskLog = {
  id: string
  uid: number
  nickname: string
  username: string
  createdAt: string
  mode: string
  score: number
  riskScore: number
  trigger: string | null
  reasons: RiskReason[]
}

export function GuessSongRiskManager() {
  const [logs, setLogs] = useState<RiskLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/admin/entertainment/guess-song/risk?limit=100', {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json() as { ok?: boolean; data?: { logs: RiskLog[] }; error?: string }
        if (!response.ok || !payload.ok || !payload.data) throw new Error(payload.error || '风控日志读取失败')
        setLogs(payload.data.logs)
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return
        setError(reason instanceof Error ? reason.message : '风控日志读取失败')
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [])

  return (
    <section className="guess-song-risk">
      <header>
        <small>LISTEN RISK CONTROL</small>
        <h2>听听风控</h2>
        <p>记录组合异常信号；单独的高分、偶尔快速答题或网络重复请求不会被判定为作弊。</p>
      </header>
      {error ? <p className="guess-song-admin-processing-error" role="alert">{error}</p> : null}
      {loading ? <p className="guess-song-empty">正在加载风控日志…</p> : null}
      {!loading && logs.length === 0 ? <p className="guess-song-empty">暂无风控记录。</p> : null}
      {logs.length > 0 ? (
        <div className="guess-song-risk-table-wrap">
          <table className="guess-song-risk-table">
            <thead>
              <tr>
                <th>用户 / UID</th>
                <th>时间</th>
                <th>模式</th>
                <th>分数</th>
                <th>风险分</th>
                <th>原因</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td><strong>{log.nickname}</strong><small>{log.username} · {log.uid}</small></td>
                  <td>{new Date(log.createdAt).toLocaleString('zh-CN')}</td>
                  <td>{log.mode}</td>
                  <td>{log.score}</td>
                  <td><b className={log.riskScore >= 80 ? 'is-cheat' : ''}>{log.riskScore}</b></td>
                  <td>
                    <ul>
                      {log.reasons.map((reason) => <li key={reason.code}>{reason.label} <small>+{reason.points}</small></li>)}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  )
}
