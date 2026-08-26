import {
  SHIFT_REQUEST_NOTE_MAX_LENGTH,
  canCancelShiftRequest,
  canManagerDecideShiftRequest,
  canPartnerRespondToShiftRequest,
  findActiveShiftRequestAssignmentConflict,
  getAffectedShiftAssignmentIds,
  getInitialShiftRequestStatus,
  getShiftRequestStatusAfterManagerDecision,
  getShiftRequestStatusAfterPartnerResponse,
  isActiveShiftRequestStatus,
  normalizeShiftRequestNote,
  parseStrictBoolean,
} from '../shiftRequestRulesService';

describe('strict shift-request boolean parsing', () => {
  it.each([
    [true, true],
    [false, false],
  ])('preserves the JSON boolean %p', (input, expected) => {
    expect(parseStrictBoolean(input)).toBe(expected);
  });

  it.each(['true', 'false', 1, 0, null, undefined, {}, []])(
    'rejects truthy/coercible non-boolean value %p',
    (input) => {
      expect(parseStrictBoolean(input)).toBeNull();
    },
  );
});

describe('shift-request note normalization', () => {
  it('trims a supplied note without changing its internal content', () => {
    expect(normalizeShiftRequestNote('  Covering because they are sick.\nThank you.  ')).toBe(
      'Covering because they are sick.\nThank you.',
    );
  });

  it.each([null, undefined, '', '   ', '\r\n'])('normalizes an empty optional note to null', (input) => {
    expect(normalizeShiftRequestNote(input)).toBeNull();
  });

  it('accepts a note exactly at the configured length limit', () => {
    const note = 'x'.repeat(SHIFT_REQUEST_NOTE_MAX_LENGTH);
    expect(normalizeShiftRequestNote(note)).toBe(note);
  });

  it('rejects an oversized note', () => {
    expect(() => normalizeShiftRequestNote('x'.repeat(SHIFT_REQUEST_NOTE_MAX_LENGTH + 1)))
      .toThrow(`requestNote must be at most ${SHIFT_REQUEST_NOTE_MAX_LENGTH} characters`);
  });

  it.each([42, false, {}, []])('rejects non-string note %p', (input) => {
    expect(() => normalizeShiftRequestNote(input)).toThrow('requestNote must be a string or null');
  });
});

describe('shift-request lifecycle rules', () => {
  it.each([
    ['swap', 'pending_partner'],
    ['takeover', 'pending_partner'],
    ['drop', 'pending_manager'],
  ] as const)('starts %s requests in %s', (requestType, expected) => {
    expect(getInitialShiftRequestStatus(requestType)).toBe(expected);
  });

  it.each(['swap', 'takeover'] as const)('allows a partner to decide a pending %s', (requestType) => {
    expect(canPartnerRespondToShiftRequest(requestType, 'pending_partner')).toBe(true);
    expect(getShiftRequestStatusAfterPartnerResponse(requestType, 'pending_partner', true)).toBe('pending_manager');
    expect(getShiftRequestStatusAfterPartnerResponse(requestType, 'pending_partner', false)).toBe('denied');
  });

  it('never sends a drop request through partner approval', () => {
    expect(canPartnerRespondToShiftRequest('drop', 'pending_partner')).toBe(false);
    expect(() => getShiftRequestStatusAfterPartnerResponse('drop', 'pending_partner', true))
      .toThrow('not awaiting a partner response');
  });

  it.each(['pending_manager', 'approved', 'denied', 'canceled'] as const)(
    'does not allow a partner to revive a %s request',
    (status) => {
      expect(canPartnerRespondToShiftRequest('takeover', status)).toBe(false);
      expect(() => getShiftRequestStatusAfterPartnerResponse('takeover', status, true))
        .toThrow('not awaiting a partner response');
    },
  );

  it('allows a manager to approve or deny only a pending-manager request', () => {
    expect(canManagerDecideShiftRequest('pending_manager')).toBe(true);
    expect(getShiftRequestStatusAfterManagerDecision('pending_manager', true)).toBe('approved');
    expect(getShiftRequestStatusAfterManagerDecision('pending_manager', false)).toBe('denied');
  });

  it.each(['pending_partner', 'approved', 'denied', 'canceled'] as const)(
    'does not allow a manager to decide a %s request',
    (status) => {
      expect(canManagerDecideShiftRequest(status)).toBe(false);
      expect(() => getShiftRequestStatusAfterManagerDecision(status, true))
        .toThrow('not awaiting a manager decision');
    },
  );

  it.each([
    ['pending_partner', true],
    ['pending_manager', true],
    ['approved', false],
    ['denied', false],
    ['canceled', false],
  ] as const)('classifies %s active/cancelable as %p', (status, expected) => {
    expect(isActiveShiftRequestStatus(status)).toBe(expected);
    expect(canCancelShiftRequest(status)).toBe(expected);
  });
});

