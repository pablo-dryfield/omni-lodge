import vm from 'node:vm';
import { renderPartnerSalesPage } from '../partnerSalesPage';

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
