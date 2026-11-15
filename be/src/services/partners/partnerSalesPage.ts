import { partnerSalesClient } from './partnerSalesClient.js';
import { partnerSalesStyles } from './partnerSalesStyles.js';
import { partnerKtkStyles } from './partnerKtkStyles.js';
import { partnerStorefrontStyles } from './partnerStorefrontStyles.js';
import { partnerPhoneCountries } from './partnerPhoneCountries.js';
import { salesAppearanceDefaults, type SalesAppearance } from './partnerSalesPresentation.js';

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));

/** Shared public page for booking links, QR codes and approved partner iframes. */
export function renderPartnerSalesPage(name: string, code: string, nonce: string, appearance: SalesAppearance = salesAppearanceDefaults, linkCode = ''): string {
  const safeName = escapeHtml(name);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="strict-origin-when-cross-origin">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23274c3c'/%3E%3Ctext x='16' y='23' text-anchor='middle' font-size='23' fill='white'%3EO%3C/text%3E%3C/svg%3E">
<title>Book an experience | ${safeName}</title>
<style nonce="${escapeHtml(nonce)}">${partnerSalesStyles}\n${partnerKtkStyles}\n${partnerStorefrontStyles}</style></head>
<body data-theme="catalog"><div id="partner-sales" data-base="/api/partner-sales/${escapeHtml(encodeURIComponent(code))}" data-link="${escapeHtml(linkCode)}">
<div class="page"><header class="masthead" hidden><div class="partner-brand"><span class="brand-mark" aria-hidden="true">${escapeHtml(name.trim().charAt(0).toUpperCase())}</span><span>${safeName}</span></div><div class="powered"><span>Booking powered by</span><strong>OmniLodge</strong></div></header>
<nav class="progress" hidden aria-label="Booking progress"><span class="progress-item active" aria-current="step"><span class="step-no">1</span>Experience</span><span class="progress-line" aria-hidden="true"></span><span class="progress-item"><span class="step-no">2</span>Your booking</span><span class="progress-line" aria-hidden="true"></span><span class="progress-item"><span class="step-no">3</span>Review &amp; pay</span></nav>
<div id="feedback" role="alert" tabindex="-1" hidden></div><main id="app" tabindex="-1"><p class="loading">Finding your next experience...</p></main>
<noscript><p class="notice">Please enable JavaScript to choose your experience and book securely.</p></noscript>
<footer class="footer" hidden><span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>Secure payment with Stripe</span><span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 7h18v4a2 2 0 0 0 0 4v4H3v-4a2 2 0 0 0 0-4V7Z"/></svg>Tickets delivered by email</span><span>Selected by ${safeName}</span></footer></div></div>
<script id="page-presentation" type="application/json" nonce="${escapeHtml(nonce)}">${JSON.stringify({ appearance, name }).replace(/</g, '\\u003c')}</script><script id="phone-countries" type="application/json" nonce="${escapeHtml(nonce)}">${JSON.stringify(partnerPhoneCountries).replace(/</g, '\\u003c')}</script><script nonce="${escapeHtml(nonce)}" src="/api/partner-sales/phone.js"></script><script nonce="${escapeHtml(nonce)}">${partnerSalesClient}</script></body></html>`;
}
