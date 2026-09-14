---
name: Catalog product images
description: Constraints on image formats and access when catalog images flow from Google Sheets into quotations.
---

Catalog product images must be supplied as URL text in a Sheet column whose header contains “image” (the live Stone tab currently misspells it “Imgae,” which is also recognized). Do not rely on images pasted or inserted directly into cells.

**Why:** Google Sheets’ values API returns URL text but does not expose pasted in-cell/over-cell image content. Existing Drive sharing links also redirected anonymous quote viewers to Google sign-in until their file permissions were made public.

**How to apply:** Use an HTTPS ImgVision direct image URL, or a Google Drive file link after setting the file to “Anyone with the link — Viewer.” Then sync the tab and update the live catalog through the Admin pricing workflow.