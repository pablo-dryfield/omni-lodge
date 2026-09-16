# OmniLodge release packager

These scripts create and verify the single application artifact described in
`docs/github-actions-release-roadmap.md`. Packaging and diagnostic verification
use only Node.js built-ins and work on Linux, macOS, and Windows. Production
extraction and activation are Ubuntu-only security operations: their complete
owner, mode, `O_NOFOLLOW`, fixed-root, and locking guarantees are POSIX host
invariants, not Windows deployment claims.

## Build the archive

The packager consumes outputs that have already been built and validated:

- `be/dist/**`
- `ui/build/**`
- the backend monitored launcher and package metadata
- the three badge source assets required at runtime
- the UI server runtime modules and package metadata

It deliberately excludes application source outside those build trees,
`node_modules`, environment and credential files, SSH/TLS key material,
database/backup files, uploads, logs, and runtime state. A forbidden file
inside an included build tree fails packaging instead of being silently
ignored.

Run the same recursive producer-tree policy before each intermediate artifact
is uploaded. Only these two literal roots are accepted:

```bash
node scripts/release/preflight.mjs --path be/dist
node scripts/release/preflight.mjs --path ui/build
```

Preflight rejects missing runtime entrypoints, non-regular files, symbolic-link
or junction traversal (including linked ancestors), forbidden names, and size
limit violations. CLI options are exact and single-use; unknown options,
duplicates, positional arguments, and `--option=value` syntax fail closed.

The UI build must contain these exact release credentials:

```json
{
  "schemaVersion": 1,
  "releaseId": "omnilodge-r<run>-a<attempt>-<sha12>",
  "gitSha": "<lowercase-full-40-character-sha>"
}
```

No additional keys are accepted. The metadata must match the combined release
manifest, while both the hashed main bundle and `service-worker.js` must embed
the exact release ID as a JavaScript string literal. Packaging also requires
all backend runtime entrypoints and the UI shell, asset manifest, web manifest,
manifest selector, service worker, and release metadata; a partially built
artifact is rejected.

The release workflow should build the UI with that release ID and SHA, then run
`scripts/ci/validate-ui-build.mjs --stamp` with the same values before invoking
this packager.

GitHub Actions supplies the standard `GITHUB_*` variables and the workflow
path explicitly:

```bash
RELEASE_WORKFLOW_PATH=.github/workflows/release.yml \
RELEASE_BUILT_AT_UTC=2026-09-14T12:34:56.000Z \
node scripts/release/package.mjs --output-dir release-output
```

The output directory is mandatory (through `--output-dir` or
`RELEASE_OUTPUT_DIR`) so a local invocation cannot accidentally leave release
artifacts in the repository root.

`RELEASE_BUILT_AT_UTC` should be calculated once per release job and reused.
The default is the current time for local diagnostics. The release ID defaults
to this stable form:

```text
omnilodge-r<GITHUB_RUN_ID>-a<GITHUB_RUN_ATTEMPT>-<first-12-of-GITHUB_SHA>
```

Packaging never overwrites an archive or checksum with the same release ID.
Temporary files are fsynced and published with atomic, no-replace hard links;
the archive name appears last as the completed-publication marker. Output paths
that overlap an input tree or resolve through a link/junction are rejected.
It produces:

```text
<release-id>.tar.gz
<release-id>.tar.gz.sha256
```

The gzip stream, tar headers, ordering, permissions, owners, and timestamps are
canonical. For identical byte inputs and declared metadata on the pinned,
authoritative Ubuntu release runner, the packager produces identical archive
bytes. Other platforms remain useful for local checks, but are not claimed as
the authority for cross-platform byte reproducibility.

Packaging and verification share these fail-closed resource ceilings:

- 128 MiB per payload file
- 20,000 payload files
- 512 MiB total payload data
- 8 MiB release manifest
- 576 MiB uncompressed archive
- 512 MiB compressed archive
- 100,000 total tar entries (files plus directories)

## Manifest and trust boundary

`release-manifest.json` is inside the release root. It records the schema,
release/source identity, UTC build time, pinned Node/npm pair, all three npm
lockfile hashes, main hashed UI asset, workflow provenance, and the size and
SHA-256 of every shipped payload file. The UI lockfile is a build input whose
hash is recorded; it is not shipped because browser dependencies are not
installed on the production host.

The manifest must be the exact canonical UTF-8 serialization produced by the
packager (two-space JSON indentation and one trailing newline). This byte-level
requirement removes duplicate-key and alternate-serialization ambiguity before
any manifest field is trusted.

The manifest marks an artifact as a production *candidate* only when its
repository, workflow path, event, ref, run identity, artifact name, and source
SHA describe a canonical `push` to `refs/heads/master`. Pull-request and branch
artifacts can still be inspected, but cannot pass production verification.

