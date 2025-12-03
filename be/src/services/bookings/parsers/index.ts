import type { BookingEmailParser } from '../types.js';
import { BasicBookingParser } from './basicBookingParser.js';

const parserInstances: BookingEmailParser[] = [
  new BasicBookingParser(),
];

export const getBookingParsers = (): BookingEmailParser[] => parserInstances;
