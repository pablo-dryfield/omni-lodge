# New Counter companion PWA

The counter launcher is a separate PWA at `https://counter.omni-lodge.com`.
It uses a separate origin because the main OmniLodge PWA already owns the `/`
scope on `https://omni-lodge.com`. This lets Chrome install **New Counter** as a
separate home-screen app even when OmniLodge and New Transaction are installed.

## Production prerequisite

Create this proxied Cloudflare DNS record before deploying the UI change:

- Type: `CNAME`
- Name: `counter`
- Target: `omni-lodge.com`
- Proxy status: Proxied

The existing UI server accepts the additional host and the origin certificate
must cover `*.omni-lodge.com`.

## Runtime behavior

- The counter origin always advertises the New Counter manifest.
- Its manifest scope is `/`, so login and client-side navigation remain inside
  the standalone window.
- It registers the same service-worker build independently on the counter origin.
- Browser storage and the service worker remain origin-isolated.
- API requests go to `https://omni-lodge.com/api` with credentials. The backend
  explicitly allows `https://counter.omni-lodge.com` as a production CORS origin.
- The main OmniLodge manifest also exposes **Create counter** as a regular app
  shortcut for browsers that support manifest shortcuts.

## Verification

1. Confirm `https://counter.omni-lodge.com/counters/new-counter/install.html`
   loads over HTTPS.
2. Open Counters and tap **Install counter app**.
3. Confirm Chrome offers **New Counter** as a separate installation.
4. Launch the new icon and confirm `/counters?mode=create&pwa=new-counter`
   opens the create-counter dialog.
5. Confirm an authorized signed-in user can create a counter, while the existing
   counter permissions continue to guard unauthorized users.
