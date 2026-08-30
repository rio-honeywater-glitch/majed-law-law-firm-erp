---
name: Ephemeral production filesystem
description: Files written to local disk (e.g. generated PDFs in public/uploads/) do not survive republishing; DB rows referencing them go stale.
---

Every republish/deploy starts from a fresh filesystem image. Anything the app wrote to local disk at runtime (generated PDFs, uploads) is gone, while DB columns pointing at those files persist — causing "file not found" failures in production only.

**Why:** Hit this when contract sending failed in production with 400 "ملف العقد غير موجود" right after a republish: `contracts.pdf_url` pointed at wiped files.

**How to apply:** For any runtime-generated file referenced from the DB, either store it in Object Storage or make routes self-healing (detect missing file → regenerate on the fly → update the DB reference). If generation deletes stale files first, serialize per-entity generation (in-process lock) to avoid concurrent requests invalidating each other's paths.
