import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from '/Users/pperciva1/.npm/_npx/a8a7eec953f1f314/node_modules/playwright-core/index.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const report={testedAt:new Date().toISOString(),checks:[],errors:[]};
const pass=name=>{report.checks.push({name,status:'passed'});console.log('PASS:',name);};
let browser;
try{
 browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto('http://127.0.0.1:4185');await page.locator('.legacy-nav summary').click();await page.locator('[data-page=all]').click();
 for(const [status,count] of [['Rejected',1],['Draft',1],['Approved',2],['On approval',5],['All',9]]){await page.getByLabel('Filter by status').selectOption(status);assert.equal(await page.locator('.request-card').count(),count);}
 await page.getByLabel('Sort requests').selectOption('amount');assert.match(await page.locator('.request-card').first().innerText(),/Dell Australia/);
 await page.getByLabel('Sort requests').selectOption('supplier');assert.match(await page.locator('.request-card').first().innerText(),/Amazon Web Services/);
 await page.getByLabel('Sort requests').selectOption('recent');await page.locator('.request-card').first().click();
 pass('Every status is accessible; amount and supplier sorting work');
 await page.locator('.request-card').first().focus();await page.keyboard.press('ArrowDown');assert.match(await page.locator('.detail h2').innerText(),/Metro/);await page.keyboard.press('ArrowUp');assert.match(await page.locator('.detail h2').innerText(),/TalentBridge/);
 await page.keyboard.press('/');assert.equal(await page.getByLabel('Search requests').evaluate(el=>el===document.activeElement),true);await page.getByLabel('Search requests').fill('Officeworks');assert.equal(await page.locator('.request-card').count(),1);await page.getByLabel('Search requests').fill('');await page.locator('.request-card').first().click();
 pass('Keyboard moves between requests and focuses search');
 await page.getByLabel('Leave a comment').fill('Keep this draft while reviewing');await page.getByRole('tab',{name:/Activity/}).click();await page.getByRole('tab',{name:/Activity/}).press('ArrowRight');assert.equal(await page.getByRole('tab',{name:/Documents/}).getAttribute('aria-selected'),'true');assert.equal(await page.getByLabel('Leave a comment').inputValue(),'Keep this draft while reviewing');await page.getByRole('tab',{name:'Overview',exact:true}).click();
 const before=await page.locator('[data-action=approve]').boundingBox();await page.locator('.content').evaluate(el=>el.scrollTop=el.scrollHeight);const after=await page.locator('[data-action=approve]').boundingBox();assert.equal(Math.round(before.y),Math.round(after.y));assert.ok(await page.getByLabel('Leave a comment').isVisible());
 pass('Tabs support keyboard use; comment drafts survive; approval and comment controls stay fixed');
 await page.getByRole('button',{name:'View invoice',exact:true}).click();await page.locator('.document-preview').waitFor();assert.match(await page.locator('.sample-invoice').innerText(),/SAMPLE DOCUMENT/);assert.equal(await page.locator('.list-panel').isVisible(),false);await page.screenshot({path:root+'evidence/ui-redesign/side-by-side-sample.png'});await page.getByRole('button',{name:'Close preview',exact:true}).click();assert.equal(await page.locator('.list-panel').isVisible(),true);
 pass('Sample attachments clearly labeled; opening and closing side-by-side preserves request');
 await page.getByLabel('Demo role').selectOption('taylor');await page.getByRole('button',{name:'New request',exact:true}).click();
 const dialog=page.getByRole('dialog');await dialog.getByLabel('Supplier',{exact:true}).fill('Harbour Office Pty Ltd');await dialog.getByLabel('Reference',{exact:true}).fill('UI-PREVIEW-001');await dialog.getByLabel('Line 1 description',{exact:true}).fill('Office supplies');await dialog.getByLabel('Line 1 unit price',{exact:true}).fill('1200');await dialog.locator('#file-input').setInputFiles(root+'tests/fixtures/invoice-text.pdf');
 const footer=await dialog.locator('footer').boundingBox();await dialog.locator('.modal-body').evaluate(el=>el.scrollTop=el.scrollHeight);assert.equal(Math.round(footer.y),Math.round((await dialog.locator('footer').boundingBox()).y));await page.locator('#save-draft').click();await dialog.waitFor({state:'hidden'});
 await page.getByRole('button',{name:'View invoice',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.document-pages img')?.naturalWidth>0);assert.match(await page.locator('.document-preview').innerText(),/Original document/);assert.match(await page.locator('.detail h2').innerText(),/Harbour/);await page.screenshot({path:root+'evidence/ui-redesign/side-by-side-pdf.png'});
 pass('Uploaded PDF renders actual pages alongside editable request; dialog footer remains reachable');
 // Document preview returns only pages; it does not change invoice fields.
 const source=await fs.readFile(root+'tests/fixtures/invoice-text.pdf');
 const previewResult=await page.evaluate(async data=>{const r=await fetch('/api/invoice/preview',{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'ApprovalWorkspace'},body:JSON.stringify({name:'preview.pdf',data})});const result=await r.json();return {status:r.status,pages:result.previews?.length,hasFields:'fields' in result};},source.toString('base64'));
 assert.deepEqual(previewResult,{status:200,pages:1,hasFields:false});
 pass('Preview endpoint only returns rendered pages without modifying or parsing form fields');
 await page.getByRole('button',{name:'Close preview',exact:true}).click();await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'Back to requests'}).click();await page.getByRole('button',{name:'Open navigation',exact:true}).click();assert.equal(await page.locator('.nav-open .nav[data-page=bills] span').isVisible(),true);await page.getByRole('button',{name:'Bills',exact:true}).click();assert.equal(await page.locator('.nav-open').count(),0);await page.locator('.request-card').first().click();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=390));await page.waitForFunction(()=>!document.querySelector('#toast').classList.contains('show'));await page.screenshot({path:root+'evidence/ui-redesign/mobile-detail.png'});
 await page.getByRole('button',{name:'View invoice',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.document-pages img')?.naturalWidth>0);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=390));await page.getByRole('button',{name:'Close preview',exact:true}).click();
 pass('Mobile navigation expands into labeled menu; detail and PDF view fit 390px');
 await page.getByRole('button',{name:'New request',exact:true}).click();const mobileFooter=await page.getByRole('dialog').locator('footer').boundingBox();assert.ok(mobileFooter.y+mobileFooter.height<=844);await page.screenshot({path:root+'evidence/ui-redesign/mobile-form.png'});await page.getByRole('button',{name:'Close dialog'}).click();
 pass('Mobile form actions remain within viewport');
 for(const width of [768,1024,1280,1920]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Overflow at ${width}`);}
 assert.deepEqual(report.errors,[]);pass('Tablet and desktop widths fit; zero browser exceptions');report.status='passed';
}catch(e){report.status='failed';report.failure=e.stack;process.exitCode=1;}
finally{await browser?.close();await fs.writeFile(root+'evidence/ui-redesign/validation.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
