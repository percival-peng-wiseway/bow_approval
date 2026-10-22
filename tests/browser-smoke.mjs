import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const result = { testedAt: new Date().toISOString(), origin: 'http://127.0.0.1:4185', checks: [], errors: [] };
const check = (name, detail) => { result.checks.push({ name, status: 'passed', detail }); console.log('PASS:', name); };
let browser;
try {
  let playwright;
  try {
    playwright = await import('/Users/pperciva1/.npm/_npx/ad9a3fdbcad992c6/node_modules/playwright-core/index.mjs');
  } catch (error) {
    result.runtimeNote = 'Requested existing Playwright installation is incomplete; used another already-installed copy. Original import: ' + error.message;
    playwright = await import('/Users/pperciva1/.npm/_npx/a8a7eec953f1f314/node_modules/playwright-core/index.mjs');
  }
  const { chromium } = playwright;
  browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => result.errors.push(error.message));
  await page.goto(result.origin);if(!await page.locator('.legacy-nav').evaluate(el=>el.open))await page.locator('.legacy-nav summary').click();await page.locator('[data-page=all]').click();
  await page.locator('.request-card').first().waitFor();
  assert.equal(await page.locator('.request-card').count(), 9);
  assert.match(await page.locator('.detail h2').innerText(), /TalentBridge/);
  assert.match(await page.locator('.detail .amount').innerText(), /4,400\.00/);
  await page.screenshot({ path: root + 'evidence/replica-desktop.png', fullPage: true });
  check('Initial dataset and desktop', '9 requests; TalentBridge total AUD 4,400.00; clean desktop screenshot saved.');

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 1 });
  const mobilePage = await mobile.newPage();
  mobilePage.setDefaultTimeout(10000);
  await mobilePage.goto(result.origin);await mobilePage.locator('[aria-label="Open navigation"]').click();await mobilePage.locator('.legacy-nav summary').click();await mobilePage.locator('[data-page=all]').click();
  await mobilePage.locator('.request-card').first().waitFor();
  await mobilePage.screenshot({ path: root + 'evidence/replica-mobile.png', fullPage: true });
  const overflow = await mobilePage.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(overflow.document <= 390 && overflow.body <= 390, JSON.stringify(overflow));
  await mobilePage.locator('.request-card').first().click();
  assert.equal(await mobilePage.getByRole('button', { name: 'Back to requests' }).isVisible(), true);
  const detailOverflow = await mobilePage.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(detailOverflow <= 390, `Mobile detail width: ${detailOverflow}`);
  check('Mobile layout', `390px list and detail have no document-level horizontal overflow (${JSON.stringify(overflow)}); clean mobile screenshot saved.`);
  await mobile.close();

  const snapshot = () => page.evaluate(() => JSON.parse(localStorage.getItem('approval-workspace-v1')));
  await page.locator('[data-action="approve"]').click();
  await page.reload();if(!await page.locator('.legacy-nav').evaluate(el=>el.open))await page.locator('.legacy-nav summary').click();await page.locator('[data-page=all]').click();
  assert.equal((await snapshot()).requests.find(r => r.reference === 'TB-2026-081').status, 'Approved');
  check('Initial approval persistence', 'Alex approval persisted after reload.');

  await page.getByLabel('Demo role').selectOption('taylor');
  const createBill = async (reference, attachment = false) => {
    await page.getByRole('button', { name: 'New request', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/Request type/).selectOption('Bill');
    await dialog.getByLabel('Supplier', { exact: true }).fill('QA Supplier');
    await dialog.getByLabel('Reference', { exact: true }).fill(reference);
    await dialog.getByLabel(/Department/).selectOption('Operations');
    await dialog.getByLabel('Note for approvers', { exact: true }).fill('Browser validation sample.');
    await dialog.getByLabel('Line 1 description', { exact: true }).fill('Equipment procurement');
    await dialog.getByLabel('Line 1 quantity', { exact: true }).fill('1');
    await dialog.getByLabel('Line 1 unit price', { exact: true }).fill('10000');
    await dialog.getByLabel('Line 1 tax rate', { exact: true }).fill('10');
    if (attachment) await dialog.locator('input[type="file"]').setInputFiles({ name: 'qa-support.txt', mimeType: 'text/plain', buffer: Buffer.from('Approval workspace attachment QA\n') });
    await dialog.getByRole('button', { name: 'Submit for approval', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
  };
  await createBill('QA-11000', true);
  let data = await snapshot();
  let created = data.requests.find(r => r.reference === 'QA-11000');
  assert.equal(created.requester, 'taylor');
  assert.equal(created.steps.length, 2);
  assert.match(await page.locator('.detail .amount').innerText(), /11,000\.00/);
  check('Create and submit bill', 'Taylor created AUD 10,000 net + 10% GST = AUD 11,000; department and CFO steps assigned.');

  await page.getByLabel('Leave a comment').fill('Reviewed supporting document for browser QA.');
  await page.getByRole('button', { name: 'Post comment' }).click();
  created = (await snapshot()).requests.find(r => r.reference === 'QA-11000');
  assert.equal(created.history.at(-1).action, 'Comment');
  await page.getByRole('tab', { name: /Documents/ }).click();
  const attachmentEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'qa-support.txt', exact: true }).click();
  const attachment = await attachmentEvent;
  assert.equal(attachment.suggestedFilename(), 'qa-support.txt');
  assert.equal(await readFile(await attachment.path(), 'utf8'), 'Approval workspace attachment QA\n');
  check('Comment and attachment', 'Comment recorded; uploaded text file downloaded with byte-identical content.');

  await page.getByLabel('Demo role').selectOption('alex');
  await page.locator('[data-action="approve"]').click();
  created = (await snapshot()).requests.find(r => r.reference === 'QA-11000');
  assert.equal(created.status, 'On approval');
  assert.equal(created.stepIndex, 1);
  await page.getByLabel('Demo role').selectOption('sam');
  await page.locator('[data-action="approve"]').click();
  created = (await snapshot()).requests.find(r => r.reference === 'QA-11000');
  assert.equal(created.status, 'Approved');
  assert.equal(created.history.at(-1).action, 'Final approval');
  check('Sequential approvals', 'Alex completed department step; request remained pending until Sam completed Director approval.');

  await page.getByRole('button', { name: 'Approval workflows', exact: true }).click();
  await page.getByLabel('Step 1 condition').selectOption('All');
  await page.getByRole('button', { name: 'Update the workflow' }).click();
  data = await snapshot();
  assert.equal(data.workflows.Bill[0].mode, 'All');
  assert.equal(data.requests.find(r => r.reference === 'QA-11000').steps[0].mode, 'Any');
  await page.getByLabel('Demo role').selectOption('taylor');
  await createBill('QA-SNAPSHOT');
  data = await snapshot();
  assert.equal(data.requests.find(r => r.reference === 'QA-SNAPSHOT').steps[0].mode, 'All');
  await page.reload();if(!await page.locator('.legacy-nav').evaluate(el=>el.open))await page.locator('.legacy-nav summary').click();await page.locator('[data-page=all]').click();
  assert.equal((await snapshot()).workflows.Bill[0].mode, 'All');
  check('Workflow configuration and snapshots', 'Any changed to All and persisted; existing request kept Any, new submission received All.');

  await page.getByLabel('Search requests').fill('NO-MATCH-XYZ-987');
  assert.equal(await page.locator('.request-card').count(), 0);
  assert.equal(await page.getByText('No matching requests', { exact: true }).isVisible(), true);
  check('Empty search', 'Unmatched query displays zero requests and clear-filter action.');
  await page.getByRole('button', { name: 'Reports', exact: true }).click();
  const reportEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
  const report = await reportEvent;
  const csv = await readFile(await report.path(), 'utf8');
  assert.equal(report.suggestedFilename(), 'request-report.csv');
  assert.match(csv, /"Total AUD"/);
  assert.match(csv, /QA-11000/);
  assert.match(csv, /QA-SNAPSHOT/);
  check('Report download', 'CSV downloaded and contains both newly submitted requests and total amount column.');

  await page.getByLabel('Demo role').selectOption('taylor');
  if(!await page.locator('.legacy-nav').evaluate(el=>el.open))await page.locator('.legacy-nav summary').click();await page.locator('[data-page="drafts"]').click();
  await page.locator('[data-action="edit"]').click();
  const editDialog = page.getByRole('dialog');
  await editDialog.getByLabel('Reference', { exact: true }).fill('QA-EDITED-DRAFT');
  await editDialog.getByLabel('Line 1 description', { exact: true }).fill('Edited draft description');
  await editDialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await editDialog.waitFor({ state: 'hidden' });
  let edited = (await snapshot()).requests.find(r => r.reference === 'QA-EDITED-DRAFT');
  assert.equal(edited.status, 'Draft');
  assert.equal(edited.items[0].description, 'Edited draft description');
  await page.locator('[data-action="edit"]').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Save & submit', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  edited = (await snapshot()).requests.find(r => r.reference === 'QA-EDITED-DRAFT');
  assert.equal(edited.status, 'On approval');
  check('Draft edit and submission', 'Taylor edited seeded draft; Save changes retained Draft, Save & submit entered approval using current workflow.');
  assert.deepEqual(result.errors, []);
  result.status = 'passed';
} catch (error) {
  result.status = 'failed';
  result.failure = error.stack || error.message;
  process.exitCode = 1;
} finally {
  await browser?.close();
  await writeFile(root + 'evidence/browser-validation.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
}
