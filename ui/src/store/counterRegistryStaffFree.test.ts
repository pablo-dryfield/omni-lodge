import axiosInstance from '../utils/axiosInstance';
import { commitCounterRegistry, finalizeCounterReservations } from './counterRegistrySlice';

jest.mock('../utils/axiosInstance', () => ({ __esModule: true, default: { post: jest.fn() } }));

it.each([commitCounterRegistry, finalizeCounterReservations])('includes staff drafts in the normal counter save request', async save => {
  const staffFreeChanges = { additions: [{ userId: 7, overrideReason: 'Farewell' }], removals: [{ entryId: 3, reason: 'Wrong person' }] };
  (axiosInstance.post as jest.Mock).mockResolvedValue({ data: { counter: { id: 1 } } });
  const result = await save({ counterId: 1, metrics: [], status: 'final', staffFreeChanges })(jest.fn(), jest.fn(), undefined);
  expect(result.meta.requestStatus).toBe('fulfilled');
  expect(axiosInstance.post).toHaveBeenLastCalledWith(expect.stringMatching(/\/counters\/1\/(commit|finalize-reservations)\?format=registry/), expect.objectContaining({ staffFreeChanges, status: 'final' }), expect.anything());
});
