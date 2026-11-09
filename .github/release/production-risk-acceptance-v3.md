# Schema v3 production risk acceptance

This runbook describes the protected, one-time schema v3 path. It does not authorize a production deployment by itself. The only signer is `.github/workflows/issue-production-risk-acceptance.yml`; it runs on `main`, requires the `Production` GitHub Environment, shares the `production-deploy` concurrency group, verifies the pinned production SSH host key, and takes the server `.deploy.lock` before touching proof state.

## Approval evidence

Dispatch the signer with only the numeric GitHub PR comment ID. The workflow derives the target from the dispatched `main` SHA and fetches the comment and its PR directly from GitHub. It requires:

- the exact repository and comment ID;
- author `andkdiids` with `author_association=OWNER`;
- an unedited comment (`updated_at` equals the original `created_at`);
- a merged PR whose `merge_commit_sha` is exactly the current `main` SHA;
- explicit one-time approval, that exact SHA, and acknowledgement that backup/PITR was not independently verified, no restore drill was completed, and a serious failure could cause permanent data loss;
- approval no more than eight hours old.

The recorded `approvedAt` is the GitHub API `created_at`. The signer sets expiry to 30 minutes after issuance. It accepts no user-supplied SHA, approver, timestamp, host, SSH command, or filesystem path.

The approval comment should state the exact full SHA and include an unambiguous one-time approval plus the accepted facts: CynosDB backup/PITR was not independently verified, the isolated restore drill was not completed, and a serious failure could cause permanent data loss. For example:

> 本人明确批准针对以下 SHA 的一次性 Web 生产部署风险接受：`<full main SHA>`。我已知悉并接受：CynosDB 自动备份和 PITR 尚未经过独立验证；隔离环境恢复演练未完成；严重故障可能导致数据无法恢复或永久丢失。本批准仅限该 SHA 的一次部署。

The comment must be on the merged PR whose merge commit is exactly that SHA. Editing the comment later invalidates it.

## One-time consumption

The proof file remains at `PRODUCTION_BACKUP_ATTESTATION_FILE` or the existing deployment fallback. A sibling `${proof}.state` directory, owned by the deployment user and private mode `0700`, contains create-only `issued`, `consumed`, and `archived` records. Proofs and records are written with mode `0600`, fsync, and atomic no-replace hard-link creation. Any symlink, malformed state, owner/mode mismatch, collision, or incomplete record blocks the gate.

The early deploy workflow gate is read-only: while holding the server `.deploy.lock`, it snapshots the live production SHA and verifies the proof and target SHA without consuming it. The final `deploy-production-git.sh` process receives that exact snapshot, acquires the exclusive server lock, and validates the live production SHA with its compare-and-swap guard. Any intervening change makes the CAS fail before proof consumption. Only after that succeeds does it call the candidate release's gate script to consume schema v3, while the same lock remains held through the database phase and atomic switch. The consumed record binds the exact deploy SHA, workflow run ID and attempt, approval comment, approver, attestation UUID, and proof SHA-256. A workflow retry, even with the same run ID and a new attempt, is rejected. A second run cannot reuse the proof. Schema v1 and v2 remain on their existing verification paths and do not create v3 consumption records.

## Failed or interrupted deployment

Consumption is irreversible. If deployment fails after consumption, do not delete or edit the marker and do not retry that proof. Obtain a new written approval for the exact SHA and run the signer again. If the old proof was consumed, the signer preserves it and its marker under the private `archived` directory and writes an audit record before creating the new proof. If an old proof is still unexpired and unused, or is malformed/unknown, replacement is refused. A partial archive/issue operation also fails closed; do not repair it by deleting files. Escalate to a separately reviewed, audited server recovery procedure.

The signer workflow itself only creates proof state; it never deploys, migrates, edits the database, resets consumption, or modifies the Version API. Production deployment remains a separate, normally protected `deploy.yml` dispatch with `db_mode=skip-db` when appropriate and the existing Production Environment approval.
