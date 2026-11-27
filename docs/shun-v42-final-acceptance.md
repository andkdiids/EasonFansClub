# 顺大师 V4.2 最终验收记录与复现说明

本文件记录 V4.2 最终技术验收的**证据台账**、**唯一编号**、**复现方法**，以及本轮补齐的
**事务执行中断线（in-doubt）**证据。所有证据均为隔离 QA 环境，不接触生产。

## 1. 验收证据台账（37 项唯一 PASS）

机器可读台账：`acceptance-final-verified.jsonl`（位于隔离证据目录，见下）。
经 JSON 解析核对：**37 行 / 37 个唯一顶层 id / 全部 result=PASS / 无重复计数**。
（注：`cmwz68os...` 是 NOTIFY-01 的 `before.id` 内嵌 delivery id，不是顶层编号。）

编号分组：

| 前缀 | 编号范围 | 数量 | 场景 |
| --- | --- | --- | --- |
| CONC | CONC-01 .. CONC-07 | 7 | 五设备同 requestId 并发幂等、victimCap、奖励扫描 |
| NOTIFY | NOTIFY-01 .. NOTIFY-07 | 7 | 异步 ACK 失败重试、回执丢失、设备令牌失效 |
| RESTART | RESTART-01 .. RESTART-07 | 7 | 真实进程 SIGTERM + 重启 + 同键重放 |
| TIME | TIME-01 .. TIME-04 | 4 | 通知写入故障无半账、跨周日/周一边界、重放不重复 |
| TRANSPORT | TRANSPORT-01 .. TRANSPORT-06 | 6 | 提交后响应丢失（after-commit replay） |
| TRANSPORT-*-BEFORE-SEND | 01 .. 06 | 6 | 请求在到达服务器前丢弃（before-send） |

> 说明：台账 37 项 = CONC(7) + NOTIFY(7) + RESTART(7) + TIME(4) +
> TRANSPORT(6) + TRANSPORT-BEFORE-SEND(6) = 37。精确 JSON 解析确认顶层 id 恰好 37 个唯一值。

## 2. 三种中断线的区分（重要）

- **请求未送达（before-send）**：请求在到达服务器前被丢弃，服务端无写入。
  对应 TRANSPORT-01..06-BEFORE-SEND，以及 RESTART-01（服务被 kill 后发起请求）。
- **提交后响应丢失（after-commit response loss）**：事务已提交，响应在回程被丢弃，
  重放靠幂等键返回同样结果。对应 TRANSPORT-01..06、RESTART-02..07。
- **事务执行中断（in-doubt / mid-execution）**：请求已送达、事务已开始写入但未提交，
  进程在事务中途被中断，结果不确定，依赖 InnoDB 回滚保证无半账。
  **原有 37 项不含此项**，本轮补齐见第 3 节。

## 3. 补齐：EXEC-INTERRUPT-01（事务执行中途中断）

新增测试：`tests/shun-v42-final-tx-interrupt.test.ts`

机制（与另两条中断线本质不同）：
1. 通过 `BEFORE INSERT ON PointLog` trigger 对目标 actor 的 `SHUN_STEAL` 入账注入 `SLEEP(20)`，
   使事务在写入 `ShunMasterRound` 之后、ledger 提交之前 hang；
2. 确认存在在途 InnoDB 事务后，对 Next.js 子进程发送 `SIGKILL` 切断数据库连接；
3. 断言 round/entry/pointLog 计数全部回滚到 0（**无半账**）——这是 in-doubt 场景的核心；
4. 移除 trigger、重启服务、用**同 requestId** 重放两次，断言恰好一次结算（rounds+1、logs+1）。

证据文件：`tx-interrupt-verified.jsonl`（隔离证据目录），`logPath` 指向 `tx-interrupt-run.log`。

## 4. 复现方法（隔离 QA，不触生产）

隔离证据目录：`E:/Eason/build-cache/shun-items-mysql-5ccb45b9e9c64f89a994917e2540ad47`
隔离 MySQL：mysqld 8.4.11，端口 33327，root 空密码，库 `ecfc_shun_items_fixture_qa`。
执行副本：`E:/Eason/build-cache/shun-items-mysql-5ccb45b9e9c64f89a994917e2540ad47/web-build`
（含 next 构建产物与完整依赖；工作树本身依赖不完整，故在副本执行，测试文件哈希一致。）

三个原验收测试（沿用，环境变量 gate 默认 skip）：

```bash
cd E:/Eason/build-cache/shun-items-mysql-5ccb45b9e9c64f89a994917e2540ad47/web-build
DATABASE_URL="mysql://root@127.0.0.1:33327/ecfc_shun_items_fixture_qa" \
SHUN_V42_RESTART_QA=1 NODE_OPTIONS="" \
  ./node_modules/.bin/tsx --test tests/shun-v42-final-restart.test.ts

DATABASE_URL="mysql://root@127.0.0.1:33327/ecfc_shun_items_fixture_qa" \
SHUN_V42_CONCURRENCY_QA=1 NODE_OPTIONS="" \
  ./node_modules/.bin/tsx --test tests/shun-v42-final-concurrency.test.ts

DATABASE_URL="mysql://root@127.0.0.1:33327/ecfc_shun_items_fixture_qa" \
SHUN_V42_ASYNC_TIME_QA=1 NODE_OPTIONS="" \
  ./node_modules/.bin/tsx --test tests/shun-v42-final-async-time.test.ts
```

本轮补齐的执行中断线测试：

```bash
DATABASE_URL="mysql://root@127.0.0.1:33327/ecfc_shun_items_fixture_qa" \
SHUN_V42_TX_INTERRUPT_QA=1 NODE_OPTIONS="" \
  ./node_modules/.bin/tsx --test tests/shun-v42-final-tx-interrupt.test.ts
```

TRANSPORT 测试变体（已纳入版本控制）：`tests/shun-items-browser.test.ts` 中的
`injectHttpFailure(..., 'after-commit')`（提交后响应丢失）与 `'before-send'`（请求丢弃）
两条分支，分别产出 TRANSPORT-01..06 与 TRANSPORT-01..06-BEFORE-SEND 证据。

## 5. 敏感信息检查

三个原测试与本轮新增测试均为隔离 QA：
- 数据库地址为本地回环 `127.0.0.1:33327`，库名 `ecfc_shun_items_fixture_qa`；
- Web 地址为本地回环 `127.0.0.1:312x`；
- `EXPO_ACCESS_TOKEN` 使用 `qa-local-token` 假值，推送客户端为注入桩，无真实网络调用；
- 会话令牌由测试运行时生成，`passwordHash` 为 `fixture` 占位符；
- 故障注入入口（MySQL trigger、HTTP abort、进程 SIGKILL）全部限定在隔离 QA 环境，
  通过环境变量 gate 默认关闭，不会对生产产生影响；
- 无生产地址、无真实凭据、无生产迁移账本写入。
