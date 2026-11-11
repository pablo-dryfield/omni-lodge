import { fireEvent, render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { StorefrontReplayLinks, storefrontRecordingLinks, storefrontVisitorSearchLinks } from "./StorefrontReplayLinks";
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
    { projectId: "" }, { userId: "a".repeat(65) }, { userId: "abc&date=All" }, { sessionId: null },
    { projectId: 123 }, { environment: undefined },
  ])("never turns unsafe metadata into an external link: %j", invalid => {
    const invalidVisit = { ...visit, events: [{ ...visit.events[0], details: { ...visit.events[0].details, ...invalid } }] };
    expect(storefrontRecordingLinks(invalidVisit)).toEqual([]);
    expect(storefrontVisitorSearchLinks(invalidVisit)).toEqual([]);
  });

  it("retains separate sessions while deduplicating the visitor search", () => {
    const repeatedVisit = { ...visit, events: [visit.events[0],
      { ...visit.events[0], details: { ...visit.events[0].details, sessionId: "second" } },
      { ...visit.events[0], source: "server", details: { ...visit.events[0].details, sessionId: "unconfirmed" } },
    ] };
    expect(storefrontRecordingLinks(repeatedVisit)).toHaveLength(2);
    expect(storefrontVisitorSearchLinks(repeatedVisit)).toEqual([
      "https://clarity.microsoft.com/projects/view/z9d5iuilvn/impressions?date=Last%2030%20days&UserId=is%3Babc123",
    ]);
    render(<MantineProvider><StorefrontReplayLinks visit={repeatedVisit} /></MantineProvider>);
    expect(screen.getAllByRole("link", { name: "Find visitor in Clarity" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Clarity 1" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Clarity 2" })).toBeInTheDocument();
  });

  it.each([
    { source: "server" }, { source: "import" }, { type: "replay_requested" }, { details: null },
  ])("uses only client recording-reference events for both controls: %j", invalid => {
    const invalidVisit = { ...visit, events: [{ ...visit.events[0], ...invalid }] };
    expect(storefrontRecordingLinks(invalidVisit)).toEqual([]);
    expect(storefrontVisitorSearchLinks(invalidVisit)).toEqual([]);
  });

  it("keeps distinct native visitors and projects without trusting event-supplied destinations", () => {
    const links = storefrontVisitorSearchLinks({ ...visit, events: [visit.events[0],
      { ...visit.events[0], details: { ...visit.events[0].details, userId: "otherUser" } },
      { ...visit.events[0], details: { ...visit.events[0].details, projectId: "otherProject" } },
      { ...visit.events[0], details: { ...visit.events[0].details, url: "https://unsafe.example", href: "javascript:alert(1)" } },
    ] });
    expect(links).toHaveLength(3);
    for (const link of links) {
      const url = new URL(link);
      expect(url.origin).toBe("https://clarity.microsoft.com");
      expect(url.searchParams.get("date")).toBe("Last 30 days");
      expect(url.searchParams.get("UserId")).toMatch(/^is;(abc123|otherUser)$/);
    }
  });

  it("renders an authenticated Clarity link within the shared timeline", () => {
    render(<MantineProvider><StorefrontActivityTimeline visits={[visit]} /></MantineProvider>);
    const link = screen.getByRole("link", { name: "Clarity" });
    expect(link).toHaveAttribute("href", "https://clarity.microsoft.com/player/z9d5iuilvn/abc123/def456");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("target", "_blank");
    const search = screen.getByRole("link", { name: "Find visitor in Clarity" });
    expect(search).toHaveAttribute("href", "https://clarity.microsoft.com/projects/view/z9d5iuilvn/impressions?date=Last%2030%20days&UserId=is%3Babc123");
    expect(search).toHaveAttribute("rel", "noopener noreferrer");
    expect(search).toHaveAttribute("target", "_blank");
    expect(screen.queryByText("Replay available")).not.toBeInTheDocument();
    expect(screen.getByText("Clarity recording reference captured")).toBeInTheDocument();
  });

  it("explains that visitor search does not confirm a recording was uploaded or retained", async () => {
    render(<MantineProvider><StorefrontReplayLinks visit={visit} /></MantineProvider>);
    fireEvent.mouseEnter(screen.getByRole("link", { name: "Find visitor in Clarity" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("A native reference does not confirm recording upload or retention.");
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
