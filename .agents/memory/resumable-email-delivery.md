---
name: Resumable email delivery
description: Reliability rule for email operations where provider acceptance and local database finalization can fail independently.
---

# Resumable email delivery

**Rule:** Treat provider acceptance and local business-record finalization as separate durable steps. A retry must reuse the same provider idempotency key and resume finalization without calling the provider after acceptance is recorded.

**Why:** An email provider can accept a message immediately before a transient database failure. Retrying with a new identity can send a duplicate, while coupling both steps hides whether delivery already happened.

**How to apply:** Generate an immutable-payload attempt ID on the client, persist it across reloads under a tenant/user namespace, snapshot the attempt before sending, record the provider message ID and acceptance time, then finalize business records transactionally.