import type { ChannelNumbersDetailEntry } from '../types/channelNumbers/ChannelNumbersSummary';
import { groupChannelNumbersTrendEntries } from './channelNumbersTrend';

const entry = (
  overrides: Partial<ChannelNumbersDetailEntry>,
): ChannelNumbersDetailEntry => ({
  counterId: 1,
  counterDate: '2026-08-01',
  channelId: 2,
  channelName: 'Test channel',
  productId: 3,
  productName: 'Pub Crawl',
  addonKey: null,
  addonName: null,
  bookedBefore: 8,
  bookedAfter: 1,
  attended: 7,
  nonShow: 2,
  value: 999,
  note: null,
  ...overrides,
});

describe('groupChannelNumbersTrendEntries', () => {
  it('derives attendee and no-show chart values from one people bucket', () => {
    const groups = groupChannelNumbersTrendEntries([entry({})]);

    expect(groups.attendees).toHaveLength(1);
    expect(groups.attendees[0].value).toBe(7);
    expect(groups.noShows).toHaveLength(1);
    expect(groups.noShows[0].value).toBe(2);
    expect(groups.addonAttendees).toEqual([]);
    expect(groups.addonNoShows).toEqual([]);
  });

  it('keeps add-on buckets separate while reusing the same source entry', () => {
    const groups = groupChannelNumbersTrendEntries([
      entry({ addonKey: 'cocktails', addonName: 'Cocktails', attended: 4, nonShow: 1 }),
    ]);

    expect(groups.addonAttendees[0]).toMatchObject({ addonKey: 'cocktails', value: 4 });
    expect(groups.addonNoShows[0]).toMatchObject({ addonKey: 'cocktails', value: 1 });
    expect(groups.attendees).toEqual([]);
    expect(groups.noShows).toEqual([]);
  });

  it.each(['Photos', 'T-Shirt', 'tshirt package'])(
    'excludes %s from both add-on chart groups',
    (addonName) => {
      const groups = groupChannelNumbersTrendEntries([
        entry({ addonKey: 'excluded-addon', addonName, attended: 4, nonShow: 1 }),
      ]);

      expect(groups.addonAttendees).toEqual([]);
      expect(groups.addonNoShows).toEqual([]);
    },
  );
});
