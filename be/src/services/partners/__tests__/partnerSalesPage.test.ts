import vm from 'node:vm';
import { renderPartnerSalesPage } from '../partnerSalesPage';
import { partnerSalesEmbedClient } from '../partnerSalesClient';
import { salesAppearanceDefaults } from '../partnerSalesPresentation';

it('serializes custom copy as non-executable JSON and carries the saved link to the browser', () => {
  const page = renderPartnerSalesPage('Partner', 'public', 'nonce', { ...salesAppearanceDefaults, title: '</script><script>alert(1)</script>', showBrand: false }, 'saved-link');
  expect(page).toContain('data-link="saved-link"');
  expect(page).not.toContain('</script><script>alert(1)');
  const data = page.match(/id="page-presentation"[^>]*>(.*?)<\/script>/)?.[1];
  expect(JSON.parse(data!).appearance.title).toBe('</script><script>alert(1)</script>');
});

it('escapes partner branding, limits script execution to a nonce and emits valid browser JavaScript', () => {
  const page = renderPartnerSalesPage('<script>alert(1)</script>', 'safe-code', 'testnonce');
  expect(page).toContain('&lt;script&gt;');
  expect(page).not.toContain('<script>alert(1)');
  const script = page.match(/<script nonce="testnonce">([\s\S]*?)<\/script>/)?.[1];
  expect(script).toBeTruthy();
  expect(() => new vm.Script(script!)).not.toThrow();
  expect(page).toContain('checkout.stripe.com');
  expect(page).toContain('Payment confirmation is being checked');
});

it('keeps public branding out of executable JavaScript and escapes attribute values', () => {
  const page = renderPartnerSalesPage('</script><img src=x onerror=alert(1)>', 'code" onclick="alert(1)', 'nonce');
  expect(page).not.toContain('<img src=x');
  expect(page).toContain('&lt;/script&gt;');
  expect(page).not.toContain('data-base="/api/partner-sales/code"');
  const script = page.match(/<script nonce="nonce">([\s\S]*?)<\/script>/)?.[1];
  expect(script).not.toContain('onerror=alert(1)');
  expect(() => new vm.Script(script!)).not.toThrow();
});

it('resizes only the iframe that sent the message from its exact configured origin', () => {
  let listener: (event: unknown) => void = () => undefined;
  const source = {};
  const frame = { src: 'https://omni-lodge.com/api/partner-sales/example', contentWindow: source, style: { height: '1000px' } };
  vm.runInNewContext(partnerSalesEmbedClient, { URL, Number, Math, location: { href: 'https://partner.example/' },
    window: { addEventListener: (_type: string, handler: typeof listener) => { listener = handler; } }, document: { querySelectorAll: () => [frame] } });
  listener({ origin: 'https://attacker.example', source, data: { type: 'omnilodge:partner-resize', height: 600 } });
  listener({ origin: 'https://omni-lodge.com', source: {}, data: { type: 'omnilodge:partner-resize', height: 600 } });
  expect(frame.style.height).toBe('1000px');
  listener({ origin: 'https://omni-lodge.com', source, data: { type: 'omnilodge:partner-resize', height: 850 } });
  expect(frame.style.height).toBe('850px');
  listener({ origin: 'https://omni-lodge.com', source, data: { type: 'omnilodge:partner-resize', height: 1e9 } });
  expect(frame.style.height).toBe('10000px');
  listener({ origin: 'https://omni-lodge.com', source, data: { type: 'omnilodge:partner-resize', height: '400' } });
  expect(frame.style.height).toBe('10000px');
});
