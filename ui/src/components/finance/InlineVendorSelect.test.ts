import {
  CREATE_VENDOR_OPTION_VALUE,
  filterInlineVendorOptions,
  getInlineVendorNameSuggestion,
  resolveInlineVendorDefaultCategoryId,
  validateInlineVendorName,
} from "./inlineVendorCreate";

const options = [
  { value: "1", label: "Venue One" },
  { value: "2", label: "Print House" },
  { value: CREATE_VENDOR_OPTION_VALUE, label: "Create new vendor" },
];

describe("inline finance vendor creation", () => {
  it("keeps the create action last when a search has no vendor matches", () => {
    expect(filterInlineVendorOptions({ options, search: "new supplier", limit: Infinity })).toEqual([
      options[2],
    ]);
  });

  it("keeps matching vendors before the create action", () => {
    expect(filterInlineVendorOptions({ options, search: "venue", limit: Infinity })).toEqual([
      options[0],
      options[2],
    ]);
  });

  it("prefills a typed new name without copying the current selection", () => {
    expect(getInlineVendorNameSuggestion("New Supplier", "Venue One")).toBe("New Supplier");
    expect(getInlineVendorNameSuggestion(" venue one ", "Venue One")).toBe("");
    expect(getInlineVendorNameSuggestion("Create new vendor", "Venue One")).toBe("");
    expect(getInlineVendorNameSuggestion("+ Create new vendor", null)).toBe("");
  });

  it("requires a name and detects existing vendors case-insensitively", () => {
    const vendorOptions = options.slice(0, 2);
    expect(validateInlineVendorName("  ", vendorOptions)).toBe("Vendor name is required.");
    expect(validateInlineVendorName(" print house ", vendorOptions)).toBe(
      "A vendor named Print House already exists. Select it from the list instead.",
    );
    expect(validateInlineVendorName("New Supplier", vendorOptions)).toBeNull();
  });

  it("prefills only an available default category and keeps it optional", () => {
    const categories = [
      { value: "7", label: "Operations › Rent" },
      { value: "9", label: "Operations › Supplies" },
    ];

    expect(resolveInlineVendorDefaultCategoryId(7, categories)).toBe(7);
    expect(resolveInlineVendorDefaultCategoryId(8, categories)).toBeNull();
    expect(resolveInlineVendorDefaultCategoryId(null, categories)).toBeNull();
  });
});
