# Layout-aware extraction research

Status: experimental comparison tooling only. Nothing in this work is connected to upload processing, the AI extraction route, Invoice Review, persistence, Apply, Save, or approval.

FinanceD remains deterministic-first. Geometry and OCR are evidence sources, not accounting authority. The prototype deliberately emits element references and table candidates; it does not parse, calculate, reconcile, approve, or save financial values.

## Confirmed FinanceD baseline

- `src/lib/extract.ts` uses `pdf-parse` for embedded PDF text and Tesseract.js for local image OCR. Both production paths currently store plain text, not element geometry.
- `app/api/invoices/[id]/extract/route.ts` keeps the born-digital text-first AI path. When a PDF has no usable text, or the user explicitly chooses `mode=image`, it renders PDF pages locally and sends them to a vision-capable provider.
- `src/components/InvoiceReview.tsx` exposes the explicit **Try image AI** action for PDFs. AI output remains a preview and the existing Apply, deterministic reconciliation, manual Save, and approval boundaries remain separate.
- `src/__tests__/scanned-pdf-ai-extraction.test.ts` covers text-first stopping, forced image mode, scanned-PDF rendering, document page order, model guards, cleanup, failure handling, existing image behavior, and reconciliation.
- `pdf-parse` 2.4.5 resolves PDF.js 5.4.296 and `@napi-rs/canvas` 0.1.80 in the lockfile. This experiment declares PDF.js 5.4.296 directly instead of depending on an internal/transitive path.

## 1. Native PDF evidence without OCR

### Confirmed

PDF.js `getTextContent()` exposes text items containing text, direction, a transform matrix, width, height, font identity, and end-of-line information. Page proxies expose page number and viewport dimensions. These inputs are sufficient to derive page-relative, top-left bounding boxes for born-digital text without OCR. See the [PDF.js API documentation](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html).

The public `pdf-parse` text result retains page text but not the underlying item transforms. Its `getTable()` and `getScreenshot()` methods are useful public capabilities, but item geometry requires the direct PDF.js API.

