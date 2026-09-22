# Production host state primitives

These modules are an inert foundation for the root-owned deployment worker.
They do not receive network input, invoke application commands, call PM2 or
systemd, run migrations, or change release pointers.

The default paths are fixed in `constants.mjs`. Production callers must use
those defaults. Constructor injection exists so the primitives can be tested
without touching host state; it is not a configuration interface for the
deployed wrapper.

Security properties:

- every managed POSIX ancestor is checked twice for a stable device/inode,
  root ownership, absence of group/world write permission, and absence of
  symbolic links;
- immutable state is published through an exclusive `0600` temporary file,
  file `fsync`, no-replace hard-link publication, parent-directory `fsync`,
  verified cleanup, and another parent-directory `fsync`;
- request IDs are bound to protocol v2's `requestSha256`, the SHA-256 of the
  complete canonical request document; exact replay is idempotent, while a
  request-ID/full-digest collision fails closed;
- forward and rollback admissions persist the exact canonical state produced
  by `scripts/deploy/host/state.mjs`; status queries intentionally create no
  deployment state;
- activation state is split into immutable snapshot files, one replaceable
  active-snapshot pointer file, and request-bound transaction files. Preparing
  an activation is idempotent and recovery-plannable, but it does not by
  itself change PM2, release pointers, traffic, or database state. Activation
  transaction phase transitions are durably replaced with the same request and
  snapshot binding before any future pointer-switching code can rely on them;
- activation pointer switching is isolated in a standalone module that can
  atomically replace the reviewed `backend-current` and `ui-current` symlinks,
  but the deployment worker does not call it until PM2 restart, readiness,
  public smoke, and recovery gates are wired;
- public smoke verification is isolated in a standalone module that checks the
  public API health, UI artifact identity, public source-map denial, and
  companion PWA entry points for a target release, but the deployment worker
  does not call it until pointer switching, PM2 restart, and recovery behavior
  are wired;
- legacy-baseline capture hashes the current Git source SHA, UI build tree,
  and PM2 dump into the first active snapshot. It records only bounded
  digests and restore paths, not application secrets or file contents;
- state transitions use no-replace hard links between directories on the same
  filesystem, followed by durable removal of the old link. An interrupted
  transition leaves two links to the same inode and is recognized as a
  recoverable advanced state, never as two unrelated requests;
- audit events are bounded one-write NDJSON entries with host-generated time
  and the authenticated transport key label; and
- capacity admission uses exact bigint arithmetic and requires explicit byte
  and inode estimates for every retained or temporary allocation class.

Capacity is evaluated per filesystem. If fixed roots reside on different
devices, the caller must group allocations by device and require every device's
admission to pass; free bytes or inodes must never be pooled across mounts.

Node core does not expose POSIX `flock(2)`. `withDeploymentFlock()` therefore
requires an injected native adapter with non-blocking exclusive acquire and
release methods. It deliberately never shells out to `flock`. The production
entry point must supply a reviewed adapter (or inherit and verify a lock held
by a root-owned launcher) before this scaffold is activated.

`protocol-v2.mjs`, `state.mjs`, and their protocol dependencies are trusted
control-plane code. Installation must place them with these modules beneath a
root-owned immutable library tree. They must never be imported from a candidate
release or a mutable current-release pointer.
