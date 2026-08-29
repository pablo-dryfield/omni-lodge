type StorefrontEventTimestamp = {
  occurredAt?: string | null;
};

type StorefrontVisitEvents = {
  events?: StorefrontEventTimestamp[] | null;
};

export type StorefrontSaleTiming = {
  startedAt: string;
  finishedAt: string;
  durationSeconds: number;
};

export const getStorefrontSaleTiming = (
  visits: StorefrontVisitEvents[] | null | undefined,
): StorefrontSaleTiming | null => {
  const timestamps = (visits ?? []).flatMap((visit) => visit.events ?? []).flatMap((event) => {
    if (!event.occurredAt) return [];
    const milliseconds = Date.parse(event.occurredAt);
    return Number.isFinite(milliseconds) ? [{ value: event.occurredAt, milliseconds }] : [];
  });

  if (!timestamps.length) return null;

  const first = timestamps.reduce((earliest, current) => (
    current.milliseconds < earliest.milliseconds ? current : earliest
  ));
  const last = timestamps.reduce((latest, current) => (
    current.milliseconds > latest.milliseconds ? current : latest
  ));

  return {
    startedAt: first.value,
    finishedAt: last.value,
    durationSeconds: Math.max(0, Math.floor((last.milliseconds - first.milliseconds) / 1000)),
  };
};

export const formatStorefrontSaleDuration = (durationSeconds: number): string => {
  const totalSeconds = Math.max(0, Math.floor(durationSeconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];

  if (hours) parts.push(`${hours} ${hours === 1 ? "Hour" : "Hours"}`);
  if (minutes) parts.push(`${minutes} ${minutes === 1 ? "min" : "mins"}`);
  parts.push(`${seconds} ${seconds === 1 ? "second" : "seconds"}`);

  return parts.join(", ");
};
