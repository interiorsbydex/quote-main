---
name: Testing authenticated endpoints from scripts
description: The session cookie is Secure, so API test scripts must call the https dev domain, not localhost.
---

# Hit the https dev domain when a test script needs to log in

The session cookie is issued with `Secure` (and `SameSite=None`). Over plain
`http://127.0.0.1:5000` the login endpoint still returns **200 with the user JSON**, but
the browser/fetch layer drops the cookie and no `Set-Cookie` reaches the client. A test
script then fails at the *next* call with a confusing "not authenticated", or — worse —
looks like a login bug when login is actually fine.

**Why:** the app is served to users through an https proxy, so a Secure cookie is correct
in production and only misleads local scripts.

**How to apply:** in any script that authenticates against the running app, build the base
URL from `process.env.REPLIT_DEV_DOMAIN` (`https://${REPLIT_DEV_DOMAIN}`) rather than
localhost. A 200 from `/api/login` is not proof the session was established — check that a
`connect.sid` cookie actually came back before continuing.
