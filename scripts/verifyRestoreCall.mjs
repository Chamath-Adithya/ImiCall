import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const base=process.env.IMICALL_TEST_URL||'http://localhost:8080';
const dir=path.resolve(process.env.IMICALL_ARTIFACTS||'work/restore-check');await fs.mkdir(dir,{recursive:true});
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']});
const click=async(p,t)=>{await p.waitForFunction(t=>Array.from(document.querySelectorAll('button')).some(e=>e.textContent.trim()===t),{},t);await p.evaluate(t=>Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()===t).click(),t);};
const password='restore-call-test-password';
try {
 const contexts=await Promise.all([b.createBrowserContext(),b.createBrowserContext()]);const pages=[];
 for(const c of contexts){await c.overridePermissions(base,['microphone']);const p=await c.newPage();await p.setViewport({width:1200,height:900});await p.evaluateOnNewDocument(()=>localStorage.setItem('imicall_transport','direct'));await p.goto(base);await p.waitForSelector('.contact-select');pages.push(p);}
 const [a,z]=pages;const original=await a.evaluate(()=>JSON.parse(localStorage.getItem('imicall_saved_lines_list_v2'))[0]);
 const cdp=await a.createCDPSession();await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:dir,browserContextId:contexts[0].id});
 await a.click('[aria-label="Data and backup"]');await a.waitForSelector('[aria-label="Backup password"]');await a.type('[aria-label="Backup password"]',password);await a.type('[aria-label="Confirm backup password"]',password);await click(a,'Export connections');const file=path.join(dir,'imicall-connections.imicall');
 for(let n=0;n<50;n++){try{await fs.access(file);break;}catch{await new Promise(r=>setTimeout(r,100));}}
 await a.click('[aria-label="Close settings"]');
 const restore=async p=>{await p.click('[aria-label="Data and backup"]');await click(p,'Restore backup');await p.waitForSelector('input[type="file"]');await(await p.$('input[type="file"]')).uploadFile(file);await p.type('[aria-label="Backup password"]',password);await click(p,'Review backup');await p.waitForSelector('.backup-preview');await click(p,'Merge connections');await p.click('[aria-label="Close settings"]');await p.waitForFunction(id=>JSON.parse(localStorage.getItem('imicall_saved_lines_list_v2')).some(l=>l.id===id),{},original.id);await p.evaluate(id=>{const lines=JSON.parse(localStorage.getItem('imicall_saved_lines_list_v2'));const index=lines.findIndex(l=>l.id===id);document.querySelectorAll('.contact-select')[index].click();},original.id);};
 await restore(z);
 const remove=async p=>{p.once('dialog',d=>d.accept());await click(p,'Remove');await p.waitForFunction(id=>!JSON.parse(localStorage.getItem('imicall_saved_lines_list_v2')).some(l=>l.id===id),{},original.id);};
 await remove(a);assert.ok(await z.evaluate(id=>JSON.parse(localStorage.getItem('imicall_saved_lines_list_v2')).some(l=>l.id===id),original.id),'Deleting one copy must not erase the other browser');
 await remove(z);await restore(a);await restore(z);
 for(const p of pages)assert.equal(await p.evaluate(id=>JSON.parse(localStorage.getItem('imicall_saved_lines_list_v2')).find(l=>l.id===id).passcode,original.id),original.passcode);
 await a.waitForFunction(()=>document.body.innerText.includes('Available now'));await a.click('.main-call');await click(z,'Answer');await Promise.all(pages.map(p=>p.waitForFunction(()=>document.body.innerText.includes('Call Active'),{timeout:20000})));await a.click('[title="End Call"]');
 console.log('Export → restore in second browser → delete both local copies → restore both → connected call passed. Original invitation secret preserved; one-sided removal did not erase the peer.');
}finally{await b.close();}
