import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
const base=process.env.IMICALL_TEST_URL||'http://localhost:8080';
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const click=async(p,t)=>{await p.waitForFunction(t=>Array.from(document.querySelectorAll('button')).some(e=>e.textContent.trim()===t),{},t);await p.evaluate(t=>Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()===t).click(),t);};
try{
 const ctx=await b.createBrowserContext();await ctx.overridePermissions(base,['microphone']);const p=await ctx.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.evaluateOnNewDocument(()=>{window.__pcs=0;window.__captures=0;const PC=RTCPeerConnection;window.RTCPeerConnection=new Proxy(PC,{construct(t,args){window.__pcs++;return new t(...args);}});const gum=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=(...args)=>{window.__captures++;return gum(...args);};});
 await p.goto(base);await p.waitForSelector('.main-call');await p.waitForFunction(()=>!document.querySelector('.main-call').disabled);await p.click('.main-call');await p.waitForFunction(()=>document.body.innerText.includes('IP protection requires a configured TURN relay'));
 assert.deepEqual(await p.evaluate(()=>[window.__pcs,window.__captures]),[0,0]);console.log('Default IP protection with no TURN stops before microphone capture or peer-connection creation.');
 const saved=await p.evaluate(()=>localStorage.getItem('imicall_saved_lines_list_v2'));
 await p.goto(base+'/?temporary=1');await p.waitForFunction(()=>document.body.innerText.includes('Temporary session'));
 await click(p,'Add contact');await p.waitForSelector('input[placeholder="e.g. Nadeesha, Mom, Office"]');await p.type('input[placeholder="e.g. Nadeesha, Mom, Office"]','Temporary Test Person');await click(p,'Create & Get Connection Link');await p.waitForFunction(()=>document.body.innerText.includes('Temporary Test Person'));
 assert.equal(await p.evaluate(()=>localStorage.getItem('imicall_saved_lines_list_v2')),saved);
 await p.reload();await p.waitForSelector('.phonebook-panel');assert.equal(await p.evaluate(()=>document.body.innerText.includes('Temporary Test Person')),false);assert.equal(await p.evaluate(()=>localStorage.getItem('imicall_saved_lines_list_v2')),saved);
 await click(p,'End & forget session');await p.waitForSelector('.phonebook-panel');assert.equal(await p.evaluate(()=>localStorage.getItem('imicall_saved_lines_list_v2')),saved);assert.deepEqual(errors,[]);
 console.log('Temporary contacts are not persisted, disappear on reload, and leave the regular saved Phone Book untouched.');
}finally{await b.close();}
