# Production Managed-Release Rollback Runbook

Status: current rollback authority is the GitHub Actions `Production Rollback Request` workflow plus the root-owned host v2 control plane. Rollback is manual in every deployment mode, including `manual`, `automatic`, and emergency `disabled`.

Use this runbook only after production has already cut over to at least one Actions-built managed release. The legacy-baseline snapshot exists as historical evidence and an emergency fallback, but normal rollback should target a retained managed-release snapshot.

## What rollback does

Rollback submits a host v2 `rollback_submit` request. It does not upload or build an artifact. The host verifies that:

1. the expected active snapshot still matches production;
2. the requested target snapshot exists in root-owned host state;
3. PM2, release pointers, public smoke checks, and activation-state commit can complete safely.

The host never runs migration `down` automatically. If a bad release already ran an incompatible database migration, treat rollback as an incident-response decision, not a routine button click.

## Choose snapshot references

Snapshot references are formatted as:

```text
activationId:snapshotSha256
```

On the production host, the active snapshot is:

```text
/var/lib/omnilodge/deploy/state/active-activation-snapshot.json
```

Retained target snapshots are stored in:

```text
/var/lib/omnilodge/deploy/state/*.activation-snapshot.json
```

For routine rollback:

1. Read the current active snapshot and copy its `reference.activationId` and `reference.snapshotSha256`. This becomes `expected_active_snapshot`.
2. Select the previous healthy managed-release snapshot and copy its `reference.activationId` and `reference.snapshotSha256`. This becomes `target_snapshot`.
3. Confirm the target snapshot points at managed release directories under `/opt/omnilodge/releases/...`, not the old `/root/omni-lodge/...` legacy checkout, unless a specific emergency decision intentionally requires the legacy baseline.
4. Confirm the release artifact represented by the target snapshot previously passed public smoke.

Do not create, edit, or copy snapshot files manually. They are host-owned activation records.

## Submit rollback

In GitHub Actions, run:

```text
Production Rollback Request
```

Inputs:

- `expected_active_snapshot`: the current active `activationId:snapshotSha256`.
- `target_snapshot`: the retained healthy target `activationId:snapshotSha256`.

The workflow must run from `master` in the canonical repository. The protected `production` environment approval still applies before the request can be submitted to the host.

## Verify result

After the workflow completes:

1. Confirm the rollback host request reached `REQUEST_SUCCEEDED`.
2. Check `/api/health/ready` and `/healthz`.
3. Confirm backend and UI release identities match the target snapshot's managed release.
4. Check the production error-monitoring dashboard for new fatal UI/server issues.
5. Record the workflow run ID, host request ID, expected active snapshot, target snapshot, and post-rollback health evidence in the incident notes or roadmap.

If the workflow fails before pointer switch, production should remain on the original active snapshot. If it fails after pointer switch, use the host request status and recovery phase to decide whether to retry the same rollback request, recover the interrupted activation, or escalate manually. Do not submit overlapping forward deploys or rollbacks while a request is pending/running.

## Emergency freeze behavior

`PRODUCTION_DEPLOY_MODE=disabled` freezes forward deployment. Explicit rollback remains available because rollback uses the separate `Production Rollback Request` workflow and still requires production-environment approval plus host-side validation.

Keep the mode disabled until the incident is understood, then restore the intended mode (`manual` for the current rollout stage).
