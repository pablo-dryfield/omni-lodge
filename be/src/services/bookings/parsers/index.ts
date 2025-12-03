import type { BookingEmailParser } from '../types.js';
import { BasicBookingParser } from './basicBookingParser.js';
import { FareHarborBookingParser } from './fareHarborBookingParser.js';
import { GetYourGuideBookingParser } from './getYourGuideBookingParser.js';
import { ViatorBookingParser } from './viatorBookingParser.js';

const parserInstances: BookingEmailParser[] = [
  new GetYourGuideBookingParser(),
  new ViatorBookingParser(),
  new FareHarborBookingParser(),
  new BasicBookingParser(),
];

export const getBookingParsers = (): BookingEmailParser[] => parserInstances;
