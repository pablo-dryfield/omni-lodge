import type { BookingEmailParser } from '../types.js';
import { BasicBookingParser } from './basicBookingParser.js';
import { FareHarborBookingParser } from './fareHarborBookingParser.js';
import { GetYourGuideBookingParser } from './getYourGuideBookingParser.js';

const parserInstances: BookingEmailParser[] = [
  new GetYourGuideBookingParser(),
  new FareHarborBookingParser(),
  new BasicBookingParser(),
];

export const getBookingParsers = (): BookingEmailParser[] => parserInstances;
