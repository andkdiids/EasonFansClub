import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('第二阶段签到日志区分主响应与后台任务，且不等待后处理协调器', () => {
  const route = read('app/api/checkin/route.ts')
  assert.match(route, /totalMs/)
  assert.match(route, /authMs/)
  assert.match(route, /rateLimitMs/)
  assert.match(route, /precheckMs/)
  assert.match(route, /transactionMs/)
  assert.match(route, /postCriticalMs/)
  assert.match(route, /responseBuildMs/)
  assert.match(route, /logCheckInBackgroundTask/)
  assert.match(route, /void runCheckInPostProcess\(/)
  assert.doesNotMatch(route, /await runCheckInPostProcess\(/)
})

test('公共统计缓存输出低噪声命中、single-flight 和真实回源指标', () => {
  const stats = read('lib/checkin-stats.ts')
  for (const event of ['cache_hit', 'cache_miss', 'singleflight_join', 'db_refresh']) assert.match(stats, new RegExp(event))
  assert.match(stats, /singleflightJoins/)
  assert.match(stats, /cacheHits/)
})

test('生日 job lease 使用 token compare-and-set，旧执行者不能覆盖新执行者', () => {
  const schema = read('prisma/schema.prisma')
  const migration = read('prisma/migrations/20260825143000_add_daily_job_lease_token/migration.sql')
  const execution = read('lib/daily-job-execution.ts')
  assert.match(schema, /model DailyJobExecution[\s\S]*runToken\s+String\?/)
  assert.match(migration, /ADD COLUMN `runToken` VARCHAR\(64\) NULL/)
  assert.match(execution, /randomUUID\(\)/)
  assert.match(execution, /where: \{ jobKey, dateKey, runToken \}/)
  assert.match(execution, /DailyJobLeaseLostError/)
})

test('生日调度脚本只调用本机受保护 endpoint，重试时间避开 00:00 洪峰', () => {
  const script = read('scripts/run-birthday-daily-job.sh')
  const cron = read('ops/cron/birthday-daily-job.cron.example')
  assert.match(script, /DAILY_JOB_SECRET/)
  assert.match(script, /--connect-timeout/)
  assert.match(script, /--max-time/)
  assert.match(script, /--request POST/)
  assert.doesNotMatch(script, /DROP|TRUNCATE|DELETE|UPDATE|INSERT/i)
  assert.match(cron, /CRON_TZ=Asia\/Shanghai/)
  assert.match(cron, /10 0 \* \* \*/)
  assert.match(cron, /15 0 \* \* \*/)
  assert.match(cron, /20 0 \* \* \*/)
  assert.doesNotMatch(cron, /DAILY_JOB_SECRET\s*=/)
})

test('午夜诊断与 MySQL 采样工具默认只读，并计算累计指标差值', () => {
  const sampler = read('scripts/mysql-midnight-sampler.sh')
  const analyzer = read('scripts/analyze-midnight-mysql.ts')
  const diagnostics = read('scripts/midnight-diagnostics.ts')
  assert.match(sampler, /SHOW GLOBAL STATUS/)
  assert.match(sampler, /information_schema\.PROCESSLIST/)
  assert.doesNotMatch(sampler, /\b(UPDATE|DELETE|INSERT|TRUNCATE|DROP|ALTER)\b/i)
  assert.match(analyzer, /Innodb_row_lock_waits/)
  assert.match(analyzer, /delta\[metric\] = values\[metric\] - previous\[metric\]/)
  assert.match(diagnostics, /request_time/)
  assert.match(diagnostics, /upstream_response_time/)
  assert.match(diagnostics, /p95/)
  assert.match(diagnostics, /Asia\/Shanghai/)
  const host = read('scripts/collect-midnight-host-readonly.sh')
  assert.match(host, /pm2 list/)
  assert.match(host, /pm2 describe/)
  assert.doesNotMatch(host, /pm2 (restart|reload|kill)|systemctl restart|nginx -s/i)
})

test('EXPLAIN 工具拒绝隐式使用 DATABASE_URL，避免误连生产', () => {
  const explain = read('scripts/checkin-explain.ts')
  assert.match(explain, /EXPLAIN_DATABASE_URL/)
  assert.match(explain, /不会回退到 DATABASE_URL/)
  assert.match(explain, /COUNT\(\*\)/)
  assert.match(explain, /GROUP BY mood/)
})

test('签到派生状态可以从 CheckIn 事实源 dry-run 或显式修复', () => {
  const reconcile = read('lib/checkin-derived-reconcile.ts')
  const script = read('scripts/reconcile-checkin-derived-state.ts')
  assert.match(reconcile, /userId_checkinDateKey/)
  assert.match(reconcile, /dailyTaskProgress\.upsert/)
  assert.match(reconcile, /syncUserAchievements/)
  assert.match(script, /mode: apply \? 'apply' : 'dry-run'/)
  assert.match(script, /--apply/)
})

test('awardRegistrationFee 先锁用户再按 businessKey 当前读检查', () => {
  const fee = read('lib/registration-fee.ts')
  const lock = fee.indexOf('FOR UPDATE')
  const secondCheck = fee.indexOf('existingAfterLock')
  const increment = fee.indexOf('points: { increment: requestedAmount }')
  const createLog = fee.indexOf('tx.pointLog.create')
  assert.ok(lock >= 0)
  assert.ok(secondCheck > lock)
  assert.ok(increment > secondCheck)
  assert.ok(createLog > increment)
})

test('Nginx 和进程观测字段覆盖下一次午夜定位所需信息', () => {
  const nginx = read('ops/nginx/access-performance.conf.example')
  const runtime = read('lib/runtime-observability.ts')
  assert.match(nginx, /\$request_time/)
  assert.match(nginx, /\$upstream_response_time/)
  assert.match(nginx, /\$status/)
  assert.match(runtime, /monitorEventLoopDelay/)
  assert.match(runtime, /p95Ms/)
  assert.match(runtime, /p99Ms/)
  assert.match(runtime, /rss/)
  assert.match(runtime, /heapUsed/)
})
