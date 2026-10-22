# Bookings Summary table

The Bookings section has its own search, filters, sorting and column controls. These affect the list and its exports, not the headline totals or charts. The Summary's selected date range and product-type access scope still apply to every row.

## Find and arrange bookings

- Combine column filters: every active column filter must match. The filter-menu icon selects contains, exact/not-equal, empty/not-empty, numeric/date comparisons or inclusive/exclusive ranges as appropriate.
- Click a heading to sort. Shift-click additional headings for multi-column sorting.
- Source-received dates filter by Europe/Warsaw calendar day, including daylight-saving changes. Sorting uses the actual source-received instant; missing dates sort last.
- Use Show/Hide columns to customize the visible fields. Booking ID and customer email remain visible by default as independent, hideable columns. Separate experience-time and currency columns are also available.
- All column titles and booking values are centered horizontally and vertically. Long names, references and email addresses wrap.
- Reset table restores filters, filter conditions, sorting, column visibility, pinning and pagination. Table settings are local to the mounted view, not saved as company-wide configuration.

## Share or download

Choose **All matching bookings** (every page) or **Current page** before exporting. Both options respect current filters, sorting, and visible data columns. The preview count shows exactly how many bookings and columns are included. Exporting does not expand or change pagination. Actions and internal table spacer columns are never exported.

Report context notes which filters/search were applied, but omits global-search text and hidden-column filter values so hiding an email/identifier cannot leak it through a report heading.

- **Share image** copies a PNG to the clipboard. If the browser does not support or allow image clipboard access, the same PNG downloads instead.
- **PNG** creates a clean table image, with wrapped values and report context. Oversized images fail with guidance instead of silently truncating bookings; choose Current page, fewer columns, Excel, CSV or PDF.
- **Excel** creates an `.xlsx` workbook with centered cells, frozen headers, filters and a Report scope worksheet. Amounts/guest counts remain numeric; booking identifiers remain text to avoid rounding long IDs.
- **PDF** creates a paginated, image-based A3 landscape report. Wide tables split into column groups with the first visible column repeated. Headers, row ranges and font scale stay consistent across pages. Use Excel or CSV when selectable/editable cell data is needed.
- **CSV** includes UTF-8 encoding for names and protects customer-controlled text from being interpreted as spreadsheet formulas.

Export generation runs in the browser without uploading booking data to a third-party conversion service. Image/PDF and Excel export code is lazy-loaded when requested.
