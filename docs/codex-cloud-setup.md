# Codex Cloud setup

This repo is ready to use from Codex Cloud without relying on Pablo's local machine. Cloud work should happen through GitHub branches and pull requests, with production deployment handled by the existing GitHub Actions release/deploy flow.

## What to configure in Codex Cloud

Create a Codex Cloud environment for the OmniLodge GitHub repo and add these values.

Use this setup script. Codex Cloud secrets are available during setup, then removed before the agent phase, so this script stores production-read credentials in private files that the repo helpers can use later. The HTTPS read connector is the primary production-inspection path; the raw SSH tunnel credentials are optional legacy fallback values only.

```bash
set -e
apt-get update
apt-get install -y curl openssh-client postgresql-client
npm ci --prefix be
npm ci --prefix ui
npm ci --prefix ui-server

install -d -m 700 "$HOME/.omnilodge-codex-cloud"

persist_required_value() {
  secret_name="$1"
  target_name="$2"
  if [ -z "${!secret_name:-}" ]; then
    echo "Missing required Codex Cloud value: $secret_name" >&2
    exit 2
  fi
  printf '%s\n' "${!secret_name}" > "$HOME/.omnilodge-codex-cloud/$target_name"
  chmod 600 "$HOME/.omnilodge-codex-cloud/$target_name"
}

persist_optional_value() {
  secret_name="$1"
  target_name="$2"
  if [ -z "${!secret_name:-}" ]; then
    return 0
  fi
  printf '%s\n' "${!secret_name}" > "$HOME/.omnilodge-codex-cloud/$target_name"
  chmod 600 "$HOME/.omnilodge-codex-cloud/$target_name"
}

persist_optional_value PROD_READ_API_URL prod-read-api-url
persist_required_value PROD_READ_API_TOKEN prod-read-api-token
persist_required_value CLOUDFLARE_ACCESS_CLIENT_ID cloudflare-access-client-id
persist_required_value CLOUDFLARE_ACCESS_CLIENT_SECRET cloudflare-access-client-secret

# Optional legacy SSH tunnel fallback. These are not required for the preferred
# Cloudflare Access HTTPS read connector.
persist_optional_value PROD_DB_TUNNEL_SSH_PRIVATE_KEY prod-db-tunnel-key
persist_optional_value PROD_DB_READER_PASSWORD prod-db-reader-password
persist_optional_value PROD_SSH_KNOWN_HOSTS known_hosts
```

Use the same dependency commands in the maintenance script, but do not rely on secrets being present there:

```bash
set -e
apt-get update
apt-get install -y curl openssh-client postgresql-client
npm ci --prefix be
npm ci --prefix ui
npm ci --prefix ui-server
```

### Secrets

Add these as secrets, not regular variables. The first three are required for the preferred Codex Cloud production-read path:

| Secret | Source |
| --- | --- |
| `PROD_READ_API_TOKEN` | The random bearer token configured on the production read connector as `CODEX_READ_CONNECTOR_TOKEN`. |
| `CLOUDFLARE_ACCESS_CLIENT_ID` | Cloudflare Access service token client ID for the production read connector app. |
| `CLOUDFLARE_ACCESS_CLIENT_SECRET` | Cloudflare Access service token client secret for the production read connector app. |
| `PROD_DB_READER_PASSWORD` | Optional legacy SSH-tunnel fallback. Copy the contents of `.tmp/codex-cloud/prod_db_reader_password.txt` from the local setup machine only if the fallback tunnel is needed. |
| `PROD_DB_TUNNEL_SSH_PRIVATE_KEY` | Optional legacy SSH-tunnel fallback. Copy the full contents of `.tmp/codex-cloud/omnilodge_codex_db_tunnel_ed25519` from the local setup machine only if the fallback tunnel is needed. |

Do not paste these values into commits, issue comments, PR descriptions, logs, or chat messages.

Codex Cloud currently removes secrets before the agent phase. The setup script above intentionally copies production-read secrets into private files inside the container so Codex can use the HTTPS read connector after setup. Treat this environment as production-read-capable even though the connector, Cloudflare Access service token, and database role are restricted.

