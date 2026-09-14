# Price lists: the complete team guide

For the Interiors by DeX team. No technical knowledge needed — just read it top to
bottom once, then come back to the relevant section when a situation comes up.

## Contents

1. [The one rule](#the-one-rule)
2. [The three places prices live](#the-three-places-prices-live)
3. [Which sheet, which tabs](#which-sheet-which-tabs)
4. [Who can do what](#who-can-do-what)
5. [How a price reaches a quotation](#how-a-price-reaches-a-quotation)
6. [Editing the Google Sheet, step by step](#editing-the-google-sheet-step-by-step)
7. [Using the Pricing Versions screen, step by step](#using-the-pricing-versions-screen-step-by-step)
8. [Every situation you'll run into](#every-situation-youll-run-into)
9. [What is recorded](#what-is-recorded)
10. [Things the system will refuse to do](#things-the-system-will-refuse-to-do)

---

## Before anything else: the review switch

At the top of the Pricing Versions screen there is one switch: **"Sync goes live
instantly"**.

**While it is ON (how it is set today)** the app behaves exactly as it did before price
lists existed. An admin syncs the Google Sheet and the new prices are in front of the
whole team immediately. There is no review step and nothing else to click. The rest of
this guide still applies — the Draft, the versions and the audit log all still exist —
but the sync does the "apply" step for you.

**While it is OFF** syncing only fills the Draft. Nobody sees the new prices until an
admin reviews them and clicks either **Update live price list** or **Release as new
version**.

The switch also decides **which price list an existing quotation builds from**:

- **ON** — every quotation, however old, builds from the live price list. A product added
  to the sheet this morning can be added to a quotation created last month, or to a copy
  of one. This is how the app worked before price lists existed.
- **OFF** — every quotation builds from the price list it was created on. An old quotation
  will not offer newly added products, which is the point of the review workflow: the
  prices you quoted are the prices you can still add.

Either way, **prices already saved on a quotation never move**, and products granted to a
single quotation keep the price they were granted at.

Only an admin can flip the switch, and it can be flipped back at any time. Nothing else
in the app changes when you do — in particular, **prices already saved on a quotation
never move either way.**

---

## The one rule

**A new numbered price list is created only when someone clicks "Release as new
version".**

Nothing else creates one.

- Editing the Google Sheet does not create one.
- Syncing does not create one.
- **Update live price list** does not create one — it changes the list already in use.
- Adding a product to a single quotation does not create one.

You could sync the Sheet twenty times in one morning and still have zero new price
lists. The number of price lists you will ever have is exactly the number of times
someone released one.

### The two ways to apply reviewed changes

Once you have reviewed the Draft, you choose one of two buttons:

| | **Update live price list** | **Release as new version** |
|---|---|---|
| When | Everyday work: a new product, a corrected rate, a small addition | A deliberate rate overhaul, a new financial year's catalog |
| What it does | Applies your changes to the price list already live, keeping its number and name | Creates the next numbered list and makes it live |
| Existing projects | Immediately see the new items and the corrected prices | Stay on the list they were created with |
| Quotation lines already saved | Unchanged | Unchanged |

The important difference is the third row. Releasing a new version leaves every existing
project behind on the old one, which is right for a genuine price edition and wrong for
"we just added one washbasin." Updating the live list is what lets a product you added
this morning be used on a project created six months ago.

Neither option ever moves a price that is already saved on a quotation. Each line stores
its own rate the moment it is added, so it stays exactly as quoted no matter what happens
to the catalog afterwards.

---

## The three places prices live

**1. The Google Sheet — your workshop**

Change anything, any time, as many people as you like. Nothing here reaches a client.
The Sheet is not connected live to the app — the app only sees what you sync in.

**2. The Draft — one tray**

There is only ever one Draft. Syncing takes what is in the Sheet and puts it in the
Draft. Sync again and the Draft is refreshed again. It is a review copy: no client and
no quotation is ever priced from it directly.

Only the tabs you tick when syncing are pulled in. A tab you leave unticked is not read
at all — whatever is already in the Draft for that tab stays exactly as it was.

**3. The live price list — what everyone is quoting from**

One price list is live at a time. Every project created while it is live is pinned to it,
and stays pinned to it. "Update live price list" changes its contents in place, which is
how a newly added product reaches all of those projects at once.

**4. Archived versions — frozen editions**

When you release a new version, the previous live list is archived. An archived list can
never be changed again: it is the historical record of what the quotations pinned to it
were priced from.

A published version is always the *complete* catalog, not just what changed. Every item
you didn't touch is still in it, carried forward at its previous price, so any
quotation on that version can still price any product — not only the ones that moved.

---

## Which sheet, which tabs

There is **one** Google Sheet, titled **"Quote Gen - Blueprint | Final."** That is the
only one connected to the app — edit it directly, there's no separate "main" copy.

It has around 30 tabs in total, but only **7 of them are the live catalog**. Edit
whichever one covers what you're changing:

| Tab | What it covers |
|---|---|
| DeX - Xpress | Modular woodwork, Xpress range |
| DeX - Xpand | Modular woodwork, Xpand range |
| DeX - Services | Service line items |
| DeX - Accessories | Accessories |
| DeX - Lights | Lighting |
| DeX - Stone Master | Stone / countertop items |
| DeX - Handles | Handles |

**The other ~23 tabs are not part of pricing.** They're old GQ test quotations,
templates, and "Copy of ..." duplicates left over from before this system existed.
Editing them does nothing — the app never reads them. If you're ever unsure whether
you're looking at the right tab, check the name against the table above.

**A backup copy of the whole spreadsheet also exists in Drive**, named something like
*"Quote Gen - Blueprint | Final — BACKUP before Pricing Versions [date]."* It's a frozen,
one-time safety snapshot taken before a past change — not wired into the app in any way,
and not kept in sync with the real sheet. If you ever open a spreadsheet and the prices
or item codes look out of date, check the browser tab title: if it says "— BACKUP", close
it and reopen the real one.

Two small quirks of the 7 real tabs, both harmless:

- A few tab titles carry a stray trailing space or a double space (e.g. `"DeX -
  Accessories "`, `"DeX -  Lights"`). That's cosmetic. The app doesn't match tabs by their
  exact title text — it matches by a fixed internal ID that Google assigns to each tab,
  so a small rename won't break anything. What *would* break it: deleting a tab and
  creating a new one with the same name, since that gives it a brand-new internal ID the
  app doesn't recognise. Edit tabs in place; don't delete and recreate them.
- There's one more tab that looks like a duplicate of "DeX - Services." It's deliberately
  disabled and excluded from sync — it's a record of an old layout, not a spare. Leave it
  alone.

---

## Who can do what

- **Syncing the Sheet, publishing, reverting to a previous version, adding/removing a
  product on one specific quotation, and viewing a published version's full price list**
  all require an admin account. A regular team member can't do any of these.
- **Viewing which extra products were added to a particular quotation** (the list shown
  in that quotation's "Add a newer product" panel) is available to anyone who can already
  open that quotation — but adding or removing one still needs an admin.
- There's no extra tier above "admin" right now — any admin can publish. If you want
  publishing limited to specific people, that would be a separate change.

---

## How a price reaches a quotation

Every quotation is stamped, permanently, with whichever price list was live at the exact
moment it was created. That stamp is set automatically — nobody picks it — and it never
changes afterwards, no matter what you do to the quotation later or what gets published
afterwards.

- **A brand-new quotation, started today** → priced from whatever is live today.
- **An existing quotation** → still priced from whatever was live on the day it was
  created, forever — even if ten new price lists have been published since, even if you
  add rooms or edit line items on it today.
- **A single product added to one old quotation** (see the scenario below) → priced from
  whichever price list was live *at the moment it was added* to that quotation, and that
  price then stays fixed too — it does not follow that product if its price changes
  again later. To pick up a newer price for it, remove it from the quotation and add it
  back.

Every quotation shows a small tag naming which price list it's on, so you can always
tell at a glance.

---

## Editing the Google Sheet, step by step

This is the part your team does most often, and it needs no login to the app at all.

1. **Open the Sheet** — "Quote Gen - Blueprint | Final" in Google Sheets, shared with
   your team as usual.
2. **Find the right tab** at the bottom — one of the 7 listed above. If several products
   are changing, you may need more than one tab.
3. **Edit the price cell** for the row you want to change. Leave every other cell on
   that row alone unless the product itself is changing (description, brand, etc.) — the
   Item Code column especially should never be touched by hand once a product has one.
4. **Save** — Google Sheets saves automatically as you type. There's nothing else to
   click here.
5. **Repeat for every product changing**, across as many tabs as needed, whenever it
   suits you. There is no deadline and no lock — the Sheet is always editable.
6. **When ready, move to the app** and follow the next section to sync, review, and
   publish. Nothing you just did in the Sheet has reached a client yet.

If you're adding a brand-new product rather than changing a price, add the full row
(all the columns that tab expects) and leave the Item Code cell blank. Codes are **not**
assigned automatically just by adding the row or syncing — after syncing, an admin needs
to go to the **Sheet wiring** tab in the app and click **Generate codes** (see below) so
the new row gets a proper code before anyone relies on it. Never type a code in by hand;
let the app assign it, so it can never collide with a code already in use.

---

## Using the Pricing Versions screen, step by step

In the app, go to **Pricing versions** (admin only). The page is organised into tabs
across the top: **Draft preview**, **Published versions**, **Sheet wiring**, **Audit
log**, and **How this works**.

### Syncing

1. Click **Sync Google Sheet** at the top of the page.
2. A checklist of the 7 catalog tabs appears. Tick only the ones you actually changed,
   or use **Select all** to pull in everything. Untouched tabs are left exactly as they
   already are in the Draft.
3. Click **Sync [n] tabs**. This reads the sheet and updates the Draft only — it changes
   nothing a client can see.
4. You'll see a confirmation with the item count and any errors or warnings (for example,
   a row missing an item code). Fix those in the Sheet and sync again if needed — you can
   sync as many times as you like.

### Reviewing the Draft

Go to the **Draft preview** tab. This is the most important screen before you publish:

- A **"What is in the Draft right now"** card shows the total item count, when it was
  last synced, and by whom — and flags any tab that has *never* been synced into this
  Draft (its prices are simply carried over from the last published version).
- Below that, every price change is grouped: **Changed prices** (split into increases and
  decreases), **New catalog items**, and **Removed from Draft**. Each row shows the
  old price, an arrow, and the new price.
- Any single item whose price moved by **25% or more** gets a small warning icon next to
  it. This doesn't block anything — some 25%+ moves are genuine (a new stone slab, a
  supplier switch) — it's just a nudge to double-check that row in the Sheet wasn't a
  typo before you publish it.
- If the Draft matches the live price list exactly, you'll see "Draft matches Live" and
  nothing more to do.

### Updating the live price list (the everyday option)

1. From the Draft preview tab, click **Update live price list**.
2. A confirmation box summarises what's about to be applied — how many price changes,
   additions and removals — and tells you how many projects will gain access to them.
3. Optionally note the reason (e.g. "added new washbasin item").
4. Tick the confirmation checkbox, then click **Update live price list**.

The live price list now contains those items, under the same number and name. Every
project already on it can use the new products immediately, with no need to recreate a
quotation. Lines already saved on any quotation keep the exact price they were given.

One thing to watch: if the Draft no longer contains an item that is currently live, this
removes it for everyone on that price list. Removals are listed in the preview and in the
confirmation box before you commit.

### Releasing a new version (the deliberate option)

1. From the Draft preview tab, click **Release as new version**.
2. A confirmation box summarises exactly what's about to go live — how many price
   changes, additions, and removals — and repeats who last synced the Draft and whether
   that sync had errors.
3. Optionally name the version (e.g. "April 2026 catalog") and add a short note about
   what was reviewed.
4. Tick the confirmation checkbox ("I have reviewed the changes above...") — releasing
   is disabled until you do.
5. Click **Publish reviewed Draft**.

New quotations now use the new prices immediately. Every existing quotation is
untouched, and existing projects stay on the version they were created with. A fresh
Draft is automatically seeded from the version you just released, ready for the next
round of changes.

### Viewing a past price list

Go to **Published versions**. Every version ever published is listed, each showing its
item count, how many projects use it, and when it was published. Click **View prices**
on any of them to open a searchable, paged, read-only list of exactly what that version
contains — useful when a client asks why an old quotation shows a different rate than
today's.

### Reverting to a previous version

Also on **Published versions**: click **Make this live again** on any version that
isn't currently live. You'll be shown exactly what happens — that version becomes live
straight away, the currently-live one is archived, new quotations from that point use it,
and every existing quotation keeps whatever it already had. Your Draft is untouched by
this action either way.

### Adding a product to one specific old quotation

Open the quotation. If it isn't already on the newest price list, you'll see an
**"Add a newer product"** button next to its price-list tag (or, if products have
already been added, a button showing the count). Click it, enter the item code from the
*current* price list, optionally note why, and add it. It becomes available on that
quotation only, priced from whichever price list was live at that moment — that price is
then fixed for as long as the exception exists, even if the product's price changes
again later (remove and re-add it to pick up a newer price). Trying to add the same code
to the same quotation twice is blocked with a clear "already added" message, not silently
ignored. Removing it again (also admin-only) takes it back off the quotation's available
catalog — but it's not erased from history: the removal is recorded in the audit trail
like every other pricing action, and if that product was already added to a line item on
the quotation, that saved line keeps the price it was given, untouched.

### Sheet wiring and item codes

The **Sheet wiring** tab lists the 7 connected tabs (and the disabled legacy one) with
their item-code prefix and layout, purely for reference — you won't normally need to
touch this. Below it, an **item codes** panel shows how many rows in the sheet already
have a code and how many don't, and a **Generate codes** button to assign codes to any
row that's missing one. If duplicate or malformed codes are detected, that button is
disabled until they're fixed in the Sheet, because a duplicate code would make it
impossible to tell two different products apart when comparing price lists.

### Audit log

The **Audit log** tab is a running record of every sync, publish, revert, and
per-quotation product addition — who did it and when.

---

## Every situation you'll run into

**We changed 30–40 items in the Sheet. Is that automatically a new price list?**

No. Those edits sit in the Sheet until someone syncs, and then sit in the Draft until
someone publishes.

**Someone then changes one more item. Is that another price list?**

No. That item joins the same Draft. Whether one item changed or two thousand, the next
Publish produces exactly one new price list.

**We raise prices 20% now and another 20% in six months.**

Two publishes, so two price lists — correctly. Quotations sent in between keep the
prices they were quoted at either way.

**Only the plywood tab changed. Do we have to sync everything?**

No. Tick just that tab when syncing. Tabs left unticked aren't read at all, and their
prices in the Draft don't move.

**We changed two tabs but only synced one so far. Can we still publish?**

Yes, but think about what that actually publishes: the unsynced tab's *old* prices would
go into the new version, because the Draft only reflects what's been synced into it. The
unsynced changes in the Sheet aren't lost — they're just not live yet. If you want
everything live together, sync both tabs first.

**Someone else already synced before I looked.**

The Draft preview shows exactly which tabs were pulled in, by whom, and when — and the
publish confirmation repeats it. If a tab was synced by someone else and you haven't
reviewed it, either sync it again yourself or read the preview carefully before
publishing.

**Two people sync or publish at the exact same moment.**

Nothing corrupts a version — you can never end up with a version that's half old prices
and half new. If a sync happens to overlap with someone else publishing at that exact
instant, the sync is deliberately abandoned rather than risk writing into the wrong
place, and you'll be told to simply run that sync again.

**A price move in the preview looks suspiciously large.**

Anything moving 25% or more is flagged with a small warning icon. It's a prompt to
double-check that row in the Sheet, not a block — genuine large moves (a new product
line, a supplier change) can still be published as-is.

**We published something wrong.**

Go to **Published versions** and click **Make this live again** on the correct previous
version. It goes live immediately for new quotations. Quotations already sent were never
at risk either way — reverting only changes what *new* quotations use going forward.

**Can we fix one price inside the price list that's already live?**

Yes — fix it in the Sheet, sync, review the Draft, and click **Update live price list**.
The correction applies to the live list itself, so everyone quoting from it gets the right
rate from that moment. Nothing already saved on a quotation moves: those lines keep the
price they were quoted at.

**Can we fix a price inside an archived version?**

No, deliberately. An archived list is the historical record of what the quotations pinned
to it were priced from, so changing it would make those quotations unexplainable. Correct
the live list instead, or release a new version.

**We added one new product. Do existing projects have to wait for a new version?**

No. Sync it, review it, and click **Update live price list**. Every project on that price
list can add the product straight away. This is the normal way to add a product.

**A client on a quotation from an older, archived price list wants a product we
introduced recently.**

Open that quotation and use **Add a newer product**, entering the item code from the
current price list. It becomes available on that quotation only, priced from whichever
price list is live at the moment you add it — a price that then stays fixed on that
quotation. Every other price on that quotation is untouched, and no other quotation —
even one on the exact same old price list — is affected. Trying to add the same product
a second time is blocked with an "already added" message.

**We want to see exactly what an old price list contained.**

Open **Published versions → View prices** on that version. It's searchable and
read-only, so you can answer a client's question about a quotation from months ago
without guessing.

**We're not sure which Google Sheet or tab we're looking at.**

There is only one live sheet: "Quote Gen - Blueprint | Final." Only the 7 `DeX - ...`
tabs are the catalog. If a spreadsheet's browser tab title includes "— BACKUP," it's a
frozen historical copy, not the live one — close it. See
[Which sheet, which tabs](#which-sheet-which-tabs) for the full list.

**How does the system know two rows across different price lists are "the same
product"?**

By its item code (e.g. `XPR-0042`), assigned once and never reused — even after that
product is later removed from the Sheet. That's how the price-move preview, the version
viewer, and per-quotation product additions all correctly compare "this product, then vs.
now," and it's part of why tabs should be edited in place rather than deleted and
recreated.

**A product has both "wet" and "dry" room-type versions in the Sheet — do they price
separately?**

Yes. They share the same item code (since they come from the same sheet row) but are
tracked and priced independently, so editing that sheet row updates both together, and
the Draft preview may show it as two separate lines if only one variant's price actually
changed.

---

## What is recorded

Every sync, live-list update, release, revert, and per-quotation product addition is
logged with who did it and when, visible on the **Audit log** tab of the Pricing Versions
page. Updates and releases are recorded as different actions, with their change counts, so
the history explains why a price list's contents changed on a given date.

---

## Things the system will refuse to do

These are safety rails, not faults — each has a straightforward next step:

- **Releasing or updating from an empty Draft.** Sync the Sheet first.
- **Releasing or updating when nothing changed.** Both buttons are simply disabled —
  there's nothing to review.
- **Releasing or updating from a Draft that has less than half the items of the live
  list.** That almost always means a sync failed part-way. Re-sync and check the preview.
- **Changing prices inside an archived version.** Update the live list or release a new
  one instead; see "Can we fix a price inside an archived version?" above.
- **Syncing when nothing could be read from the Sheet at all.** The sync is aborted and
  nothing is changed — check the connection and try again.
- **Generating item codes while duplicate or malformed codes exist.** Fix them by hand
  in the Sheet first, since a duplicate code makes it impossible to reliably compare
  that product across price lists.
- **Adding a per-quotation product using a code that doesn't exist in the current price
  list.** Double-check the code against **Published versions → View prices** on the live
  version.
