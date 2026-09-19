# OmniLodge host protocol and durable-state foundation

This directory defines the repository-side part of the production host
protocol. Protocol v1 remains frozen for compatibility in `protocol.mjs`.
Protocol v2 is a separate wire format in `protocol-v2.mjs`; v1 bytes are never
auto-detected or reinterpreted as v2. `deploy-policy.mjs`, `protocol-v2.mjs`,
and `state.mjs` are pure. The reusable `request-receiver.mjs` writes only a v1
or v2 forward artifact to a caller-supplied directory; it does not access
production configuration, invoke SSH, control PM2, run migrations, or activate
a release.

## Protocol v1 request frame

All integers are unsigned big-endian. A request is exactly:

| Offset | Size | Value |
| --- | ---: | --- |
| 0 | 8 | ASCII `OMNIHRQ1` |
| 8 | 2 | protocol version `1` |
| 10 | 2 | header size `32` |
| 12 | 4 | canonical audit JSON byte length |
| 16 | 4 | canonical schema-v2 evidence JSON byte length |
| 20 | 8 | raw GitHub artifact ZIP byte length |
| 28 | 4 | reserved, must be zero |
| 32 | variable | audit JSON, evidence JSON, then raw ZIP |

Each length is checked against its own limit before the payload is parsed. Audit
JSON is limited to 16 KiB, schema-v2 evidence to 64 KiB, and the raw artifact
ZIP to the release compressed-archive limit plus 64 MiB of ZIP-envelope margin.
The complete input must end after the declared ZIP length. Truncation and any
trailing byte fail closed.

Canonical JSON means UTF-8, two-space `JSON.stringify` formatting, the exact
documented property order, and one trailing newline. Re-serialization must
produce the exact original bytes, which rejects duplicate keys, alternate
formatting, and trailing content. Exact schemas also reject unknown fields.

The schema-v1 audit request contains a canonical lowercase UUID v4 request ID,
canonical UTC timestamp, bounded audit actor, operation and trigger, and the
SHA-256 of both the evidence bytes and raw ZIP. The host recomputes the hashes,
and the derived request identity also includes the SHA-256 of the complete
canonical audit bytes. Consequently, changing actor or timestamp changes the
identity used for response correlation and idempotency.
The operation and trigger must also equal the evidence values, and the ZIP hash
must equal the authenticated artifact digest inside the evidence. This binds
the request ID, evidence, artifact, operation, and trigger into one request.

The audit actor and timestamp are caller assertions. They are not independent
authentication and must not be used for authorization. The host must record its
own receipt time and authenticated transport/key identity alongside them.

`host-protocol-client.mjs` can return either one complete frame or four ordered
chunks (header, audit, evidence, ZIP) so a transport can avoid another full
frame copy. The receiver remains authoritative and validates every binding.

## Protocol v1 streaming receiver

Production callers should use `receiveHostRequestToFile()` from
`request-receiver.mjs`. It reads and validates the fixed header first, allocates
only the bounded audit and evidence documents, validates their cross-bindings,
and then streams the declared ZIP length through SHA-256 into a randomly named,
mode-`0600`, exclusively created file in a caller-supplied real directory. It
requires exact EOF and removes the partial file after truncation, trailing data,
digest mismatch, or another failure. A successful result owns the file until
the caller atomically moves it or calls the idempotent `cleanupArtifact()`.

`decodeHostRequestFrame()` remains useful for tests and already-small in-memory
frames, but it necessarily receives and copies the complete artifact. It must
not be the production transport path for maximum-sized requests.

The receiver deliberately does not own transport admission. Before invoking
it, the root wrapper must authenticate the forced SSH command, enforce a strict
connection/concurrency limit, reserve sufficient disk space, and attach a
wall-clock/read-idle deadline that closes the input on expiry. The artifact
directory must be root-owned and unavailable to the deploy account. These
controls must begin before reading a caller-declared body; a deployment `flock`
acquired only after upload does not prevent upload or slow-reader exhaustion.

## Protocol v2 request frame

Protocol v2 separates three exact request kinds:

- `forward_submit` carries canonical release evidence and one raw artifact
  ZIP. Its payload binds operation, trigger, evidence SHA-256, and raw ZIP
  SHA-256. `stage`, `dry-run`, and `deploy` retain the v1 release-evidence
  validation rules.
