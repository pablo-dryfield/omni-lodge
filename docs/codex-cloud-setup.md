# Codex Cloud setup

This repo is ready to use from Codex Cloud without relying on Pablo's local machine. Cloud work should happen through GitHub branches and pull requests, with production deployment handled by the existing GitHub Actions release/deploy flow.

## What to configure in Codex Cloud

Create a Codex Cloud environment for the OmniLodge GitHub repo and add these values.

If the environment supports setup commands, make sure the base tools for DB inspection are present:

```bash
apt-get update && apt-get install -y openssh-client postgresql-client
```

### Secrets

Add these as secrets, not regular variables:

| Secret | Source |
| --- | --- |
| `PROD_DB_TUNNEL_SSH_PRIVATE_KEY` | Copy the full contents of `.tmp/codex-cloud/omnilodge_codex_db_tunnel_ed25519` from the local setup machine. |
| `PROD_DB_READER_PASSWORD` | Copy the contents of `.tmp/codex-cloud/prod_db_reader_password.txt` from the local setup machine. |

Do not paste these values into commits, issue comments, PR descriptions, logs, or chat messages.

### Variables

Add these as environment variables:

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

## Verifying production DB read-only access

From a Codex Cloud shell:

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

To stop the tunnel:

```bash
scripts/codex/open-production-db-tunnel.sh stop
```

## How cloud work should flow

1. Start a Codex Cloud task against this repository.
2. Create a branch and make the requested changes.
3. Run the relevant local checks in the cloud environment.
4. Open a pull request.
5. Let GitHub Actions validate, auto-merge when green, and deploy from `master`.

The cloud environment should not deploy by copying files to production. Production deploys are handled by the immutable release artifact built by GitHub Actions.

## Production DB access model

The production host now has:

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
