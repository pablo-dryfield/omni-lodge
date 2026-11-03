import { act, renderHook } from '@testing-library/react';
import { useCounterSaveAndExit } from './useCounterSaveAndExit';

describe('counter Save and Exit', () => {
  it('stays open on a venue validation error, shows the reason, and allows a successful retry', async () => {
    const saveCounter = jest.fn().mockResolvedValue(true);
    const syncVenueNumbers = jest.fn()
      .mockRejectedValueOnce('Stay duration is required to select the commission rate for a venue')
      .mockResolvedValueOnce(undefined);
    const close = jest.fn();
    const { result } = renderHook(() => useCounterSaveAndExit({ contextKey: 'counter:1', saveCounter, syncVenueNumbers, close }));

    await act(async () => { await result.current.save(); });
    expect(close).not.toHaveBeenCalled();
    expect(result.current.error).toContain('Counter attendance was saved, but Venue Numbers could not be updated.');
    expect(result.current.error).toContain('Stay duration is required');
    expect(result.current.saving).toBe(false);

    await act(async () => { await result.current.save(); });
    expect(result.current.error).toBeNull();
    expect(close).toHaveBeenCalledTimes(1);
    expect(syncVenueNumbers.mock.invocationCallOrder[1]).toBeLessThan(close.mock.invocationCallOrder[0]);
  });

  it('does not update Venue Numbers or close if saving the counter fails', async () => {
    const syncVenueNumbers = jest.fn();
    const close = jest.fn();
    const { result } = renderHook(() => useCounterSaveAndExit({
      contextKey: 'counter:1', saveCounter: async () => false, syncVenueNumbers, close,
    }));
    await act(async () => { await result.current.save(); });
    expect(syncVenueNumbers).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(result.current.saving).toBe(false);
  });

  it('prevents duplicate submissions and does not close a different counter opened during saving', async () => {
    let finish!: (saved: boolean) => void;
    const saveCounter = jest.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    const syncVenueNumbers = jest.fn();
    const close = jest.fn();
    const { result, rerender } = renderHook(({ contextKey }) => useCounterSaveAndExit({
      contextKey, saveCounter, syncVenueNumbers, close,
    }), { initialProps: { contextKey: 'counter:1' } });
    let pending!: Promise<void>;
    act(() => { pending = result.current.save(); });
    await act(async () => { await result.current.save(); });
    expect(saveCounter).toHaveBeenCalledTimes(1);
    rerender({ contextKey: 'counter:2' });
    await act(async () => { finish(true); await pending; });
    expect(syncVenueNumbers).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });
});
