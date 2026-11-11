# Production release — 11 November 2026

## Released scope

The user authorized deploying the latest `prod` application, configuring the Wiseway subdomain, and reusing the existing OpenAI credential in the production Worker. Email configuration remains deferred.

- Application baseline: `5f72d75f80b8944d4c2faee7dad387f4b0ce733e` plus the production domain and OCR container-name configuration in this release.
- Public URL: `https://bowoa.wiseway.ai` (replaces the initially configured `oa.wiseway.ai` at the user's request).
- Worker: `bow-approval`; deployed version `2d9fed02-8a82-488f-adde-7e25c348ea99`.
- Pages gateway: `bow-oa`, production branch `prod`, deployment `92db490f.bow-oa.pages.dev`; binding `BOW` targets `bow-approval`.
- D1: `bow-approval-prod`; private R2: `bow-approval-prod-files`; existing resources retained.
- `PUBLIC_APP_URL`: `https://bowoa.wiseway.ai` in root and explicit production configuration.
- Production secrets: `OPENAI_API_KEY` and `ABN_LOOKUP_GUID`, installed without committing their values. Contract AI is enabled with `gpt-6-luna`.
- Dedicated `admin` account provisioned using its existing salted hash. First sign-in requires a password change. No password or hash is recorded in this document.

## Recovery and data preservation

Preflight found the original production Worker absent (Cloudflare API 10007 and workers.dev HTTP 404). Its D1 database and R2 bucket were present. The Worker was recreated from the reviewed release while retaining the original database and file storage.

Private, ignored backups were created before and after release under `backups/prod-20261111-before-release` and `backups/prod-20261111-after-release`. An isolated SQLite restore was verified at `restores/prod-20261111-verification`, with restored sessions cleared and mail disabled. Never commit these directories.

Before/after comparison preserved both entities, the workspace metadata, all three approval events, the committed file record, all three workspace commits, all seven original account password hashes/salts, and the committed attachment checksum. Four additive migrations are applied. The dedicated administrator and AI configuration were added without replacing existing accounts or business records.

The old OCR container was still linked to a Durable Object namespace from the absent Worker. Production now uses `bow-approval-ocr-prod-v2` with the recreated Worker's namespace. The old orphaned OCR application was left untouched; any later cleanup must target that exact unused resource after confirming dependencies.

Wrangler unexpectedly created an unused Worker named `bow-oa` during Pages project creation. It was deleted after the user's explicit approval. The separate Pages project with the same name, production Worker, D1 and R2 remain intact.

An unrelated uncommitted QA-only change in `cloud/worker.mjs` was preserved in the local checkout and excluded from the final production artifact. The final release was built from an isolated archive of the committed baseline with only the reviewed release configuration and gateway additions.

## Validation

- 171 automated tests passed before the hostname change. All four updated gateway tests also passed, including the old-host redirect without forwarding mutations.
- Build and release checks passed; four migrations and the static-asset allowlist verified.
- Production Worker and gateway health, HTML and JavaScript responded successfully. Account-settings JavaScript matched the built release bytes.
- Unauthenticated workspace/file requests returned 401; a foreign-Origin mutation returned 403.
- Administrator sign-in returned the expected Admin identity and mandatory password-change flag. Secure, HttpOnly session cookies were verified and test sessions explicitly revoked.
- Cloudflare reports the final custom domain and its HTTPS certificate active. The browser displays the Staff version and Customer version login page at `https://bowoa.wiseway.ai`. Health, release asset bytes, admin login/logout, Secure/HttpOnly cookies, required password change, unauthenticated 401 responses and foreign-Origin 403 were verified again on this final hostname.

No production approvals, payments, customer invitations or real customer documents were created for testing. No real production AI or OCR call was made during this release; configuration is verified, while prior synthetic QA runtime evidence is recorded in `QA_RELEASE_2026-11-09.md`.

## Remaining setup

Resend invitations and email notifications remain unconfigured at the user's request. Complete the administrator's first-login password change in the browser. Other accounts retain their existing credentials and the application's password-change requirements.

Route 53 remains authoritative. The BOW subdomain CNAME records point to `bow-oa.pages.dev` with TTL 300; E3 resources, Wiseway root records and mail records were not changed. The superseded `oa.wiseway.ai` record and Pages domain remain as a GET/HEAD redirect to `bowoa.wiseway.ai`; mutations to the old host receive 410. For an application rollback, use a verified Worker version and compatible bindings; do not restore D1 or replace attachments as part of a code-only rollback.
