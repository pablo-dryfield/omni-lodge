import { createLeafletTooltipContent } from "./promotionMapTooltip";

describe("createLeafletTooltipContent", () => {
  it("renders stored labels as text instead of executable HTML", () => {
    const storedLabel = '<img src=x onerror="alert(1)">Checkpoint';

    const content = createLeafletTooltipContent(storedLabel);

    expect(content.textContent).toBe(storedLabel);
    expect(content.querySelector("img")).toBeNull();
    expect(content.innerHTML).toContain("&lt;img");
  });
});
