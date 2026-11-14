jest.mock('../../../config/database.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../../models/Partner.js', () => ({}));
jest.mock('../../configService.js', () => ({}));
import { publicNetworkAddress, webhookSignature, webhookUrl } from '../partnerWebhookService';

describe('partner webhook trust boundaries', () => {
  it.each(['127.0.0.1', '10.0.0.1', '172.16.1.1', '192.168.1.2', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.1.1.1', '::1', '::ffff:127.0.0.1', 'fd00::1', 'fe80::1', '2001:db8::1'])('blocks non-public destination %s', value => expect(publicNetworkAddress(value)).toBe(false));
  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])('accepts public destination %s', value => expect(publicNetworkAddress(value)).toBe(true));
  it.each(['http://example.com', 'https://example.com:8080', 'https://user:secret@example.com', 'https://localhost', 'file:///etc/passwd'])('rejects unsupported endpoint %s', value => expect(() => webhookUrl(value)).toThrow());
  it('signs exact bytes and the delivery timestamp', () => {
    const original = webhookSignature('test-signing-secret', '123', '{"amount":100}');
    expect(original).toMatch(/^[a-f0-9]{64}$/);
    expect(webhookSignature('test-signing-secret', '124', '{"amount":100}')).not.toBe(original);
    expect(webhookSignature('test-signing-secret', '123', '{ "amount":100}')).not.toBe(original);
  });
});
