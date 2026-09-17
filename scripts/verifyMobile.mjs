import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const base=process.env.IMICALL_TEST_URL||'http://localhost:8080';
const artifactDir=process.env.IMICALL_ARTIFACTS||path.resolve('work/verification');await fs.mkdir(artifactDir,{recursive:true});
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const clickText=async(p,text)=>p.evaluate(text=>{const e=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===text);if(!e)throw Error('Button missing: '+text);e.click();},text);
try{
 const context=await b.createBrowserContext();await context.overridePermissions(base,['microphone']);const p=await context.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.setViewport({width:390,height:844,isMobile:true,hasTouch:true,deviceScaleFactor:1});await p.goto(base);await p.waitForSelector('.contact-select');
 assert.equal(await p.$eval('.conversation-panel',e=>getComputedStyle(e).display),'none');
 await p.click('.contact-select');assert.equal(await p.$eval('.phonebook-panel',e=>getComputedStyle(e).display),'none');await p.click('.mobile-back');
 console.log('Phone uses a dedicated list/detail navigation flow.');
 for(const [width,height] of [[320,568],[390,844],[768,1024],[820,1180],[1024,768]]){await p.setViewport({width,height});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`overflow ${width}`);}
 await p.setViewport({width:390,height:844});
 const cdp=await p.createCDPSession();await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:artifactDir,browserContextId:context.id});
 await p.click('[aria-label="Data and backup"]');await p.waitForSelector('[aria-label="Backup password"]');await p.type('[aria-label="Backup password"]','test-only-backup-password');await p.type('[aria-label="Confirm backup password"]','test-only-backup-password');await clickText(p,'Export connections');
 const backupFile=path.join(artifactDir,'imicall-connections.imicall');
 for(let n=0;n<40;n++){try{await fs.access(backupFile);break;}catch{await new Promise(r=>setTimeout(r,100));}}
 assert.ok((await fs.readFile(backupFile,'utf8')).includes('imicall-backup'));
 await p.click('[aria-label="Close settings"]');
 await p.evaluate(async()=>{const reg=await navigator.serviceWorker.ready;await new Promise(resolve=>{if(navigator.serviceWorker.controller)resolve();else navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true});});reg.active.postMessage({type:'CACHE_OPTIONAL'});});
 const names=await p.evaluate(()=>performance.getEntriesByType('resource').map(r=>r.name));assert.equal(names.some(s=>s.includes('fonts.googleapis')),false);
 await p.setOfflineMode(true);const started=Date.now();await p.reload({waitUntil:'domcontentloaded'});await p.waitForSelector('.phonebook-panel');console.log(`Cached offline Phone Book visible in ${Date.now()-started} ms.`);assert.ok((await p.evaluate(()=>document.body.innerText)).includes('Offline'));
 await p.setOfflineMode(false);
 await p.click('[aria-label="Data and backup"]');await p.waitForSelector('[aria-label="Backup password"]');
 p.once('dialog',d=>d.accept());await clickText(p,'Clear all ImiCall data');await p.waitForFunction(()=>document.body.innerText.includes('Your Phone Book is empty.'));
 assert.equal(await p.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('imicall_')).length),0);
 assert.equal(await p.evaluate(async()=>(await caches.keys()).filter(k=>k.startsWith('imicall-')).length),0);
 console.log('Clear data removes local connection secrets, presets and offline cache.');
 await clickText(p,'Import a backup');await p.waitForSelector('[aria-label="Backup password"]');await clickText(p,'Restore backup');await p.waitForSelector('[aria-label="Backup password"]');await p.type('[aria-label="Backup password"]','test-only-backup-password');
 const upload=await p.$('input[type="file"]');await upload.uploadFile(backupFile);await clickText(p,'Review backup');await p.waitForSelector('.backup-preview');await clickText(p,'Merge connections');await p.click('[aria-label="Close settings"]');await p.waitForSelector('.contact-select');
 console.log('Password-protected browser export/import round trip passed.');assert.deepEqual(errors,[]);
}finally{await b.close();}
