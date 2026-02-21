import type { BookingEmailParser } from '../types.js';
import { AirbnbBookingParser } from './airbnbBookingParser.js';
import { buildDynamicRuleBookingParsers } from './dynamicRuleBookingParser.js';
import { EcwidBookingParser } from './ecwidBookingParser.js';
import { FareHarborBookingParser } from './fareHarborBookingParser.js';
import { FreeTourBookingParser } from './freeTourBookingParser.js';
import { GetYourGuideBookingParser } from './getYourGuideBookingParser.js';
import { ViatorBookingParser } from './viatorBookingParser.js';
import { XperiencePolandBookingParser } from './xperiencePolandBookingParser.js';

const staticParserInstances: BookingEmailParser[] = [
  new GetYourGuideBookingParser(),
  new ViatorBookingParser(),
  new EcwidBookingParser(),
  new FreeTourBookingParser(),
  new FareHarborBookingParser(),
  new XperiencePolandBookingParser(),
  new AirbnbBookingParser(),
];

export const getBookingParsers = (): BookingEmailParser[] => [
  ...buildDynamicRuleBookingParsers(),
  ...staticParserInstances,
];
