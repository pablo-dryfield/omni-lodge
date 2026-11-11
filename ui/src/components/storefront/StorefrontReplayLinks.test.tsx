import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { StorefrontReplayLinks, storefrontRecordingLinks } from "./StorefrontReplayLinks";
import { StorefrontActivityTimeline, type StorefrontJourneyVisit } from "./StorefrontActivityTimeline";

const originalMatchMedia = window.matchMedia;
beforeAll(() => {
  window.matchMedia = query => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  });
});
afterAll(() => { window.matchMedia = originalMatchMedia; });

const visit: StorefrontJourneyVisit = {
  id: "c3c7d60f-b420-4925-892f-00484ce786cd", browserInstanceId: null,
  startedAt: "2026-11-11T12:00:00Z", lastActivityAt: "2026-11-11T12:02:00Z", qualifiedAt: "2026-11-11T12:01:00Z",
  claritySampled: true, claritySessionId: "incorrect-legacy-custom-id",
  events: [{
    id: "event-1", type: "clarity_recording_linked", source: "client", severity: "info", sequence: 2,
    occurredAt: "2026-11-11T12:00:02Z", receivedAt: "2026-11-11T12:00:03Z",
    details: { projectId: "z9d5iuilvn", userId: "abc123", sessionId: "def456", environment: "production" },
  }],
};

describe("storefront recording links", () => {
  it("uses native metadata, not our custom visit ID, and deduplicates recordings", () => {
    expect(storefrontRecordingLinks({ ...visit, events: [...visit.events, ...visit.events] })).toEqual([
      "https://clarity.microsoft.com/player/z9d5iuilvn/abc123/def456",
    ]);
  });

  it.each([
    { projectId: "../other" }, { userId: "someone@example.com" }, { sessionId: "../escape" }, { environment: "staging" },
  ])("never turns unsafe metadata into an external link: %j", invalid => {
    expect(storefrontRecordingLinks({ ...visit, events: [{ ...visit.events[0], details: { ...visit.events[0].details, ...invalid } }] })).toEqual([]);
  });

  it("retains separate sessions and does not confuse a server milestone with captured metadata", () => {
    expect(storefrontRecordingLinks({ ...visit, events: [visit.events[0],
      { ...visit.events[0], details: { ...visit.events[0].details, sessionId: "second" } },
      { ...visit.events[0], source: "server", details: { ...visit.events[0].details, sessionId: "unconfirmed" } },
    ] })).toHaveLength(2);
  });

  it("renders an authenticated Clarity link within the shared timeline", () => {
    render(<MantineProvider><StorefrontActivityTimeline visits={[visit]} /></MantineProvider>);
    const link = screen.getByRole("link", { name: "Clarity" });
    expect(link).toHaveAttribute("href", "https://clarity.microsoft.com/player/z9d5iuilvn/abc123/def456");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.queryByText("Replay available")).not.toBeInTheDocument();
    expect(screen.getByText("Clarity recording reference captured")).toBeInTheDocument();
  });

  it("honestly presents legacy lookup-only history without constructing a fake recording", () => {
    render(<MantineProvider><StorefrontReplayLinks visit={{ ...visit, events: [] }} /></MantineProvider>);
    expect(screen.getByText("Lookup only")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy Clarity custom session ID" })).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("does not claim a recording was absent when no reference exists", () => {
    render(<MantineProvider><StorefrontReplayLinks visit={{ ...visit, claritySampled: false, events: [] }} /></MantineProvider>);
    expect(screen.getByText("No recording link")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
