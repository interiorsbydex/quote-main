---
name: Never promise a capability you have not verified in the shipped code
description: Why pre-build design documents drift from what was actually built, and the check to run before telling a user a feature exists.
---

A design document written before the build describes intent. Once the build is done it is
routinely treated as documentation of the result — by the user, by the next agent, and by
the author. It is not. Features get dropped mid-build for good reasons and the document is
never amended, so it keeps advertising buttons that do not exist.

**The rule:** before telling a user (or writing into a help guide) that a capability
exists, grep for the thing that would make it real — the route, the handler, the button —
not the paragraph that describes it. If the only evidence is the design document, the
feature does not exist.

**Why:** a help guide that names a button which does not exist destroys the user's trust
in every other instruction in the guide, and they discover it at the exact moment they
urgently need the feature. This is a routine failure, not a rare one: the more carefully a
capability is specified up front, the more confidently everyone later assumes it shipped.

**How to apply:** when asked "how does X work?" about your own past work, answer from the
code, not from the plan. When a promised-but-missing feature turns up, decide explicitly
whether to build it or to retract it — and if the missing feature would violate a
guarantee the system now makes, retract it permanently and say so, rather than leaving it
as a vague future intention.