PDF content-stream order is not guaranteed to be intuitive reading order. The PDF.js project has documented examples where `getTextContent()` follows unexpected internal order. See [PDF.js issue 17191](https://github.com/mozilla/pdf.js/issues/17191).

### Prototype decision

Each element has a source-namespaced deterministic ID such as `pdf-text:p1-e000109` or `ocr-word:p1-e000109`. This prevents native-PDF and OCR artifacts for the same page/order from producing an ambiguous reference. Each element also preserves both:

- `contentOrder`: order returned by PDF.js; and
- `visualOrder`: deterministic top-to-bottom, then left-to-right ordering.

The visual order is a reproducible heuristic, not a claim about semantic reading order. Boxes are stored in top-left page coordinates and normalized 0..1 coordinates, with page dimensions retained for later overlays.

The synthetic integration fixture includes 90-degree rotated text and verifies that its transformed axis-aligned box is tall rather than wide. This checks matrix handling, but does not prove correct semantic ordering for arbitrary rotation angles.

## 2. Deterministic row and column clustering

### Confirmed

The installed `pdf-parse.getTable()` detects vector rectangles and horizontal/vertical ruling lines, builds grid cells, and places positioned text into them. This is useful for ruled or lattice-like tables.

### Inference to validate on a labeled corpus

Borderless invoice tables can often be proposed by clustering visual lines and recurring x positions. The prototype first splits a page into conservative vertically contiguous regions, learns recurring column anchors independently inside each region, and can emit multiple candidates per page. This prevents widely separated aligned blocks from being combined merely because their x positions match. It uses only geometry and emits cells containing evidence IDs. A line that does not occupy at least two recurring columns is reported as sparse and excluded rather than guessed into an adjacent row.

The region gap threshold is itself heuristic. It can split a real table with unusually large vertical gaps or fail to split adjacent tables separated by only a small gap. False negatives are intentionally preferred to cross-table associations. Other likely failure cases include wrapped descriptions, merged cells, sparse adjustment rows, multi-row headers, rotated text, repeated page headers, inconsistent column alignment, and unusual PDF glyph chunking. Consequently, table candidates must not become automatic invoice lines without measured evidence and explicit product approval.

## 3. What Tabula adds

### Confirmed

Tabula-java provides a mature table-specific engine with:

- lattice mode for tables separated by ruling lines;
- stream mode for tables without ruling lines;
- page-area guessing;
- explicit page areas and column boundaries; and
- CSV, TSV, and JSON output.

See the [tabula-java README and CLI documentation](https://github.com/tabulapdf/tabula-java). Tabula works on text-based PDFs and does not itself solve scanned-document OCR; see the [Tabula project README](https://github.com/tabulapdf/tabula).

Tabula therefore adds accumulated table heuristics, especially for borderless tables. It does not provide a uniquely unavailable source of PDF geometry: PDF.js already exposes positioned text and drawing operators, and FinanceD already renders PDF pages in Node.

The latest published tabula-java release listed by GitHub is 1.0.5 from August 2021 and updated PDFBox to 2.0.24. See [tabula-java releases](https://github.com/tabulapdf/tabula-java/releases). Dependency age must be included in any later maintenance and security decision.

## 4. Render operational cost of Tabula

### Confirmed

Render supports Node natively but directs JVM applications to Docker. See [Docker on Render](https://render.com/docs/docker). Tabula also notes that JVM startup is a significant part of command-line extraction cost.

Current Render web-service instance documentation lists 512 MB for Free and Starter and 2 GB for Standard. See [Render instance types](https://render.com/docs/compute-plans). Tabula's full application documentation gives an example JVM configuration of `-Xms256M -Xmx1024M`; that is not a measured minimum for the smaller CLI jar, but it demonstrates why a Node process, native canvas, PDF buffers, and a JVM should not be assumed to fit safely on a 512 MB instance.

### Inference

Production adoption would require one of:

- a mixed Node/JRE Docker image and supervised child processes;
- a continuously running Java process; or
- a separate Java service.

All options add image size, build complexity, startup or lifecycle management, concurrency limits, memory pressure, dependency patching, and failure handling. Tabula should remain an offline benchmark comparator unless it materially outperforms the Node prototype on FinanceD's difficult-invoice corpus.

## 5. Common OCR evidence

### Confirmed

Tesseract.js can explicitly return `blocks` with nested paragraphs, lines, words, confidence, and bounding boxes. See the [Tesseract.js recognition API](https://github.com/naptha/tesseract.js/blob/master/docs/api.md) and [Tesseract.js types](https://github.com/naptha/tesseract.js/blob/master/src/index.d.ts).

The experimental mapper rejects non-finite/non-positive page dimensions, non-finite or out-of-range confidence, and malformed or out-of-page word boxes before converting words into the common evidence format. Image pixels are the source coordinate space. For scanned PDFs, the developer probe can explicitly render pages and run local OCR with a five-page bound. This is never automatic and does not replace the existing vision route. OCR confidence is stored as evidence metadata only.

Tesseract language assets are a runtime cost. Unless deployment supplies a local `langPath`, Tesseract.js can download trained-language data when a worker is created. The experimental worker sets `cacheMethod: "none"` so the probe does not leave a language cache in the repository, which also means later invocations can repeat that download and startup cost. OCR therefore needs explicit network/runtime planning, timeouts, memory limits, and deployment-local language assets before any production consideration.

## 6. Evidence-ID semantic assist

### Proposed future boundary

A future model could select existing evidence IDs, for example:

```json
{
  "grossAmount": {
    "sourceElementIds": ["pdf-text:p1-e000109"]
  }
}
```

The server would have to reject unknown IDs, resolve the referenced text itself, perform deterministic parsing, enforce the existing extraction schema, and run the existing monetary reconciliation. The model should not be permitted to provide a replacement financial value alongside the ID.

IDs are deterministic and source-unambiguous within a versioned evidence artifact. They are not promised stable after an extractor-version change.

## 7. Future source highlighting

### Confirmed infrastructure potential

Page number, page dimensions, top-left boxes, and normalized boxes are enough to locate an element on a rendered document. Images can use a positioned overlay directly.

### Future UI inference

The current PDF document is displayed in a browser iframe, which is not a reliable host for a sibling application overlay. Exact highlighting would probably require a controlled PDF.js canvas/viewer layer. That UI is explicitly outside this prototype.

## Prototype use and privacy

Run the comparison only with an explicit local path:

```text
npm run probe:layout -- path/to/invoice.pdf
```

Local OCR is optional and bounded to five pages:

```text
npm run probe:layout -- path/to/scanned-invoice.pdf --ocr
```

The probe requires exactly one positional PDF path, rejects duplicate/unknown flags, checks both file metadata and the bytes actually read against the 25 MiB limit, and writes JSON only to stdout. The JSON contains document text, so operators must treat it as sensitive and must not paste it into logs, issue trackers, or source control. No probe result is persisted by FinanceD.

## Recommendation

Keep this work research-only. Evaluate the Node geometry and clustering output against a privacy-safe, labeled corpus of difficult invoices. Measure row/cell precision and false association rates before considering any production connection. Benchmark Tabula offline against the same corpus only if the Node result leaves a material, demonstrated gap.
