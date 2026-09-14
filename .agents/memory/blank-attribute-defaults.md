---
name: Blank attribute defaults in the catalog
description: Why a blank room type / unit type must be carried through untouched, and what breaks when it is defaulted.
---

A blank room type on a catalog row means "suits any room", and the catalog filter relies
on that: an empty room type matches every room. Defaulting a blank to a real room type
anywhere on the load path silently removes those rows from every other room.

**Why:** whole categories in this catalog carry no room type at all (accessories,
services, lights, handles, stone). Defaulting blanks to one room made all of them vanish
from the other room — over half the catalog — and it presented to the client as "line
items don't appear", not as a data bug.

**How to apply:** when normalising a stored row into what the API serves, pass blanks
through as blanks. If a display default is wanted, apply it in the UI, never on the read
path that the filters run against. The quick regression check is to count what a Wet room
and a Dry room are each offered and compare against the stored blank/wet/dry split.
