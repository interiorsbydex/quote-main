---
name: Xpress/Xpand one-price rows
description: Why one-price Admin additions must populate two positional price cells.
---

For Xpress/Xpand products created from a single Admin-entered price, write that value to both Sheet column J (rate) and column M (selling price).

**Why:** The live header emphasizes J, but the normal catalog parser still reads J as `rate` and M as the final quote-facing `sellingPrice`. Leaving M blank makes a later Sheet sync turn an initially correct new product into a zero-selling-price row.

**How to apply:** Any future additive Sheet writer or import path that accepts only one Xpress/Xpand price must mirror it into both positional fields, then verify an append-to-sync round trip keeps the same rate and selling price.