import type { BookingEmailParser } from '../types.js';
import { BasicBookingParser } from './basicBookingParser.js';
import { FareHarborBookingParser } from './fareHarborBookingParser.js';

const parserInstances: BookingEmailParser[] = [
  new FareHarborBookingParser(),
  new BasicBookingParser(),
];

export const getBookingParsers = (): BookingEmailParser[] => parserInstances;
