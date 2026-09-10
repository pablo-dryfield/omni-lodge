import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen } from "@testing-library/react";
import type { SocialMediaContentItem } from "../../api/socialMedia";
import { SocialMediaIdeaViewModal } from "./SocialMediaIdeaViewModal";

jest.mock("../../utils/axiosInstance", () => ({
  __esModule: true,
  default: {},
}));

const publishedItem: SocialMediaContentItem = {
  id: 91,
  title: "Warm-up reel",
  idea: "Follow the team from briefing to the first venue.",
  onVideoCaptions: "POV: your Krakow night starts here",
  platformCaption: "Meet tonight's crew and join the crawl.",
  hashtags: ["#krakow", "pubcrawl"],
  targetPlatforms: ["instagram", "tiktok"],
  status: "published",
  scheduledAt: "2026-09-08",
  publishedAt: "2026-09-10T18:30:00.000Z",
  driveProjectUrl: "https://drive.google.com/drive/folders/project-91",
  platformLinks: {
    instagram: "https://www.instagram.com/reel/example/",
    tiktok: "https://www.tiktok.com/@example/video/91",
  },
  thumbnailUrl: "https://example.com/thumbnail.jpg",
  assets: [
    {
      id: 301,
      contentId: 91,
      kind: "final_video",
      originalName: "warm-up-final.mp4",
      mimeType: "video/mp4",
      sizeBytes: 10_485_760,
      webViewUrl: "https://drive.google.com/file/d/final-91/view",
      uploadedBy: 7,
      createdAt: "2026-09-10T12:00:00.000Z",
      updatedAt: "2026-09-10T12:00:00.000Z",
    },
  ],
  productionStartedAt: "2026-09-09T10:00:00.000Z",
  readyAt: "2026-09-10T12:15:00.000Z",
  publishedBy: 9,
  producedBy: 7,
  producedByName: "Producer Example",
  publishedByName: "Publisher Example",
  producedByUser: null,
  publishedByUser: null,
  publishedTaskLogId: 501,
  createdBy: 5,
  createdByName: "Creator Example",
  createdByUser: null,
  updatedBy: 9,
  updatedByName: "Publisher Example",
  createdAt: "2026-09-07T09:00:00.000Z",
  updatedAt: "2026-09-10T18:30:00.000Z",
};

const renderModal = (
  item: SocialMediaContentItem = publishedItem,
  onClose: () => void = jest.fn(),
) => render(
  <MantineProvider>
    <SocialMediaIdeaViewModal item={item} opened onClose={onClose} />
  </MantineProvider>,
);

describe("SocialMediaIdeaViewModal", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      writable: true,
      value: class ResizeObserverMock {
        observe() {}

        unobserve() {}

        disconnect() {}
      },
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: jest.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      })),
    });
  });

  it("shows the complete workflow, creative brief, files, and publication details without edit controls", () => {
    renderModal();

    expect(screen.getByRole("dialog", { name: "Idea details" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Warm-up reel" })).toBeInTheDocument();
    expect(screen.getByText("Follow the team from briefing to the first venue.")).toBeInTheDocument();
    expect(screen.getByText("POV: your Krakow night starts here")).toBeInTheDocument();
    expect(screen.getByText("Meet tonight's crew and join the crawl.")).toBeInTheDocument();
    expect(screen.getByText("Creator Example")).toBeInTheDocument();
    expect(screen.getByText("Producer Example")).toBeInTheDocument();
    expect(screen.getAllByText("Publisher Example").length).toBeGreaterThan(0);
    expect(screen.getByText("#krakow")).toBeInTheDocument();
    expect(screen.getByText("#pubcrawl")).toBeInTheDocument();
    expect(screen.getByText("warm-up-final.mp4")).toBeInTheDocument();
    expect(screen.getByText("Final video")).toBeInTheDocument();

    expect(screen.getByRole("link", { name: /Drive folder/i })).toHaveAttribute(
      "href",
      publishedItem.driveProjectUrl,
    );
    expect(screen.getByRole("link", { name: "Open warm-up-final.mp4" })).toHaveAttribute(
      "href",
      publishedItem.assets[0].webViewUrl,
    );
    expect(screen.getByRole("link", { name: /Instagram/i })).toHaveAttribute(
      "href",
      publishedItem.platformLinks.instagram,
    );
    expect(screen.getByRole("link", { name: /TikTok/i })).toHaveAttribute(
      "href",
      publishedItem.platformLinks.tiktok,
    );
    expect(screen.queryByRole("button", { name: /edit|save|delete|remove/i })).not.toBeInTheDocument();
  });

  it("shows centered empty states for information that has not been added yet", () => {
    renderModal({
      ...publishedItem,
      status: "idea",
      onVideoCaptions: "",
      platformCaption: "",
      hashtags: [],
      targetPlatforms: [],
      scheduledAt: null,
      productionStartedAt: null,
      readyAt: null,
      publishedAt: null,
      driveProjectUrl: null,
      platformLinks: {},
      thumbnailUrl: null,
      assets: [],
      producedBy: null,
      producedByName: null,
      publishedBy: null,
      publishedByName: null,
    });

    expect(screen.getAllByText("Not added")).toHaveLength(2);
    expect(screen.getByText("No platforms selected")).toBeInTheDocument();
    expect(screen.getByText("No hashtags added")).toBeInTheDocument();
    expect(screen.getAllByText("Not yet").length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText("Project files")).not.toBeInTheDocument();
    expect(screen.queryByText("Published links")).not.toBeInTheDocument();
  });

  it("closes from the explicit dialog action", () => {
    const onClose = jest.fn();
    renderModal(publishedItem, onClose);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