Integrity alone is not deployment authority. The trusted pre-deploy job must
obtain the workflow conclusion, immutable artifact ID, and `sha256:...` artifact
digest from GitHub's authenticated API. The digest authenticates the exact raw
ZIP returned by GitHub's REST artifact-download endpoint; it is deliberately
distinct from the detached SHA-256 of the inner `.tar.gz` release.

`scripts/deploy/github-release-evidence.mjs` emits canonical schema-v2 evidence
with an explicit `stage`, `dry-run`, or `deploy` operation. Manual staging and
dry-run evidence may be generated while `PRODUCTION_DEPLOY_MODE=disabled`, but
they never authorize activation. Automatic staging/dry-run is rejected, and a
forward deploy remains fail-closed under the disabled/manual/automatic matrix.
Protected-environment approval and the future root-owned host policy remain
separate controls; the evidence object is not, by itself, server authority.

## Verify an archive

Integrity-only verification checks the detached checksum, safe tar structure,
fixed owner/mode/time metadata, exact allowlist, manifest schema, and every
internal file hash. It then reproduces the canonical archive and requires an
exact byte-for-byte match:

```bash
node scripts/release/verify.mjs \
  --archive release-output/<release-id>.tar.gz
```

Production verification additionally requires authenticated provenance:

```bash
node scripts/release/verify.mjs \
  --archive release-output/<release-id>.tar.gz \
  --require-production-eligible \
  --workflow-conclusion success \
  --artifact-id <immutable-github-artifact-id> \
  --artifact-digest sha256:<authenticated-raw-artifact-zip-sha256> \
  --expected-release-id <release-id> \
  --expected-source-sha <full-40-character-sha> \
  --expected-repository pablo-dryfield/omni-lodge \
  --expected-workflow-path .github/workflows/release.yml \
  --expected-event push \
  --expected-ref refs/heads/master \
  --expected-run-id <github-run-id> \
  --expected-run-attempt <github-run-attempt> \
  --expected-artifact-name <release-id>
```

The artifact ID, name, and digest must be read together from GitHub's
authenticated artifact API response for the specified run. They are not
operator-entered labels and must not be inferred from an archive filename.
Event, ref, run ID, run attempt, repository, workflow path, source SHA, release
ID, artifact name, digest, and successful conclusion are independently matched
before the artifact can pass this gate.

## Verified production extraction

Production uses two bound extraction stages:

1. `scripts/deploy/extract-github-artifact.mjs` hashes the raw REST ZIP and
   matches the authenticated GitHub digest before accepting its exact two root
   files: `<release-id>.tar.gz` and its detached checksum. It returns the
   separately calculated inner archive SHA-256 in a canonical schema-v2
   handoff.
2. `scripts/release/extract.mjs` requires that trusted inner digest through
   `--expected-archive-sha256`, reopens the archive and checksum with bounded
   descriptor-based reads, checks the digest before decompression, performs the
   full canonical manifest/payload verification, and publishes the immutable
   release directory.

The root-owned deployment wrapper must compose these stages from fixed,
permission-restricted roots and pass the first stage's digest directly to the
second. Never expose either CLI directly through unrestricted sudo or SSH, and
never accept an expected digest or activation decision supplied by a caller.
Failed extraction residue and its reservation are intentionally preserved for
operator inspection and trusted cleanup instead of being recursively deleted
through a potentially replaced path.

The inner extraction command therefore includes:

```bash
node scripts/release/extract.mjs \
  --archive <trusted-staging>/<release-id>.tar.gz \
  --expected-archive-sha256 <trusted-inner-archive-sha256> \
  --releases-directory <fixed-root-owned-release-directory> \
  --workflow-conclusion success \
  --artifact-id <immutable-github-artifact-id> \
  --artifact-digest sha256:<authenticated-raw-artifact-zip-sha256> \
  --expected-release-id <release-id> \
  --expected-source-sha <full-40-character-sha> \
  --expected-repository pablo-dryfield/omni-lodge \
  --expected-workflow-path .github/workflows/release.yml \
  --expected-event push \
  --expected-ref refs/heads/master \
  --expected-run-id <github-run-id> \
  --expected-run-attempt <github-run-attempt> \
  --expected-artifact-name <release-id>
```

## Tests

```bash
node --test \
  scripts/release/release.test.mjs \
  scripts/deploy/github-release-evidence.test.mjs \
  scripts/deploy/extract-github-artifact.test.mjs
```

The suites cover byte-for-byte determinism, canonical production evidence,
branch-artifact rejection, the raw-ZIP/inner-archive trust chain, detached and
internal tampering, path-swap and traversal defense, secret-file rejection,
immutable output naming, and fail-closed operation-mode selection. Required
Linux CI runs all three suites so POSIX ownership and mode assertions are not
hidden by Windows skips.
