---
name: Stale state in dialog-confirm mutations
description: A useMutation's mutationFn that reads a "target" state variable at call time can silently receive the reset (e.g. null) value when the confirming control auto-closes/resets that state around the same tick.
---

React Query's `mutationFn` is invoked from whatever render's closure is current when the
async call actually fires, not necessarily the render where the user clicked. If a
confirm button both (a) triggers the mutation and (b) is wired to something that resets
the "which item is this for" state — e.g. a Radix `AlertDialogAction`, which closes the
dialog on click and commonly drives an `onOpenChange` that clears the target — the two
can race. The mutation can end up running after the target has already been reset to
`null`, producing a confusing runtime-only failure (e.g. "No version selected") that
never reproduces from reading the code alone.

**Why:** Found via end-to-end testing (not visible from a code read) in a "make this
previous version live again" admin action: `mutationFn: () => { if (!target) throw ...;
... }` intermittently threw "No version selected" right after confirming, even though
`target` was clearly set when the button was clicked.

**How to apply:** For any mutation triggered from a dialog/alert confirm button that also
resets a "what is this action targeting" state, don't let `mutationFn` read that state
live. Capture the needed id/value at click time and pass it explicitly: `onClick={() =>
target && mutate(target.id)}` with `mutationFn: (id) => ...`. Never `mutationFn: () => {
if (!target) throw ...; use(target) }`. This class of bug is easy to miss in code review
and cheap to verify with a real click-through test.
