import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { RequiredActionItem } from "../../api/requiredActions";
import RequiredActionsOverlay from "./RequiredActionsOverlay";

let mockActions: RequiredActionItem[] = [];
jest.mock("../../utils/axiosInstance", () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn(), patch: jest.fn() } }));
const mockComplete = jest.fn();
const mockPrompted = jest.fn();
jest.mock("../../store/hooks", () => ({ useAppSelector: (selector: (state: unknown) => unknown) => selector({ session: { loggedUserId: 8 } }) }));
jest.mock("../../api/requiredActions", () => ({
  useMyRequiredActions: () => ({ data: { actions: mockActions, summary: { total: mockActions.length, blocking: 0 } }, isFetching: false }),
  useCompleteRequiredAction: () => ({ mutateAsync: mockComplete, isPending: false }),
  useMarkRequiredActionPrompted: () => ({ mutate: mockPrompted }),
  useCompleteRequiredProfileFields: () => ({ isPending: false }),
  useConfirmStaffPayoutReceipt: () => ({ isPending: false }),
  useDecideRequiredManagerSwap: () => ({ isPending: false }),
  useRespondToRequiredSwap: () => ({ isPending: false }),
}));
jest.mock("../volunteerCleaning/CleaningReviewAction", () => ({ __esModule: true, default: ({ submissionId }: { submissionId: number }) => <div>Cleaning review {submissionId}</div> }));
jest.mock("./StaffPayoutReceiptConfirmation", () => ({ ESignaturePad: () => <div>Signature required</div>, StaffPayoutReceiptConfirmation: () => <div>Payment receipt</div> }));
jest.mock("../cerebro/CerebroRichTextContent", () => ({ CerebroRichTextContent: () => null }));

const cleaningAction = (revision: number): RequiredActionItem => ({
  id: "required_action:11", recordId: 11, source: "required_action", type: "cleaning_review", blocking: false,
  title: "Review cleaning", payload: { cleaningSubmission: { submissionId: 3, revision } },
});

describe("Cleaning required-action overlay", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.clear();
    mockActions = [cleaningAction(1)];
    Object.defineProperty(window, "matchMedia", { writable: true, value: jest.fn().mockImplementation((media) => ({ matches: false, media, onchange: null, addListener: jest.fn(), removeListener: jest.fn(), addEventListener: jest.fn(), removeEventListener: jest.fn(), dispatchEvent: jest.fn() })) });
    Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, writable: true, value: class { observe() {} unobserve() {} disconnect() {} } });
  });
  it("defers a review without completing it and resurfaces a new revision", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = () => <QueryClientProvider client={client}><MantineProvider><RequiredActionsOverlay enabled /></MantineProvider></QueryClientProvider>;
    const { rerender } = render(view());
    expect(screen.getByText("Cleaning review 3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review later" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockComplete).not.toHaveBeenCalled();
    mockActions = [cleaningAction(2)];
    rerender(view());
    expect(await screen.findByText("Cleaning review 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review later" })).toBeInTheDocument();
  });
  it("does not add Review later to a required profile action", () => {
    mockActions = [{ ...cleaningAction(1), type: "profile_fields", blocking: true, title: "Profile required", payload: { fields: [] } }];
    const client = new QueryClient();
    render(<QueryClientProvider client={client}><MantineProvider><RequiredActionsOverlay enabled /></MantineProvider></QueryClientProvider>);
    expect(screen.queryByRole("button", { name: "Review later" })).not.toBeInTheDocument();
  });
});
