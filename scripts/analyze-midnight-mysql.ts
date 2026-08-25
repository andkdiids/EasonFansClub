import { readFileSync } from 'node:fs'

const fileIndex = process.argv.indexOf('--file')
const file = fileIndex >= 0 ? process.argv[fileIndex + 1] : undefined
if (!file) throw new Error('请提供 --file <mysql-sampler.tsv>')

const cumulativeMetrics = new Set([
  'Questions', 'Queries', 'Slow_queries', 'Innodb_row_lock_waits', 'Innodb_row_lock_time',
  'Connections', 'Select_scan', 'Select_full_join', 'Created_tmp_tables',
  'Created_tmp_disk_tables', 'Handler_read_rnd_next',
])
const samples = new Map<string, Record<string, number>>()
for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
  if (!line || line.startsWith('#')) continue
  const [timestamp, metric, rawValue] = line.split('\t')
  const value = Number(rawValue)
  if (!timestamp || !metric || !Number.isFinite(value)) continue
  const row = samples.get(timestamp) || {}
  row[metric] = value
  samples.set(timestamp, row)
}

const timestamps = [...samples.keys()].sort((a, b) => Date.parse(a) - Date.parse(b))
const rows = timestamps.map((timestamp, index) => {
  const values = samples.get(timestamp) || {}
  const previous = index > 0 ? samples.get(timestamps[index - 1]) || {} : undefined
  const delta: Record<string, number> = {}
  if (previous) {
    for (const metric of cumulativeMetrics) {
      if (values[metric] === undefined || previous[metric] === undefined) continue
      delta[metric] = values[metric] - previous[metric]
    }
  }
  return { timestamp, values, delta }
})

console.log(JSON.stringify({ event: 'mysql.midnight.samples', cumulativeMetrics: [...cumulativeMetrics], rows }, null, 2))
