# OmniLodge host protocol foundation

This directory defines the repository-side part of the production host
protocol. `protocol.mjs` and `deploy-policy.mjs` are pure. The reusable
`request-receiver.mjs` writes only the received artifact to a caller-supplied
directory; it does not access production configuration, invoke SSH, control
PM2, run migrations, or activate a release.

## Request frame

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

## Streaming receiver

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

## Response frame

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

## Trust boundary

Canonical evidence proves internal consistency and binds the downloaded ZIP to
the digest recorded by the pre-deploy job. It is not signed evidence and does
not independently prove to the host that GitHub issued it. The authority is the
protected pre-deploy job plus the single authenticated forced-command key, with
the root-owned host policy as an independent activation gate. If host-side
provenance independent of that bearer credential is required, add a verified
GitHub artifact attestation or an authenticated host-side GitHub lookup.

The installed protocol, policy, evidence-validation helpers, and release
constants are control-plane code. They must be installed together below a
root-owned immutable path and must never be imported through the candidate
release or a mutable `current` link.

## Remaining wrapper responsibilities

The future root-owned wrapper must read the fixed server-owned policy, enforce
request replay/idempotency and acceptable timestamp age, serialize execution
with a host lock, persist detailed diagnostics only to protected host audit
storage, and compose verified extraction/deployment through fixed roots. It
must atomically reserve each request ID together with the complete audit digest;
the same ID with different bytes is always a rejection. It must also define
semantic idempotency for a new request ID that names an already processed
release/evidence/artifact operation. Caller timestamps supplement server receipt
time; they cannot establish freshness by themselves. Those stateful controls
are not implemented in this protocol foundation.
