# FinanceD Future Ideas

These are possible product or technical directions, not a TODO list, roadmap commitment, or MVP blocker list. Reconsider them only when demonstrated product need justifies the added behavior and operating cost.

## Structural / geometric PDF extraction

Some difficult born-digital PDFs preserve table geometry that plain extracted text loses. A prior experiment showed Tabula/PDFBox retaining values such as `3.800`, `1.45`, and `4.30`, while scanned Israeli archive PDFs yielded no tables.

Possible future approaches:

- Tabula/PDFBox;
- coordinate-aware extraction using the existing Node PDF stack.

This is deferred because the current vision-AI path solves the demonstrated difficult case sufficiently, and Java or further extraction complexity is not justified before MVP need is proven.

## Vendor to accounting-account learning

A future suggestion history could conceptually resemble:

```text
vendor_account_map
vendor_id
account_id
times_used
last_used_at
```

One vendor can map to **multiple** accounts. Usage frequency and recency could suggest likely accounts. A first version should suggest rather than automatically post. Do not design or migrate this table without a separately approved product requirement.

## AI provider fallback

A possible direction is MiMo as primary with an optional low-cost OpenRouter vision fallback only when the primary provider fails operationally—for example a 429, timeout, provider 5xx, outage, or exhausted credits.

Do not switch providers automatically merely because extraction quality appears poor. Quality ambiguity requires user review; it is not a reliable failover signal.

## Copy diagnostics / developer support

A discreet UI action could copy non-sensitive support context such as FinanceD commit/version, route, invoice ID, browser/device, HTTP status or error, validation state, and timestamp. Financial and vendor-sensitive data should be excluded by default.

## Budget mobile UI

A month-oriented mobile view could use:

```text
Month selector
Category
Budget
Actual
Variance
```

The current desktop-oriented Budget v1 remains acceptable for MVP.

## Payment-status future writer

`supplierInvoices.paymentStatus` remains canonical. A future Banking/Reconciliation module could become another controlled writer to that state instead of relying only on the current manual invoice action.

## Future maintenance / scale notes

These are **observe-first / not current work**:

- Consider an optional warning when deactivating a Chart of Accounts account used by a Budget mapping.
- Revisit Budget report aggregation and query performance only if invoice volume becomes materially large.
- Revisit the implications of storing invoice-line account codes as free text if Chart of Accounts renaming is later introduced.
