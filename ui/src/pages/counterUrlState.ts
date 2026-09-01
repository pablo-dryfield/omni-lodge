export type CounterUrlMode = 'create' | 'view' | 'edit';

export type CounterUrlState = {
  counterId: number | null;
  mode: CounterUrlMode | null;
  step?: string | null;
};

export const parseCounterUrlMode = (value: string | null): CounterUrlMode | null => {
  return value === 'create' || value === 'view' || value === 'edit' ? value : null;
};

export const serializeCounterUrlState = (
  current: URLSearchParams,
  state: CounterUrlState,
): URLSearchParams => {
  const next = new URLSearchParams(current);

  if (state.mode === 'create') {
    next.delete('counterId');
    next.set('mode', 'create');
    next.delete('step');
    return next;
  }

  if (state.counterId == null) {
    next.delete('counterId');
    next.delete('mode');
    next.delete('step');
    return next;
  }

  next.set('counterId', String(state.counterId));
  if (state.mode) {
    next.set('mode', state.mode);
  } else {
    next.delete('mode');
  }
  if (state.step) {
    next.set('step', state.step);
  } else {
    next.delete('step');
  }
  return next;
};
