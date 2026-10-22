# Cloudflare deployment

## Architecture

The Worker serves static assets, login, the approval API, and authenticated file downloads. Approval rules are shared with the local Node.js server. D1 stores salted scrypt account hashes, hashed session tokens, project/request records, approval events, and revision commits. Writes use a single guarded D1 batch: concurrent edits cannot silently overwrite an accepted approval.

Attachments are stored in private R2 buckets. D1 contains metadata and file IDs, not base64 file bodies. `/api/files/:id` requires an active session. This remains a shared organization workspace: signed-in members can read its requests and committed attachments; role and workflow rules govern changes. R2 public access must remain disabled.

The `InvoiceOCR` Durable Object manages a separate Cloudflare Container running PDF text extraction, PDFium, and Tesseract. It has no internet access, processes one file at a time, deletes temporary files, and sleeps after two idle minutes. Both environments cap OCR at one basic instance. Cold starts can delay the first scan. Manual entry remains available if OCR is unavailable. Scans accept PDF, PNG, JPEG and WebP up to 2 MB; document groups have a 3 MB limit. Review extracted values before submitting.

## Environments

| Environment | Worker | D1 database | Private R2 bucket |
| --- | --- | --- | --- |
| QA | bow-approval-qa | bow-approval-qa | bow-approval-qa-files |
| Production | bow-approval | bow-approval-prod | bow-approval-prod-files |

`wrangler.jsonc` contains resource bindings, not credentials. Root configuration is production for compatibility with the existing `npx wrangler deploy` command. Use explicit environment scripts for normal releases. Cloudflare Containers requires a paid Workers account and Docker during deployment; storage and compute are billed by Cloudflare.

## Cloudflare Git build settings

| Setting | QA | Production |
| --- | --- | --- |
| Branch | QA | prod |
| Root directory | / | / |
| Build command | npm run build | npm run build |
| Deploy command | npm run deploy:qa | npm run deploy:prod |

Each Worker needs its own Git build trigger. Disable automatic non-production branch deployments into the production Worker. Linking a branch alone does not initialize accounts. The deploy scripts apply idempotent D1 migrations before uploading the Worker and OCR image. The Wrangler build hook also prepares static assets when deploying directly.

## First setup or another Cloudflare account

1. Run `npm ci` and `npx wrangler login`; start Docker.
2. Create separate D1 databases and R2 buckets, then replace the account ID, database IDs, and resource names in `wrangler.jsonc` for that account. Keep the root and explicit prod configuration in sync.
3. Apply migrations and provision accounts privately:

```sh
npx wrangler d1 migrations apply DB --env QA --remote
node scripts/seed-cloud-accounts.mjs QA --remote
npx wrangler d1 migrations apply DB --env prod --remote
node scripts/seed-cloud-accounts.mjs prod --remote
```

The seed command reads the existing `.local/accounts.json` (or `APP_DATA_DIR`) and sends only the salted hashes to D1. It does not print credentials, commit them, or overwrite existing accounts. Its temporary SQL file is private and removed after the command. Initialize local accounts with the README instructions if needed. Never add account files or passwords to Git or build variables.

4. Validate QA, then deploy production:

```sh
npm run deploy:qa
npm run deploy:prod
```

Existing account passwords remain valid. Subsequent deployments do not reseed accounts. Cloud sessions survive deployments and expire after 12 hours; logout immediately removes the session. An hourly scheduled handler removes expired sessions/rate counters and abandoned uploads older than 24 hours.

## Data migration

Cloud environments start empty. The account seeding command migrates accounts only, not requests or attachments. To migrate existing data, export a workspace backup from the original local application, then run the private import helper:

```sh
node scripts/import-cloud-workspace.mjs https://YOUR-WORKER.workers.dev /private/path/workspace-backup.json
```

The script prompts for the Admin name and password. Import is restricted to Admin and an empty destination. It preserves request IDs and history and converts inline attachments into private R2 objects. It never overwrites an existing cloud workspace. Large imports (over 12 MB, 80 new attachments, or 900 transaction statements) must be split through a separately planned migration. A cloud JSON export contains attachment references; it is not a complete R2 backup. Keep original local backups until migration has been verified.

## Local cloud verification

```sh
npx wrangler d1 migrations apply DB --env QA --local
node scripts/seed-cloud-accounts.mjs QA --local --test
npm run dev:cloud -- --port 4186
```

In another terminal:

```sh
npm test
CLOUD_TEST_URL=http://localhost:4186 node tests/auth-browser.mjs
npm run test:cloud
```

The test seed uses synthetic credentials and is refused for remote D1. For live QA tests, supply `CLOUD_TEST_URL` and `CLOUD_TEST_PASSWORD` privately. Never run these mutation tests against production. The API suite checks environment first and tests optimistic concurrency, private R2 downloads, authorization, logout revocation, and actual OCR on synthetic PDFs and an image. The browser suite exercises reimbursement and the service flow through final acceptance and recorded payment.

## Operational boundaries

D1 approval events are application audit records, not an independently immutable ledger. Cloudflare account administrators retain infrastructure access. The app is a single-organization workspace and has no banking, accounting, or email integration. Recorded payments do not transfer money. Data reads currently load the organization's workspace; larger organizations will need pagination and narrower query endpoints.
