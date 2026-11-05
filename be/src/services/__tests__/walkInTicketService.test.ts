jest.mock('../configService.js', () => ({ getConfigValue: jest.fn(), refreshConfigCacheKeys: jest.fn().mockResolvedValue(undefined) }));
import { getConfigValue, refreshConfigCacheKeys } from '../configService';
import { getWalkInTicketTypes, validateWalkInTicketType } from '../walkInTicketService';

beforeEach(() => jest.clearAllMocks());
it('refreshes the live Control Panel key before returning types', async () => {
  const types = [{ id: 'partner', name: 'Partner price', enabled: true }];
  (getConfigValue as jest.Mock).mockReturnValue(types);
  expect(await getWalkInTicketTypes()).toEqual(types);
  expect(refreshConfigCacheKeys).toHaveBeenCalledWith(['COUNTER_WALK_IN_TICKET_TYPES']);
});
it('rejects unknown and disabled price types without silently storing Normal', async () => {
  (getConfigValue as jest.Mock).mockReturnValue([{ id: 'partner', name: 'Partner price', enabled: false }]);
  await expect(validateWalkInTicketType('partner')).rejects.toThrow('enabled ticket');
  await expect(validateWalkInTicketType('unknown')).rejects.toThrow('enabled ticket');
  (getConfigValue as jest.Mock).mockReturnValue([{ id: 'partner', name: 'Partner price', enabled: true }]);
  await expect(validateWalkInTicketType('partner')).resolves.toBe(true);
});
