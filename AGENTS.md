# OmniLodge Project Instructions

## Production UI deployment

- Build the OmniLodge UI locally. Never run `npm run build`, `craco build`, or another UI bundle-generation command on the production host.
- Set one stable release identifier for the local build (for example through `REACT_APP_RELEASE`) and use the same identifier for the production UI-server release metadata.
- Run the relevant UI checks and tests locally before building.
- Commit the generated `ui/build` files to Git, push them to GitHub, and deploy those exact committed artifacts by fast-forwarding the production checkout. UI build artifacts are the only generated build output committed for deployment; never commit backend `dist` files or other generated backend artifacts.
- Confirm the intended `ui/build/index.html` and hashed assets are present in the commit before pulling it in production.
- Restart the backend before exposing UI changes that depend on new API behavior, then restart the UI server after the committed bundle is present.
- Do not delete, replace, or build over the live production `ui/build` directory outside the Git-based deployment flow.
