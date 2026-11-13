import HttpError from '../errors/HttpError.js';

// Process-level isolation for local development with a production database clone.
// Deliberately outside database settings: a restored config or Control Panel save
// must not be able to enable delivery from a process explicitly isolated this way.
export const isOutboundEmailDisabled = (): boolean =>
  process.env.DISABLE_OUTBOUND_EMAIL?.trim().toLowerCase() === 'true';

export const assertOutboundEmailAllowed = (): void => {
  if (isOutboundEmailDisabled()) {
    throw new HttpError(503, 'Outbound email is disabled in this environment. Email previews remain available.');
  }
};
