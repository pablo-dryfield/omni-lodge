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

- Codex Cloud implementation, fix, refactor, and documentation-change tasks must use a same-repository branch named `codex/<short-kebab-description>` based on the latest `origin/master`, then open a pull request into `master`. Do not commit directly to `master`.
- The GitHub automation is intentionally scoped to this structure: CI runs on pushes to `codex/**`, and same-repository `codex/*` pull requests into `master` are eligible for squash auto-merge after required checks pass.
- Before opening the PR, run relevant local checks for the touched areas and include the exact commands/results in the PR description or final task summary. Use `.github/workflows/ci.yml` as the source of truth for the full CI matrix:
  - backend changes: `npm --prefix be run check` and `npm --prefix be test -- --runInBand`;
  - UI changes: `npm --prefix ui run check` and `CI=true npm --prefix ui test -- --watchAll=false`;
  - UI server changes: `npm --prefix ui-server test`;
  - release/deploy/ops changes: run the relevant `node --test ...` suite from the `CI / release tooling` job;
  - docs-only changes: at minimum run `git diff --check`.
- If a check cannot run in Codex Cloud, do not hide it. Report the exact command, failure/blocker, and why the PR is still safe for GitHub Actions to validate.
- PRs should be ready for review/merge, not draft, unless the task is intentionally incomplete or blocked. Keep PRs focused and do not commit generated outputs such as `ui/build` or `be/dist`.
- A pull request is not complete until the branch has been pushed to the repository remote and the remote provider confirms a real, open PR URL. The `make_pr` helper may only prepare PR metadata; do not treat its response alone as proof that a GitHub PR exists. If `origin` is missing, restore it from the authenticated repository context, push the `codex/*` branch, create the PR, and verify its URL/state with `gh pr view` (or the equivalent provider API) before reporting completion.
- Read-only investigation/report tasks do not need a branch or PR unless they produce repository file changes.
- Codex Cloud production access is intentionally read-only by default. Use the Cloudflare Access-protected HTTPS production read connector with `scripts/codex/query-production-read-api.sh` when production database context is needed.
- The production read connector is configured through Codex Cloud environment secrets/variables; never commit connector bearer tokens, Cloudflare Access service-token credentials, SSH keys, database passwords, generated `.env` files, or copied production data.
- Use `scripts/codex/query-production-read-api.sh health` to verify production read access from Codex Cloud. The helper uses `PROD_READ_API_URL`, `PROD_READ_API_TOKEN`, `CLOUDFLARE_ACCESS_CLIENT_ID`, and `CLOUDFLARE_ACCESS_CLIENT_SECRET`.
- Local production-read access on Pablo's Windows machine is configured through the same Cloudflare Access-protected HTTPS connector. The private values are stored outside the repo in `%USERPROFILE%\.omnilodge-codex-cloud` (`prod-read-api-url`, `prod-read-api-token`, `cloudflare-access-client-id`, `cloudflare-access-client-secret`). Use these local files when a local investigation needs production data, but never print or commit their contents.
- When calling the HTTPS production read connector from local Python or custom tools, send a normal curl-style `User-Agent`; Cloudflare may block Python's default user agent with error `1010` before the request reaches the connector.
- The legacy `scripts/codex/open-production-db-tunnel.sh check` SSH tunnel helper is only a local/trusted-environment fallback when direct SSH is reachable. Raw SSH to production is not the expected Codex Cloud path.
- If Codex Cloud reports `ssh: connect to host 23.95.192.213 port 22: Network is unreachable`, treat it as a known raw-SSH network-route limitation. Do not expose PostgreSQL directly; use the HTTPS/443 production read connector instead.
- Production deployments should still happen through the GitHub Actions release/deploy workflow. Do not SSH into production from Codex Cloud for deploys unless a future task explicitly provisions and authorizes that maintenance path.
