jest.mock('../errorMonitoringService.js', () => ({
  captureExternalRequestFailureSafe: jest.fn(),
}));

import {
  classifyExternalRequestClose,
  classifyExternalResponseClose,
  normalizeExternalHttpTarget,
} from '../externalRequestDiagnosticsService.js';

describe('external request close classification', () => {
  it('treats a request close before response headers as a network failure', () => {
    expect(classifyExternalRequestClose(false)).toBe('REQUEST_CLOSED');
    expect(classifyExternalRequestClose(true)).toBeNull();
  });

  it('treats incomplete response closure as a network failure', () => {
    expect(classifyExternalResponseClose(false)).toBe('INCOMPLETE_RESPONSE');
    expect(classifyExternalResponseClose(true)).toBeNull();
  });

  it('uses options from the url-plus-options http.request overload', () => {
    expect(normalizeExternalHttpTarget(
      'https',
      'https://example.test/webhook?token=private',
      { method: 'post' },
    )).toMatchObject({
      protocol: 'https',
      method: 'POST',
      host: 'example.test',
      path: '/webhook',
      pathLabel: '/webhook',
    });
  });
});