- `rollback_submit` is manual-only and artifact-free. It names both the
  expected current activation snapshot and the retained target snapshot by
  canonical UUID and canonical snapshot SHA-256. The compare-and-swap-style
  expected-current binding prevents a stale operator request from replacing a
  newer activation.
- `status_query` is artifact-free and names the durable submission request ID
  whose sanitized state should be returned.

All integers are unsigned big-endian. A v2 request is exactly:

| Offset | Size | Value |
| --- | ---: | --- |
| 0 | 8 | ASCII `OMNIHRQ2` |
| 8 | 2 | protocol version `2` |
| 10 | 2 | header size `32` |
| 12 | 4 | canonical v2 request JSON byte length |
| 16 | 4 | canonical schema-v2 release evidence byte length |
| 20 | 8 | raw GitHub artifact ZIP byte length |
| 28 | 4 | reserved, must be zero |
| 32 | variable | request JSON, evidence JSON, then raw ZIP |

The request document is bounded to 16 KiB. Evidence is bounded to 64 KiB and
the same v1 artifact limit applies. Forward requests require both evidence and
a non-empty ZIP. Rollback and status requests require both trailing lengths to
be exactly zero. Every decoder requires exact EOF. The request kind therefore
cannot be changed to smuggle an optional artifact into rollback or status.

The v2 request document is exact canonical JSON with property order:
`schemaVersion`, `requestId`, `requestedAtUtc`, `actor`, `kind`, `payload`.
Each kind has its own exact payload schema. Its SHA-256 is the request identity
digest. For forward requests the payload's evidence and ZIP digests transitively
bind the release identity. For rollback, it binds both activation snapshot
references. For status, it binds the subject request ID.

`receiveHostV2RequestToFile()` uses the bounded streaming path for forward
requests and creates no file for rollback or status. Callers must invoke the v2
entry point explicitly; the v1 entry point rejects the v2 magic and vice versa.

The workflow client exposes Buffer helpers for tests and small inputs, plus
`createHostV2ForwardRequestFileStream()` for production artifacts. The latter
opens a real, non-symlink file with no-follow semantics where available,
records its inode/device/size/change metadata, hashes it without buffering the
whole ZIP, rechecks the open file and path, then emits header, canonical
metadata, evidence, and bounded file chunks from the same open inode. It
computes the hash again while emitting and rechecks the file and path before
closing. Path swaps, truncation, growth, and in-place content changes fail
closed. A caller that does not consume the one-shot iterable must call its
idempotent `close()` method.

## Timestamp freshness and replay

`validateHostV2RequestFreshness()` compares the caller timestamp to the
host-recorded receipt time. A timestamp is accepted from exactly five minutes
in the past through exactly one minute in the future. These limits use server
receipt time, not the caller clock. Freshness is only one admission check: the
wrapper must still atomically reserve request ID plus request digest before
acknowledging it. Reusing an ID with different bytes is always rejected, and
semantic idempotency for a different ID remains a durable-state concern.

## Host deployment policy

The server-owned policy is exact canonical JSON:

```json
{
  "schemaVersion": 1,
  "deploymentMode": "disabled"
}
```

The only modes are `disabled`, `manual`, and `automatic`. The policy evaluator
reuses the release operation decision functions but evaluates the root-owned
mode independently. The `activationAuthorization` carried by GitHub evidence
is audit evidence and never substitutes for the host decision.

- Manual `stage` and `dry-run` requests are allowed in every host mode and do
  not authorize activation.
- Automatic `stage` and `dry-run` requests are invalid.
- `deploy` is denied in `disabled` mode.
- Manual `deploy` is allowed in `manual` and `automatic` modes.
- Automatic `deploy` is allowed only in `automatic` mode.

The v2 policy preserves that complete matrix for `forward_submit`. A
`rollback_submit` is manual-only at the schema boundary and is authorized in
all three forward modes, including `disabled`; an emergency freeze must not
remove the rollback escape hatch. Authenticated status queries are likewise
allowed in every mode. Policy authorization does not prove that a requested
snapshot exists: the worker must load its protected canonical snapshot, verify
the supplied digest, verify retention eligibility, and compare the current
snapshot before switching pointers.

## Protocol v1 response frame

A response is exactly:

