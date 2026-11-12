// Optional browser regression: PLAYWRIGHT_MODULE may point to an installed module;
// CHROME_PATH may select Chrome. Real iOS/Android picker UI still needs device QA.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {provisionAccounts} from '../server/auth.mjs';
import {createWorkspaceServer} from '../server.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'bow-mobile-'));
const password='Browser-Original-12!',newPassword='Browser-Changed-34!';let server,browser;
try{
 await provisionAccounts(dir,password);server=await createWorkspaceServer({dataDir:dir});server.listen(0,'127.0.0.1');await once(server,'listening');
 browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const base='http://127.0.0.1:'+server.address().port;
 const login=async(name,pwd)=>{await page.locator('[name=username]').fill(name);await page.locator('[name=password]').fill(pwd);await page.locator('#login-form [type=submit]').click();};
 const fits=async()=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile page must not overflow horizontally');
 await page.goto(base);await fits();await login('Kate',password);await page.locator('[data-action=password]').click();
 await page.locator('[name=currentPassword]').fill(password);await page.locator('[name=newPassword]').fill(newPassword);await page.locator('[name=confirmPassword]').fill(newPassword);await page.locator('#password-form [type=submit]').click();await page.getByRole('dialog').waitFor({state:'hidden'});await fits();
 await page.locator('[data-action=password]').click();await page.locator('#reset-employee').click();await page.locator('[name=accountId]').selectOption('sam');await page.locator('#reset-password-form [type=submit]').click();
 const temporary=await page.getByLabel('Temporary password',{exact:true}).inputValue();assert.ok(temporary.length>=24);await page.getByRole('button',{name:'Close dialog'}).click();
 await page.locator('[data-action=logout]').click();await login('Joe',temporary);await page.getByRole('heading',{name:'Change temporary password'}).waitFor();assert.equal(await page.evaluate(async()=> (await fetch('/api/workspace')).status),403);await fits();
 await page.locator('[name=currentPassword]').fill(temporary);await page.locator('[name=newPassword]').fill(newPassword);await page.locator('[name=confirmPassword]').fill(newPassword);await page.locator('#password-form [type=submit]').click();await page.locator('[data-biz=new]').click();await page.locator('[data-request-category=corporation]').click();
 for(const id of ['business-evidence','business-evidence-photos']){
  const input=page.locator('#'+id);assert.equal(await input.getAttribute('capture'),null);assert.equal(await input.isVisible(),true);
  const chooser=page.waitForEvent('filechooser');await input.tap();await (await chooser).setFiles([]); // cancelled picker must leave form usable
 }
 await page.locator('[name=amount]').fill('45');await page.locator('#business-evidence-photos').setInputFiles('tests/fixtures/invoice-image.png');
 await page.locator('#business-evidence').setInputFiles({name:'receipt.txt',mimeType:'text/plain',buffer:Buffer.from('Receipt')});
 assert.match(await page.locator('.file-selection').innerText(),/receipt.txt/);assert.match(await page.locator('.file-selection').innerText(),/invoice-image.png/);await fits();
 await page.locator('#business-save').click();await page.getByRole('dialog').waitFor({state:'hidden'});
 const workspace=await page.evaluate(async()=> (await (await fetch('/api/workspace')).json()).state);assert.equal(workspace.business.requests[0].attachments.length,2);
 // Simulate OCR error so same-file retry and cancellation need no OCR service.
 let scans=0;await page.route('**/api/invoice/scan',route=>{scans++;return route.fulfill({status:422,contentType:'application/json',body:JSON.stringify({error:'Retry this invoice.'})});});
 await page.locator('[data-action=new]').click();await page.locator('[data-request-category=corporation]').click();await page.locator('#scan-reimbursement').click();
 for(let i=0;i<2;i++){await page.locator('#invoice-upload-photos').setInputFiles('tests/fixtures/invoice-image.png');await page.getByText('Choose the file again to retry.').waitFor();assert.equal(await page.locator('#invoice-upload-photos').isEnabled(),true);}
 assert.equal(scans,2);await page.locator('#invoice-upload').setInputFiles({name:'oversize.pdf',mimeType:'application/pdf',buffer:Buffer.alloc(2*1024*1024+1)});assert.equal(scans,2);await fits();
 await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.locator('#business-form').waitFor();assert.deepEqual(errors,[]);console.log('PASS: mobile password flows, two native pickers, mixed attachments, cancel, size limits and same-file retry');
}finally{await browser?.close();if(server?.listening)await new Promise(resolve=>server.close(resolve));else server?.emit('close');await fs.rm(dir,{recursive:true,force:true});}
