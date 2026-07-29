# Scout Review-Sheet Builder (`tools/sheet-builder/`)

A specialized, high-observability CSV layout utility designed specifically to output structured image-scout candidate spreadsheets that satisfy `verify-review-sheet.cjs`.

## Features
1.  **Strict Schema Enforcement**: Guarantees column-key order matching `Rank`, `Image Title`, `Theme`, `Why it fits`, `Overlay copy-space`, `Downloadable (under plan)`, `Approved?`, and `Image Link`.
2.  **No Silent Failures**: Fails loud and throws a descriptive error if mandatory fields (such as `Image Link` URLs or `Image Title` headers) are missing from the input candidate rows.
3.  **Drive-Upload Payload Generation (`lib/sheet-payload.cjs`)**: Packages the raw CSV payload into the correct multipart metadata format for Google Drive's API (`application/vnd.google-apps.spreadsheet`), enabling automatic conversion to Google Sheets upon upload.

## Usage
```bash
node tools/sheet-builder/build-review-sheet.cjs --input <json-file> --output <csv-file>
```

## Columns Mapped
*   **Rank**: Row number or contiguous index.
*   **Image Title**: Clean image candidate name.
*   **Theme**: The specific campaign or aesthetic theme.
*   **Why it fits**: Relevance reasoning.
*   **Overlay copy-space**: Descriptions of layout overlay safety.
*   **Downloadable (under plan)**: Validated plan-download status.
*   **Approved?**: Intentionally left blank for operator ratification.
*   **Image Link**: Clean, un-stripped URLs.
