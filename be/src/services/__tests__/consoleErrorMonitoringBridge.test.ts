jest.mock('../errorMonitoringService.js', () => ({
  captureProcessErrorSafe: jest.fn(),
}));

import {
  consoleArgumentsToError,
  createConsoleMonitoringHandler,
  shouldCaptureConsoleWarning,
} from '../consoleErrorMonitoringBridge.js';

describe('legacy console monitoring bridge', () => {
  it('preserves original output and the supplied Error stack', () => {
    const original = jest.fn();
    const capture = jest.fn();
    const failure = new Error('legacy failure');
    const handler = createConsoleMonitoringHandler('console_error', original, capture);

    handler('Background job failed', failure);

    expect(original).toHaveBeenCalledWith('Background job failed', failure);
    expect(capture).toHaveBeenCalledWith('console_error', failure);
    expect((capture.mock.calls[0][1] as Error).stack).toBe(failure.stack);
  });

  it('captures only failure-shaped warnings', () => {
    expect(shouldCaptureConsoleWarning(['configuration loaded'])).toBe(false);
    expect(shouldCaptureConsoleWarning(['upload timed out'])).toBe(true);
    expect(shouldCaptureConsoleWarning([new Error('worker stopped')])).toBe(true);

    const original = jest.fn();
    const capture = jest.fn();
    const handler = createConsoleMonitoringHandler('console_warning', original, capture);
    handler('configuration loaded');
    handler('upload failed after timeout');

    expect(original).toHaveBeenCalledTimes(2);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0][0]).toBe('console_warning');
  });

  it('prevents monitoring recursion while retaining nested console output', () => {
    const original = jest.fn();
    let handler: (...args: unknown[]) => void;
    const capture = jest.fn(() => {
      handler('[error-monitoring] simulated spool diagnostic');
    });
    handler = createConsoleMonitoringHandler('console_error', original, capture);

    handler('top-level failure');

    expect(original).toHaveBeenCalledTimes(2);
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it('does not stringify arbitrary object values into persisted messages', () => {
    const error = consoleArgumentsToError([{ token: 'secret-value', customerName: 'Private Person' }]);

    expect(error.message).toContain('token');
    expect(error.message).not.toContain('secret-value');
    expect(error.message).not.toContain('Private Person');
  });
});
