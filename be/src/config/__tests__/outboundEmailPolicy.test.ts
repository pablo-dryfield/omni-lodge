import { assertOutboundEmailAllowed, isOutboundEmailDisabled } from '../outboundEmailPolicy';

const original = process.env.DISABLE_OUTBOUND_EMAIL;
afterEach(() => {
  if (original === undefined) delete process.env.DISABLE_OUTBOUND_EMAIL;
  else process.env.DISABLE_OUTBOUND_EMAIL = original;
});

it.each(['true', ' TRUE '])('blocks sends when process isolation is %s', value => {
  process.env.DISABLE_OUTBOUND_EMAIL = value;
  expect(isOutboundEmailDisabled()).toBe(true);
  expect(assertOutboundEmailAllowed).toThrow('Outbound email is disabled');
});

it('preserves normal delivery policy when isolation is not set', () => {
  delete process.env.DISABLE_OUTBOUND_EMAIL;
  expect(assertOutboundEmailAllowed).not.toThrow();
  process.env.DISABLE_OUTBOUND_EMAIL = 'false';
  expect(isOutboundEmailDisabled()).toBe(false);
});
