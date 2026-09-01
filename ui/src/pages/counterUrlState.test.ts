import {
  parseCounterUrlMode,
  serializeCounterUrlState,
} from './counterUrlState';

describe('counter URL state', () => {
  it.each([
    ['create', 'create'],
    ['view', 'view'],
    ['edit', 'edit'],
    ['unknown', null],
    [null, null],
  ])('parses mode %s', (value, expected) => {
    expect(parseCounterUrlMode(value)).toBe(expected);
  });

  it('opens create mode while preserving unrelated shortcut parameters', () => {
    const params = serializeCounterUrlState(
      new URLSearchParams('pwa=new-counter&counterId=42&step=summary'),
      { counterId: null, mode: 'create' },
    );

    expect(params.toString()).toBe('pwa=new-counter&mode=create');
  });

  it('moves a created counter into its reservation workflow URL', () => {
    const params = serializeCounterUrlState(
      new URLSearchParams('mode=create&pwa=new-counter'),
      { counterId: 82518, mode: 'edit', step: 'reservations' },
    );

    expect(params.toString()).toBe(
      'mode=edit&pwa=new-counter&counterId=82518&step=reservations',
    );
  });

  it('closes the overlay without removing unrelated URL parameters', () => {
    const params = serializeCounterUrlState(
      new URLSearchParams('pwa=new-counter&mode=create'),
      { counterId: null, mode: null },
    );

    expect(params.toString()).toBe('pwa=new-counter');
  });
});
