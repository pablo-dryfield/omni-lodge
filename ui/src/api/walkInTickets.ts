import { useQuery } from '@tanstack/react-query';
import axiosInstance from '../utils/axiosInstance';

export const WALK_IN_TICKET_CONFIG_KEY = 'COUNTER_WALK_IN_TICKET_TYPES';
export type WalkInTicketDefinition = { id: string; name: string; enabled: boolean };
export const useWalkInTicketTypes = () => useQuery({
  queryKey: ['walk-in-ticket-types'],
  queryFn: async (): Promise<WalkInTicketDefinition[]> => {
    const response = await axiosInstance.get('/channelProductPrices/ticket-types');
    return response.data.ticketTypes;
  },
});
