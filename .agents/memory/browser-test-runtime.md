---
name: Browser test runtime
description: Browser-based verification in this workspace may need the system Chromium executable rather than Puppeteer's bundled browser.
---

Use the system Chromium binary discovered in the workspace when Puppeteer cannot find its bundled browser.

**Why:** The project has Chromium available through the Replit/Nix environment, but Puppeteer may not have a downloaded browser in its cache.

**How to apply:** Check `which chromium` and known Nix profile paths before treating a browser test failure as an application failure.