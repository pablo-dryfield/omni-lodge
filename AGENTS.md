# OmniLodge Project Instructions

## Production deployment

- Never run `npm run build`, `craco build`, or another UI bundle-generation command on the production host.
- Production deployments use the immutable GitHub Actions release artifact built from the trusted `master` SHA. Do not deploy by fast-forwarding a Git checkout and using committed `ui/build` files.
- `ui/build` is generated output for local development, local validation, and CI release packaging only. Do not commit generated UI build files.
- Backend `dist` and other backend generated artifacts must also never be committed.
- For UI changes, rely on the release workflow to build, stamp, validate, package, and deploy the exact artifact. If a local UI build is needed for testing, keep it untracked.
- Restart order is handled by the deployment workflow/host control plane: backend readiness and migrations are verified before public UI activation.
- Do not delete, replace, or build over any live production release directory outside the GitHub Actions deployment flow.

## Codex Cloud operating rules

- Codex Cloud work should use normal GitHub branches and pull requests. Do not depend on files that only exist on Pablo's local machine unless the task explicitly supplies them.
- Codex Cloud production access is intentionally read-only by default. Use the dedicated `codex_cloud_reader` database role through the restricted `omnilodge-codex-db-tunnel` SSH tunnel when production data inspection is needed.
- The production DB tunnel must be configured through Codex Cloud environment secrets/variables; never commit SSH keys, database passwords, generated `.env` files, or copied production data.
- Use `scripts/codex/open-production-db-tunnel.sh check` to open and verify the read-only production DB tunnel from a cloud environment when direct SSH is reachable.
- If Codex Cloud reports `ssh: connect to host 23.95.192.213 port 22: Network is unreachable`, treat it as a network-route limitation rather than a secret or database-password issue. Do not expose PostgreSQL directly; use a local/trusted environment or implement a separate HTTPS/443 protected production-read connector.
- Production deployments should still happen through the GitHub Actions release/deploy workflow. Do not SSH into production from Codex Cloud for deploys unless a future task explicitly provisions and authorizes that maintenance path.