describe('affected assignment and active-request conflicts', () => {
  it('returns both sorted, unique assignment IDs for swaps', () => {
    expect(getAffectedShiftAssignmentIds({
      requestType: 'swap',
      fromAssignmentId: 19,
      toAssignmentId: 7,
    })).toEqual([7, 19]);
    expect(getAffectedShiftAssignmentIds({
      requestType: 'swap',
      fromAssignmentId: 7,
      toAssignmentId: 7,
    })).toEqual([7]);
  });

  it.each(['takeover', 'drop'] as const)('uses only the from assignment for %s', (requestType) => {
    expect(getAffectedShiftAssignmentIds({
      requestType,
      fromAssignmentId: 11,
      toAssignmentId: 99,
    })).toEqual([11]);
  });

  it('omits missing and invalid IDs instead of treating them as lock keys', () => {
    expect(getAffectedShiftAssignmentIds({
      requestType: 'swap',
      fromAssignmentId: 0,
      toAssignmentId: null,
    })).toEqual([]);
  });

  it('detects a takeover conflict against either side of an active swap', () => {
    const existing = [{
      id: 41,
      requestType: 'swap' as const,
      status: 'pending_partner' as const,
      fromAssignmentId: 8,
      toAssignmentId: 12,
    }];

    expect(findActiveShiftRequestAssignmentConflict({
      requestType: 'takeover',
      fromAssignmentId: 12,
    }, existing)).toEqual({ assignmentId: 12, requestId: 41 });
  });

  it('detects a swap conflict against an active drop', () => {
    expect(findActiveShiftRequestAssignmentConflict({
      requestType: 'swap',
      fromAssignmentId: 5,
      toAssignmentId: 9,
    }, [{
      id: 42,
      requestType: 'drop',
      status: 'pending_manager',
      fromAssignmentId: 5,
    }])).toEqual({ assignmentId: 5, requestId: 42 });
  });

  it.each(['approved', 'denied', 'canceled'] as const)(
    'ignores a terminal %s request',
    (status) => {
      expect(findActiveShiftRequestAssignmentConflict({
        requestType: 'drop',
        fromAssignmentId: 5,
      }, [{
        id: 42,
        requestType: 'takeover',
        status,
        fromAssignmentId: 5,
      }])).toBeNull();
    },
  );

  it('can exclude the request currently being transitioned', () => {
    expect(findActiveShiftRequestAssignmentConflict({
      requestType: 'takeover',
      fromAssignmentId: 5,
    }, [{
      id: 42,
      requestType: 'takeover',
      status: 'pending_manager',
      fromAssignmentId: 5,
    }], 42)).toBeNull();
  });

  it('returns null when there are no candidate assignment IDs', () => {
    expect(findActiveShiftRequestAssignmentConflict({
      requestType: 'drop',
      fromAssignmentId: null,
    }, [{
      id: 42,
      requestType: 'drop',
      status: 'pending_manager',
      fromAssignmentId: 5,
    }])).toBeNull();
  });
});

