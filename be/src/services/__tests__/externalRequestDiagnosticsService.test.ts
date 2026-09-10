import { EventEmitter } from 'events';
import type { ClientRequest, IncomingMessage } from 'http';

jest.mock('../errorMonitoringService.js', () => ({
  captureExternalRequestFailureSafe: jest.fn(),
}));

import { captureExternalRequestFailureSafe } from '../errorMonitoringService.js';
import {
  classifyExternalRequestClose,
  classifyExternalRequestError,
  classifyExternalResponseClose,
  ExternalRequestDiagnosticsService,
  normalizeExternalHttpTarget,
} from '../externalRequestDiagnosticsService.js';

const captureExternalFailure = captureExternalRequestFailureSafe as jest.Mock;

const createRequest = (): ClientRequest => new EventEmitter() as ClientRequest;

const createResponse = (statusCode: number, complete = true): IncomingMessage => {
  const response = new EventEmitter() as IncomingMessage;
  response.statusCode = statusCode;
  response.complete = complete;
  return response;
};

describe('external request close classification', () => {
  it('treats a request close before response headers as a network failure', () => {
    expect(classifyExternalRequestClose(false)).toBe('REQUEST_CLOSED');
    expect(classifyExternalRequestClose(true)).toBeNull();
  });

  it('does not treat an advisory timeout as a failure after response headers arrive', () => {
    expect(classifyExternalRequestClose(true, true)).toBeNull();
    expect(classifyExternalRequestClose(false, true)).toBe('TIMEOUT');
  });

  it('preserves concrete network errors while using timeout as a fallback', () => {
    expect(classifyExternalRequestError('ECONNRESET', 'Error', true)).toBe('ECONNRESET');
    expect(classifyExternalRequestError(undefined, 'Error', true)).toBe('TIMEOUT');
    expect(classifyExternalRequestError(undefined, 'FetchError', false)).toBe('FetchError');
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

  it.each(['upgrade', 'connect'] as const)(
    'treats a successful %s handshake as a completed response',
    (eventName) => {
      const service = new ExternalRequestDiagnosticsService();
      const request = createRequest();

      (service as unknown as {
        observeRequest: (
          requestValue: ClientRequest,
          protocol: 'http' | 'https',
          input: string,
        ) => void;
      }).observeRequest(request, 'http', 'http://127.0.0.1:39927/devtools/browser/session-id');

      request.emit(eventName, createResponse(eventName === 'upgrade' ? 101 : 200));
      request.emit('close');

      expect(captureExternalFailure).not.toHaveBeenCalled();
      expect(service.getSnapshot().totalCapturedSinceStart).toBe(1);
    },
  );

  it('waits for the terminal outcome after a non-terminal timeout notification', () => {
    const service = new ExternalRequestDiagnosticsService();
    const request = createRequest();
    const response = createResponse(200);

    (service as unknown as {
      observeRequest: (
        requestValue: ClientRequest,
        protocol: 'http' | 'https',
        input: string,
      ) => void;
    }).observeRequest(request, 'https', 'https://www.googleapis.com/drive/v3/files/file-id');

    request.emit('timeout');
    request.emit('response', response);
    response.emit('end');
    request.emit('close');

    expect(captureExternalFailure).not.toHaveBeenCalled();
    expect(service.getSnapshot().totalCapturedSinceStart).toBe(1);
  });
});