### Variables

Add these as environment variables:

| Variable | Value |
| --- | --- |
| `PROD_READ_API_URL` | `https://codex-read.omni-lodge.com` |

The following values are optional legacy SSH-tunnel fallback values. Keep them only if you still want local/trusted environments to use `scripts/codex/open-production-db-tunnel.sh`:

| Variable | Value |
| --- | --- |
| `PROD_SSH_HOST` | `23.95.192.213` |
| `PROD_DB_TUNNEL_USER` | `omnilodge-codex-db-tunnel` |
| `PROD_SSH_KNOWN_HOSTS` | `23.95.192.213 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINvpE9zgo5c5HU8WcNb74IOPmX/BZ8cYfEJnTaWNQtd/` |
| `PROD_DB_REMOTE_HOST` | `127.0.0.1` |
| `PROD_DB_REMOTE_PORT` | `5432` |
| `PROD_DB_LOCAL_HOST` | `127.0.0.1` |
| `PROD_DB_LOCAL_PORT` | `15432` |
| `PROD_DB_NAME` | `omni_lodge_db` |
| `PROD_DB_READER_USER` | `codex_cloud_reader` |

## Preferred production DB read access from Codex Cloud

Codex Cloud should use the HTTPS/443 read connector when production DB context is needed. This avoids exposing PostgreSQL and avoids raw SSH, which is not reliably routable from Codex Cloud.

The helper is:

```bash
scripts/codex/query-production-read-api.sh health
scripts/codex/query-production-read-api.sh tables
scripts/codex/query-production-read-api.sh describe public error_monitoring_issues
scripts/codex/query-production-read-api.sh report open-error-issues '{"statuses":["open","investigating"],"limit":25}'
```

The helper sends:

- the Cloudflare Access service token headers;
- the connector's own `Authorization: Bearer ...` token.

The connector itself:

- listens only on `127.0.0.1`;
- connects as `codex_cloud_reader`;
- wraps every DB operation in a read-only transaction;
- applies statement, lock, row, response-size, and rate limits;
- exposes only health/schema endpoints, predefined reports, and optional allowlisted row reads;
- logs operation metadata only, not DB passwords, bearer tokens, or result values.

### Production connector process

The backend release artifact contains the connector at:

```bash
/opt/omnilodge/backend-current/dist/scripts/productionReadConnector.js
```

Run it as a separate process from the main backend, with a private env file such as `/etc/omnilodge/codex-read-connector.env`:

```bash
CODEX_READ_CONNECTOR_HOST=127.0.0.1
CODEX_READ_CONNECTOR_PORT=3019
CODEX_READ_CONNECTOR_TOKEN=<random-long-secret>
CODEX_READ_DB_HOST=127.0.0.1
CODEX_READ_DB_PORT=5432
CODEX_READ_DB_NAME=omni_lodge_db
CODEX_READ_DB_USER=codex_cloud_reader
CODEX_READ_DB_PASSWORD=<codex_cloud_reader_password>
CODEX_READ_CONNECTOR_MAX_ROWS=100
CODEX_READ_CONNECTOR_MAX_RESPONSE_BYTES=262144
CODEX_READ_CONNECTOR_STATEMENT_TIMEOUT_MS=5000
CODEX_READ_CONNECTOR_LOCK_TIMEOUT_MS=1000
CODEX_READ_CONNECTOR_RATE_LIMIT_PER_MINUTE=60
# Optional. Empty means /tables/read is disabled.
CODEX_READ_CONNECTOR_ALLOWED_TABLES=public.error_monitoring_issues
```

Example runtime command:

```bash
cd /opt/omnilodge/backend-current
node --env-file=/etc/omnilodge/codex-read-connector.env --enable-source-maps dist/scripts/productionReadConnector.js
```

### Cloudflare Tunnel + Access

Create a Cloudflare Tunnel on the production host and publish only the connector's loopback origin:

```text
Public hostname: codex-read.omni-lodge.com
Service URL: http://127.0.0.1:3019
```

Then create a Cloudflare Access self-hosted application for that hostname and allow only the Codex Cloud service token. Store the Access client ID/secret in Codex Cloud as secrets.

