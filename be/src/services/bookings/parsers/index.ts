import type { BookingEmailParser } from '../types.js';
import { EcwidBookingParser } from './ecwidBookingParser.js';
import { FareHarborBookingParser } from './fareHarborBookingParser.js';
import { FreeTourBookingParser } from './freeTourBookingParser.js';
import { GetYourGuideBookingParser } from './getYourGuideBookingParser.js';
import { ViatorBookingParser } from './viatorBookingParser.js';

const parserInstances: BookingEmailParser[] = [
  new GetYourGuideBookingParser(),
  new ViatorBookingParser(),
  new EcwidBookingParser(),
  new FreeTourBookingParser(),
  new FareHarborBookingParser(),
];

export const getBookingParsers = (): BookingEmailParser[] => parserInstances;
