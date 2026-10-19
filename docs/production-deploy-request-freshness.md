# Production deploy request freshness

The host rejects request timestamps older than five minutes (and more than one
minute in the future). Keep this security guard; runner queue time and production
environment approval time must not consume the request's validity window.

## Deployment flow

- The prepare job validates the trusted Release run, canonical master SHA,
  immutable artifact identity/digest, deployment mode, trigger, and operation. It
  uploads the canonical release evidence and original GitHub artifact ZIP, not a
  timestamped host request.
- After the protected submit job starts, downloads those inputs, and prepares
  pinned SSH transport, it generates a fresh UUID/timestamp and creates and
  submits the host request in the same step. Request creation verifies that the
  ZIP matches the validated evidence; release trust checks are not bypassed.
- A host `rejected` or `failed` response makes the submission CLI exit nonzero
  and prints the host's original response code/message. Polling starts only
  after successful submission. The CLI still writes the structured response for
  audit; the low-level status-query API retains its existing retry semantics.
- The response artifact retains the actual request identity, creation result,
  submission response, and any polling result for three days.

## Recovery

For runs using this flow, rerunning the failed submit job creates a fresh request
from the same trusted release inputs. Never automatically resubmit after an
ambiguous SSH disconnect: first check whether the original request was accepted
or is still running, and check the live release identity.

For older workflow runs that uploaded a timestamped request, rerunning only the
failed job reuses the expired timestamp. Start a new deployment workflow from
current `master` using a successful immutable Release artifact instead. Do not
deploy a branch artifact or build on production.

On 2026-10-19, Production Deploy Request run `39285128736` prepared its request
around 18:24 Warsaw time but only submitted it around 18:38. The host returned
`REQUEST_TIMESTAMP_REJECTED` before creating durable request state. The old CLI
treated successful SSH transport as successful submission and polled a nonexistent
request until a later SSH reset obscured the original rejection. Regression tests
cover the queue boundary, fresh identity generation, rejection exit status, and
retained audit evidence.
