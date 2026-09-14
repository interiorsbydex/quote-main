# V1 and V2 rollout validation

**Validation date:** 21 August 2026  
**Environment:** staging/development database only. Production was not read or changed.

## Result at a glance

| Requested condition | Result | What was verified |
| --- | --- | --- |
| Existing V1 quotation remains visibly and functionally V1 after V2 is active | **Pass** | A disposable browser-created copy of an existing V1 quotation reopened with the `V1 - Initial Catalog` badge while `V2 Client Test` was the active price list. |
| New V1 line items keep V1 pricing | **Pass** | The same service was added through the line-item wizard at ₹76 per unit. Two units previewed and saved as ₹152. The V1 quotation reopened with the ₹152 service subtotal intact. |
| V1 customizations and quotation adjustments persist | **Pass** | A per-quotation newer-product addition was shown as one added product at ₹2,860, and the 1.5% enablement fee plus 2% discount remained visible after refresh. The normal V1 line was not repriced. |
| V1 updates remain after save, refresh, and reopen | **Pass** | Room line count, service subtotal, adjustments, grand total, V1 badge, and the added-product indicator were all still visible after reload. |
| A new project receives V2 after rollout | **Pass** | A project created from the normal **New Project** dialog showed the `V2 Client Test` badge immediately and after reload. |
| New V2 rooms, lines, and adjustments remain V2 | **Pass** | A room and the same service were added through the UI. V2 priced two units at ₹200 total (₹100 each), and the 1.5% enablement fee plus 2% discount remained after refresh. |
| Admin can intentionally create a fresh V1 quotation for a customer with no V1 quotation | **Gap** | The New Project dialog has no price-list selector or V1 option. It always creates from the current active price list, which was V2. |

## Pricing evidence

The same service, **Gypsum False Ceiling**, was deliberately used in both flows:

| Quotation | Price per unit | Quantity | Saved service subtotal |
| --- | ---: | ---: | ---: |
| Existing V1 quotation | ₹76 | 2 | ₹152 |
| New V2 quotation | ₹100 | 2 | ₹200 |

This is a real price difference, not a badge-only check.

## Admin controls checked

- The active list was `V2 Client Test`.
- The pricing-control screen showed **“Reviewing is turned on”** and the **Sync goes live instantly** switch was off.
- With that setting, quotations keep using their own stamped price list. This setting must remain off for V1/V2 isolation to work as tested.
- The create-project dialog offered project type and Xpress/Xpand style choices only. It did **not** offer V1/V2 price-list selection.

## Safe day-to-day workflow

1. Leave **Sync goes live instantly** off while V1 quotations must remain isolated.
2. Open an existing customer quotation to continue it on V1. Add normal products, rooms, and quote adjustments there; its V1 badge confirms the price list in use.
3. Use **New Project** for customers who are ready to receive a new quotation. Those projects will start on the active V2 list.
4. If an existing V1 customer needs a product that exists only in V2, use **Add a newer product** on that quotation. It adds the product only to that quote and displays the recorded added-product price; it does not alter V1 or any other quotation.
5. Do not promise a new V1 quotation for a customer who has no existing V1 project. The current UI has no intentional way to create one.

## Required rollout decision

Before rollout, decide how to handle customers still in discussion who do not yet have a V1 quotation:

- **If they should receive V2 pricing:** create a normal new project.
- **If they must receive V1 pricing:** do not proceed until an intentional, audited V1-project creation path is approved and implemented. Manually changing database records is not a safe operating workflow.

## Cleanup

The validation used a disposable staging admin account, V1 quotation copy, V2 quotation, room, line items, added-product exception, and client. Each was removed after verification. No production data, Google Sheet data, or V2 catalog rows were modified.