Keep PostgreSQL bound to localhost/private networking. Do not expose port 5432 publicly.

## Verifying production DB read-only access

From a Codex Cloud shell:

```bash
scripts/codex/query-production-read-api.sh health
scripts/codex/query-production-read-api.sh report open-error-issues '{"limit":10}'
```

Expected health output includes:

```json
{"ok":true,"service":"codex-production-read-connector"}
```

The legacy SSH tunnel helper remains useful from a local or trusted environment that can reach production SSH:

```bash
scripts/codex/open-production-db-tunnel.sh check
```

Expected output:

```text
Production DB tunnel open on 127.0.0.1:15432.
Read-only production DB check succeeded:
codex_cloud_reader
omni_lodge_db
```

### If Codex Cloud cannot reach SSH

If the check fails with:

```text
ssh: connect to host 23.95.192.213 port 22: Network is unreachable
```

then the secrets were accepted and the failure is the transport route, not the
database credentials. Direct SSH to the production host is not currently a
reliable Codex Cloud access path, even after enabling agent internet access and
testing with an unrestricted domain allowlist.

Do not expose PostgreSQL directly to the internet to work around this. The
Cloudflare Tunnel/Access protected HTTPS read connector already exists for Codex
Cloud and should be used instead:

```bash
scripts/codex/query-production-read-api.sh health
```

To stop the tunnel:

```bash
scripts/codex/open-production-db-tunnel.sh stop
```

## How cloud work should flow

1. Start a Codex Cloud task against this repository.
2. For implementation, fix, refactor, or documentation-change tasks, create a same-repository branch from latest `origin/master` named `codex/<short-kebab-description>`.
3. Make the requested changes on that branch. Do not commit generated outputs such as `ui/build` or `be/dist`.
4. Run the relevant local checks in the cloud environment and record the commands/results:
   - backend changes: `npm --prefix be run check` and `npm --prefix be test -- --runInBand`;
   - UI changes: `npm --prefix ui run check` and `CI=true npm --prefix ui test -- --watchAll=false`;
   - UI-server changes: `npm --prefix ui-server test`;
   - release/deploy/ops changes: run the relevant `node --test ...` suite from `.github/workflows/ci.yml`;
   - docs-only changes: at minimum run `git diff --check`.
5. Commit, push the `codex/*` branch, and open a pull request into `master`. The PR should be ready for review/merge, not draft, unless the task is intentionally incomplete or blocked.
6. Include the implementation summary and check results in the PR description or final Codex Cloud task summary.
7. Let GitHub Actions validate. Same-repository `codex/*` PRs into `master` are eligible for squash auto-merge when green, and production deployment is handled from `master`.

The CI and auto-merge workflows depend on this naming convention:

- `.github/workflows/ci.yml` runs on pushes to `codex/**` and pull requests into `master`.
- `.github/workflows/auto-merge.yml` enables auto-merge only for same-repository pull requests whose head branch starts with `codex/`.

The cloud environment should not deploy by copying files to production. Production deploys are handled by the immutable release artifact built by GitHub Actions.

## Production DB access model

The production host now has:

- HTTPS production read connector
  - served through Cloudflare Tunnel public hostname `codex-read.omni-lodge.com`;
  - protected by a Cloudflare Access self-hosted application and service token;
  - backed by the connector's own `Authorization: Bearer ...` token;
  - loopback origin only: `http://127.0.0.1:3019`;
  - preferred for all Codex Cloud production data inspection.
- PostgreSQL role `codex_cloud_reader`
  - login enabled;
  - default transaction read-only;
  - `CONNECT` to `omni_lodge_db`;
  - `USAGE` on `public`;
  - `SELECT` on current public tables and sequences;
  - default privileges for future public tables and sequences created by the app DB owner.
- Linux SSH user `omnilodge-codex-db-tunnel`
  - password login locked;
  - key-only access;
  - restricted authorized key;
  - only allowed to forward to `127.0.0.1:5432`.

If Codex Cloud needs additional production access later, add it deliberately as a new secret/variable and document the access boundary here.
