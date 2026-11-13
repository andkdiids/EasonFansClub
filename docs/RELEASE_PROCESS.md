# 私家E院默认开发与正式发布流程

更新：2026-11-13。此文件记录管理员确认的长期发布规范，适用于 Web 和 Android 后续功能、修复与版本发布。开始任务先读取本文件和仓库 AGENTS.md。发布任务沿用已经成功使用的现有流程；仅开发任务不自动扩大为未经授权的生产发布。

## 默认顺序

1. 核实当前工作区、远端正式分支和线上版本，保留用户未提交修改及既有制品。创建独立修复/功能分支，不把用户无关修改纳入提交。
2. 实现功能或修复，按实际影响运行必要的单元、集成、并发、TypeScript、ESLint 与构建检查。数据库变更使用既有 Prisma Schema 和增量 migration 流程。
3. 检查完整 diff，提交并创建 PR。修复真实 CI 失败，检查通过且满足仓库保护后正常合并；不伪造 Review 或跳过必要测试。
4. 读取合并后的真实 main SHA 和当前生产 SHA，使用现有正式 Web 部署工作流。保留目标 SHA 校验、部署锁、锁内生产 SHA CAS、正式迁移、迁移失败保护、必要 Worker 维护排空与恢复、健康检查及受保护应用回滚。
5. 按实际数据库状态执行必要 migration；已成功的迁移不重复执行。存在必要迁移时不得用 skip-db 绕过。skip-db 只用于现有流程允许且确实不需要数据库阶段的部署。
6. 确认公开 Web health 返回目标 SHA，确认 Worker 的真实进程、release 和运行状态。迁移开始或完成后不得盲目回滚数据库。
7. 按当前正式版本递增 Android 版本，保留 fans.ecfc.app 和既有正式签名。使用现有构建脚本及受支持依赖/构建配置生成正式 APK，不无故修改已经验证的 APK 构建配置。
8. 使用现有 COS/CDN 发布位置和不可混淆的版本化对象，完整回读 APK；核对大小、SHA256、包名、版本、SDK、ABI 和正式签名，保留上一个正式版本制品。
9. 使用现有 Version API CAS 工作流，expected 取自本轮实时生产值。保留 minVersion/forceUpdate 既定策略；CAS 失败先读取变化原因，不强制覆盖其他发布。
10. 再次读取公开 Version API，从正式下载入口完整下载并验签，核对 Web 与 Worker。按授权设备执行覆盖升级及业务验收；没有设备或账号时明确记录未完成，不能伪造通过。
11. 报告 PR、合并 SHA、CI/部署/发布 Run、线上 SHA、APK 地址及摘要、回滚制品和未完成验收。只更新实际发生变化的项目状态与发布记录。

## 现有入口与职责

以下路径属于 Web 仓库 andkdiids/EasonFansClub；Mobile 仓库 andkdiids/eason-fans-club-app 负责应用开发与现有正式签名构建。

| 职责 | 现有入口 | 使用规则 |
| --- | --- | --- |
| Web 正式部署 | `.github/workflows/deploy.yml` / Deploy to Tencent Cloud | 默认正式入口；按实际需要选择 full 或现有允许的 skip-db，不绕过必要迁移 |
| Android 构建与签名 | Mobile `scripts/android-build.ps1`、既有 Android 构建配置 | 使用现有正式证书和版本，保护签名凭据及历史制品 |
| COS 制品发布 | Web `.github/workflows/publish-android-rc11.yml` 及其既有发布脚本 | 历史文件名不代表必须复制工作流；新版本仅补必要候选/版本参数 |
| Android Version API 发布 | Web `.github/workflows/configure-android-version.yml` | 复用现有制品核验、部署锁、生产 SHA CAS 和版本 CAS |
| 发布失败恢复 | 现有 Web/Android rollback 工作流及部署脚本 | 按实际失败阶段处理，保留旧制品，不盲目回滚数据库 |
| 生产故障取证 | 现有 migration/Worker/TLS/strict-readonly 等诊断工作流 | 按具体故障选择；诊断不能无条件升级为每次发布的强制前置条件 |

`production-release-approved.yml`、`production-server-rc-v3.yml` 等历史 SHA/特定候选工作流不是普通新版本的默认入口。历史审计文档、旧 RC runbook 和一次性风险记录保留作历史证据，不重新成为本规范之外的长期门禁。

## 不擅自扩大发布门禁

- 不为普通发布新增人工备份证明、PITR attestation、恢复演练证明、每次恢复演练、一次性风险接受或重复人工授权。腾讯云现有自动备份配置保持原样；未知的备份/恢复状态不得伪造为 PASS。
- 不因诊断工具的附加检查，自动强制生产应用采用 VERIFY_IDENTITY、sslaccept=strict 或新的证书配置。应用连接遵守腾讯云当前实际数据库安全策略；服务端已强制 SSL 时不得用明文绕过，也不得关闭现有必须的校验。
- 不把额外严格只读预检、重复 SHA 预检、与当前改动无关的审计、重复工作流或历史故障证明设为普通发布的必经步骤。
- 不因开发新功能重新设计发布架构。现有流程出现真实故障时，先定位并做最小必要修复，说明与本次功能/发布的直接关系并补相应测试。
- 继续遵守 GitHub Branch Protection、Environment Approval 和真实账号权限；不伪造测试、Review、迁移账本、签名、回滚或发布结果。
- 真实数据损坏风险、不可逆操作、服务端数据库安全策略变更及重大生产风险仍需必要保护与相应授权。简化流程不能用于绕过这些真实限制。

## 变更原则

现有流程可完成需求时直接复用。只有本次业务或真实故障确实需要，才做最小、可测试、可回滚的修改；不修改无关历史 migration，不增加重复发布工作流，不把可选取证升级为长期发布审批。