| Offset | Size | Value |
| --- | ---: | --- |
| 0 | 8 | ASCII `OMNIHRS1` |
| 8 | 2 | protocol version `1` |
| 10 | 2 | header size `16` |
| 12 | 4 | canonical response JSON byte length |
| 16 | variable | canonical response JSON |

Responses repeat the request ID, release ID, operation, trigger, audit hash,
and evidence hash. The caller validates all six. The audit hash commits actor,
timestamp, operation, trigger, and both payload digests without reflecting
caller-controlled text into the response. Status, code, and message must be one of
the fixed definitions in `protocol.mjs`; callers cannot place exception text,
filesystem paths, environment values, or other internal details in a response.
The response also requires exact EOF.

## Protocol v2 response and status

The v2 response uses magic `OMNIHRS2`, version `2`, the same 16-byte response
header layout, and exact EOF. Its exact canonical document repeats request ID,
request kind, and request-document digest. Codes, top-level status, and messages
come only from the fixed definitions in `protocol-v2.mjs`; exception strings,
paths, environment values, and caller-controlled text cannot be reflected.

Only `STATUS_FOUND` may contain a status object. It exposes only subject request
ID/kind, lifecycle, phase, fixed terminal result code, and canonical update
time. `STATUS_NOT_FOUND` contains no object. The workflow client verifies the
response correlation fields and that a returned status belongs to the queried
subject.

## Durable request and activation state

`state.mjs` defines exact, canonical, bounded pure schemas. It performs no I/O;
the root worker must persist each state transition atomically and durably before
performing the next side effect.

- A request state stores the v2 request identity, immutable forward or rollback
  intent, receipt/update times, phase, and a fixed sanitized terminal result.
  The legal transition graph is intent-specific. A stage/dry-run cannot enter
  backup, migration, or activation phases; rollback cannot enter artifact or
  migration phases; and terminal states cannot transition.
- An activation snapshot binds activation ID, release/source identity,
  evidence and artifact hashes, activating request/time, and predecessor. Its
  reference is the SHA-256 of the exact canonical snapshot bytes. Retained
  rollback requests use these immutable references rather than artifact input.
- An activation transaction journals previous and target snapshot references
  and the pointer-switch phases. Its legal transitions force an uncertain or
  failed switch through convergence on the previous snapshot before the request
  can fail.

`planHostActivationRecovery()` is deterministic. Before a switch it aborts;
during or after an uncertain switch it converges both application pointers on
the previous snapshot; after verified smoke it commits the target; after a
completed restoration it marks the request failed. Every recovery plan returns
`databaseAction: "none"`. Neither rollback nor recovery has a migration-down
state or action. Database compatibility relies on expand/contract migrations.

The transition graph assumes the worker fsyncs the activation transaction in
`pointer_switching` before changing either pointer and fsyncs
`pointers_switched` afterward. Recovery deliberately restores the previous
snapshot when a crash makes the switch outcome uncertain. The future worker
must make pointer convergence idempotent and verify both resolved targets.

## Trust boundary

Canonical evidence proves internal consistency and binds the downloaded ZIP to
the digest recorded by the pre-deploy job. It is not signed evidence and does
not independently prove to the host that GitHub issued it. The authority is the
protected pre-deploy job plus the single authenticated forced-command key, with
the root-owned host policy as an independent activation gate. If host-side
provenance independent of that bearer credential is required, add a verified
GitHub artifact attestation or an authenticated host-side GitHub lookup.

The installed v1/v2 protocol, policy, evidence-validation helpers, state
schemas, and release constants are control-plane code. They must be installed
together below a root-owned immutable path and must never be imported through
the candidate release or a mutable `current` link.

## Remaining wrapper responsibilities

The future root-owned wrapper must read the fixed server-owned policy, apply
the v2 freshness helper, enforce replay/idempotency, serialize execution with a
host lock, persist detailed diagnostics only to protected host audit storage,
atomically persist the pure request/activation records, and compose verified
extraction/deployment through fixed roots. It must atomically reserve each
request ID together with the complete request digest; the same ID with
different bytes is always a rejection. It must also define semantic idempotency
for a new request ID naming an already processed release operation. Caller
timestamps supplement server receipt time; they cannot establish freshness by
themselves. The schemas and decisions are implemented here; filesystem
persistence, authenticated admission, locks, pointer changes, and application
execution are intentionally not.
