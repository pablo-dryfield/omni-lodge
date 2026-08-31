# New Transaction companion PWA

The transaction launcher is a separate PWA at `https://transaction.omni-lodge.com`.
It must use a separate origin because the main OmniLodge PWA owns the `/` scope on
`https://omni-lodge.com`; Chrome will not install a second nested PWA after that
outer app is installed.

## Production prerequisite

Create this proxied Cloudflare DNS record before deploying the UI change:

- Type: `CNAME`
- Name: `transaction`
- Target: `omni-lodge.com`
- Proxy status: Proxied

The existing UI server accepts the additional host and the origin certificate
already covers `*.omni-lodge.com`.

## Runtime behavior

- The companion origin always advertises the New Transaction manifest.
- Its manifest scope is `/`, so login and client-side navigation remain inside
  the standalone window.
- It registers the same service-worker build independently on the companion
  origin.
- Browser storage and the service worker remain origin-isolated.
- API requests go to `https://omni-lodge.com/api` with credentials. The backend
  allows only `https://transaction.omni-lodge.com` as the production CORS
  origin, so the existing host-only OmniLodge session cookie remains usable
  without widening it to every subdomain.

## Verification

1. Confirm `https://transaction.omni-lodge.com/finance/new-transaction/install.html`
   loads over HTTPS.
2. In Android Chrome, open Transactions and tap **Install transaction app**.
3. Confirm Chrome offers **New Transaction** as a separate installation even
   while **OmniLodge** is already installed.
4. Launch the new icon and confirm it opens the create-transaction modal.
5. Confirm an authorized signed-in user can load accounts/categories and save a
   transaction, while a user without create access remains blocked.
