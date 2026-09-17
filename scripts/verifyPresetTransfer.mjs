import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const base=process.env.IMICALL_TEST_URL||'http://localhost:8080',dir=path.resolve(process.env.IMICALL_ARTIFACTS||'work/preset-check');await fs.mkdir(dir,{recursive:true});
const browser=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});
const click=async(p,t)=>{await p.waitForFunction(t=>Array.from(document.querySelectorAll('button')).some(e=>e.textContent.trim()===t),{},t);await p.evaluate(t=>Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()===t).click(),t);};
try{
 const contexts=await Promise.all([browser.createBrowserContext(),browser.createBrowserContext()]);const pages=[];
 for(const c of contexts){await c.overridePermissions(base,['microphone']);const p=await c.newPage();await p.goto(base);await p.waitForSelector('[aria-label="Data and backup"]');await p.click('[aria-label="Data and backup"]');await click(p,'Voice effects');await p.waitForSelector('.voice-panel');pages.push(p);}
 const[a,b]=pages;const cdp=await a.createCDPSession();await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:dir,browserContextId:contexts[0].id});
 await click(a,'Robot');await click(a,'Save preset');await click(a,'Export preset');const file=path.join(dir,'imicall-voice.json');for(let i=0;i<50;i++){try{await fs.access(file);break;}catch{await new Promise(r=>setTimeout(r,100));}}
 const preset=JSON.parse(await fs.readFile(file,'utf8'));assert.equal(preset.name,'Robot');assert.equal(preset.mix,1);
 await(await b.$('.voice-panel input[type="file"]')).uploadFile(file);await b.waitForSelector('.backup-preview');assert.equal(await b.evaluate(()=>localStorage.getItem('imicall_voice_presets')),null);
 await click(b,'Use in editor');assert.ok(await b.$eval('.voice-panel',e=>e.textContent.includes('Current: Natural')));await click(b,'Save preset');assert.deepEqual(await b.evaluate(()=>JSON.parse(localStorage.getItem('imicall_voice_presets'))[0]),preset);
 await click(b,'Apply effect');await b.waitForFunction(()=>document.querySelector('.voice-panel').textContent.includes('Current: Robot'));
 await b.reload();await b.waitForSelector('[aria-label="Data and backup"]');await b.click('[aria-label="Data and backup"]');await click(b,'Voice effects');await b.waitForFunction(()=>document.querySelector('.voice-panel')?.textContent.includes('Current: Natural'));
 console.log('Preset saved/exported in browser A, previewed/imported/saved in browser B without auto-activation; explicit Apply works and reload restores Natural.');
}finally{await browser.close();}
