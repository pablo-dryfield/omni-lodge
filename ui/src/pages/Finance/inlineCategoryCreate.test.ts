import type { FinanceCategory } from "../../types/finance";
import {
  CREATE_NEW_CATEGORY_VALUE,
  CREATE_NEW_CATEGORY_LABEL,
  filterInlineCategoryOptions,
  getInlineCategoryNameSuggestion,
  getInlineCategoryOptions,
  getInlineParentCategoryOptions,
  getTransactionCategoryKind,
  validateNewFinanceCategoryName,
} from "./inlineCategoryCreate";

const categories: FinanceCategory[] = [
  {
    id: 1,
    kind: "expense",
    name: "Rent",
    parentId: null,
    isActive: true,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: null,
  },
  {
    id: 2,
    kind: "income",
    name: "Tour sales",
    parentId: null,
    isActive: true,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: null,
  },
];

describe("inline finance category creation", () => {
  it("maps transaction kinds to the matching category kind", () => {
    expect(getTransactionCategoryKind("expense")).toBe("expense");
    expect(getTransactionCategoryKind("income")).toBe("income");
    expect(getTransactionCategoryKind("refund")).toBe("income");
    expect(getTransactionCategoryKind("transfer")).toBeNull();
  });

  it("places the create action after matching categories", () => {
    expect(getInlineCategoryOptions(categories, "expense", true)).toEqual([
      { value: "1", label: "Rent" },
      { value: CREATE_NEW_CATEGORY_VALUE, label: CREATE_NEW_CATEGORY_LABEL },
    ]);
  });

  it("keeps the create action last when a search has no category matches", () => {
    expect(filterInlineCategoryOptions({
      options: [
        { value: "1", label: "Rent" },
        { value: CREATE_NEW_CATEGORY_VALUE, label: CREATE_NEW_CATEGORY_LABEL },
      ],
      search: "Venue supplies",
      limit: 10,
    })).toEqual([
      { value: CREATE_NEW_CATEGORY_VALUE, label: CREATE_NEW_CATEGORY_LABEL },
    ]);
  });

  it("does not expose the create action without category create access", () => {
    expect(getInlineCategoryOptions(categories, "expense", false)).toEqual([
      { value: "1", label: "Rent" },
    ]);
  });

  it("shows the complete parent path and level for nested categories", () => {
    const nestedCategories: FinanceCategory[] = [
      { ...categories[0], id: 10, name: "Operations", parentId: null },
      { ...categories[0], id: 11, name: "Venue", parentId: 10 },
      { ...categories[0], id: 12, name: "Supplies", parentId: 11 },
    ];

    expect(getInlineParentCategoryOptions(nestedCategories, "expense")).toEqual([
      {
        value: "10",
        label: "Operations · Root",
        categoryName: "Operations",
        path: "Operations",
        parentPath: null,
        level: 1,
        hasHierarchyIssue: false,
      },
      {
        value: "11",
        label: "Operations › Venue · Level 2",
        categoryName: "Venue",
        path: "Operations › Venue",
        parentPath: "Operations",
        level: 2,
        hasHierarchyIssue: false,
      },
      {
        value: "12",
        label: "Operations › Venue › Supplies · Level 3",
        categoryName: "Supplies",
        path: "Operations › Venue › Supplies",
        parentPath: "Operations › Venue",
        level: 3,
        hasHierarchyIssue: false,
      },
    ]);
  });

  it("keeps inactive ancestors in the path but does not offer them as parents", () => {
    const nestedCategories: FinanceCategory[] = [
      { ...categories[0], id: 20, name: "Inactive root", parentId: null, isActive: false },
      { ...categories[0], id: 21, name: "Active child", parentId: 20, isActive: true },
    ];

    expect(getInlineParentCategoryOptions(nestedCategories, "expense")).toEqual([
      expect.objectContaining({
        value: "21",
        path: "Inactive root › Active child",
        level: 2,
        hasHierarchyIssue: false,
      }),
    ]);
  });

  it("keeps malformed orphan and cyclic categories finite and clearly marked", () => {
    const malformedCategories: FinanceCategory[] = [
      { ...categories[0], id: 30, name: "Orphan", parentId: 999 },
      { ...categories[0], id: 31, name: "Cycle A", parentId: 32 },
      { ...categories[0], id: 32, name: "Cycle B", parentId: 31 },
    ];

    const options = getInlineParentCategoryOptions(malformedCategories, "expense");
    expect(options).toHaveLength(3);
    expect(options.every((option) => option.hasHierarchyIssue)).toBe(true);
    expect(options.find((option) => option.value === "30")?.label).toBe("Orphan · Hierarchy issue");
  });

  it("requires a name and detects duplicates within the matching kind", () => {
    expect(validateNewFinanceCategoryName("  ", categories, "expense")).toBe("Category name is required.");
    expect(validateNewFinanceCategoryName(" rent ", categories, "expense")).toBe(
      "An expense category with this name already exists.",
    );
    expect(validateNewFinanceCategoryName("Rent", categories, "income")).toBeNull();
  });

  it("prefills a genuinely new category search without copying the selected label", () => {
    expect(getInlineCategoryNameSuggestion("Venue supplies", "Rent")).toBe("Venue supplies");
    expect(getInlineCategoryNameSuggestion(" rent ", "Rent")).toBe("");
    expect(getInlineCategoryNameSuggestion("", "Rent")).toBe("");
    expect(getInlineCategoryNameSuggestion(CREATE_NEW_CATEGORY_LABEL, "Rent")).toBe("");
  });
});
