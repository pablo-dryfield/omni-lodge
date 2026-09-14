import { executeNightReportSaveSequence } from "./nightReportSubmission";

describe("night report save sequence", () => {
  it("updates, submits, and refreshes a draft report in order", async () => {
    const calls: string[] = [];

    await executeNightReportSaveSequence({
      alreadySubmitted: false,
      update: async () => calls.push("update"),
      submit: async () => calls.push("submit"),
      refresh: async () => calls.push("refresh"),
    });

    expect(calls).toEqual(["update", "submit", "refresh"]);
  });

  it("updates and refreshes an already-submitted report without submitting it again", async () => {
    const calls: string[] = [];

    await executeNightReportSaveSequence({
      alreadySubmitted: true,
      update: async () => calls.push("update"),
      submit: async () => calls.push("submit"),
      refresh: async () => calls.push("refresh"),
    });

    expect(calls).toEqual(["update", "refresh"]);
  });
});
