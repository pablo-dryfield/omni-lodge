# OmniLodge Project Instructions

## Production deployment

- Never run `npm run build`, `craco build`, or another UI bundle-generation command on the production host.
- Production deployments use the immutable GitHub Actions release artifact built from the trusted `master` SHA. Do not deploy by fast-forwarding a Git checkout and using committed `ui/build` files.
- `ui/build` is generated output for local development, local validation, and CI release packaging only. Do not commit generated UI build files.
- Backend `dist` and other backend generated artifacts must also never be committed.
- For UI changes, rely on the release workflow to build, stamp, validate, package, and deploy the exact artifact. If a local UI build is needed for testing, keep it untracked.
- Restart order is handled by the deployment workflow/host control plane: backend readiness and migrations are verified before public UI activation.
- Do not delete, replace, or build over any live production release directory outside the GitHub Actions deployment flow.
