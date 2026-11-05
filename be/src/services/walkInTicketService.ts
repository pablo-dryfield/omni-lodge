import { DEFAULT_WALK_IN_TICKET_TYPES, parseWalkInTicketTypes, WALK_IN_TICKET_CONFIG_KEY } from '../config/walkInTicketConfig.js';
import { getConfigValue, refreshConfigCacheKeys } from './configService.js';

export async function getWalkInTicketTypes() {
  await refreshConfigCacheKeys([WALK_IN_TICKET_CONFIG_KEY]);
  return parseWalkInTicketTypes(getConfigValue(WALK_IN_TICKET_CONFIG_KEY) ?? DEFAULT_WALK_IN_TICKET_TYPES);
}

export async function validateWalkInTicketType(value: unknown) {
  const types = await getWalkInTicketTypes();
  if (typeof value !== 'string' || !types.some((type) => type.id === value && type.enabled)) {
    throw new Error('Choose an enabled ticket type from the Walk-Ins ticket settings.');
  }
  return true;
}
