import type { ChannelNumbersDetailEntry } from '../types/channelNumbers/ChannelNumbersSummary';

export type ChannelNumbersTrendEntryGroups = {
  attendees: ChannelNumbersDetailEntry[];
  addonAttendees: ChannelNumbersDetailEntry[];
  noShows: ChannelNumbersDetailEntry[];
  addonNoShows: ChannelNumbersDetailEntry[];
};

export const isExcludedChannelNumbersTrendAddonName = (value?: string | null): boolean => {
  const normalized = (value ?? '').trim().toLowerCase();
  return normalized.includes('photo') || normalized.includes('t-shirt') || normalized.includes('tshirt');
};

/**
 * The bootstrap returns each counter/channel bucket once with both attendance values.
 * Derive the chart-specific views locally so changing a chart does not make API requests.
 */
export const groupChannelNumbersTrendEntries = (
  entries: ChannelNumbersDetailEntry[],
): ChannelNumbersTrendEntryGroups => {
  const attendees: ChannelNumbersDetailEntry[] = [];
  const addonAttendees: ChannelNumbersDetailEntry[] = [];
  const noShows: ChannelNumbersDetailEntry[] = [];
  const addonNoShows: ChannelNumbersDetailEntry[] = [];

  entries.forEach((entry) => {
    const isAddon = entry.addonKey !== null;
    if (isAddon && isExcludedChannelNumbersTrendAddonName(entry.addonName)) {
      return;
    }
    const attendedEntry = { ...entry, value: entry.attended };
    const noShowEntry = { ...entry, value: entry.nonShow };

    if (isAddon) {
      addonAttendees.push(attendedEntry);
      addonNoShows.push(noShowEntry);
      return;
    }

    attendees.push(attendedEntry);
    noShows.push(noShowEntry);
  });

  return { attendees, addonAttendees, noShows, addonNoShows };
};
