import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
const base=process.env.IMICALL_TEST_URL||'http://localhost:8080';
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const click=async(p,t)=>{await p.waitForFunction(t=>Array.from(document.querySelectorAll('button')).some(e=>e.textContent.trim()===t),{},t);await p.evaluate(t=>Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()===t).click(),t);};
try{
 const ca=await b.createBrowserContext(),cb=await b.createBrowserContext();await ca.overridePermissions(base,['microphone']);await cb.overridePermissions(base,['microphone']);const a=await ca.newPage(),z=await cb.newPage();
 await a.evaluateOnNewDocument(()=>localStorage.setItem('imicall_transport','direct'));await a.goto(base);await a.waitForSelector('.contact-select');const line=await a.evaluate(()=>JSON.parse(localStorage.getItem('imicall_saved_lines_list_v2'))[0]);
 await z.goto(base+'/?temporary=1#connect='+line.id+'&pin='+line.passcode+'&from=TemporaryPartner');await click(z,'Connect & Save to Phone Book');await z.waitForSelector('.contact-select');
 await z.click('[title="Line Settings"]');z.once('dialog',d=>d.accept());await z.select('[aria-label="Call privacy"]','direct');await z.evaluate(()=>document.querySelector('.modal-backdrop').click());
 await a.waitForFunction(()=>document.body.innerText.includes('Available now'));await a.click('.main-call');await click(z,'Answer');await z.waitForFunction(()=>document.body.innerText.includes('Call Active'),{timeout:20000});await Promise.all([z.waitForNavigation({waitUntil:'domcontentloaded'}),z.click('[title="End Call"]')]);
await z.waitForSelector('.phonebook-panel');await z.waitForFunction(()=>!document.body.innerText.includes('TemporaryPartner'));
 assert.equal(await z.evaluate(()=>localStorage.getItem('imicall_saved_lines_list_v2')),null);assert.ok(await a.evaluate(id=>JSON.parse(localStorage.getItem('imicall_saved_lines_list_v2')).some(l=>l.id===id),line.id));
 console.log('A connected temporary call automatically forgets its contacts when ended; the peer’s separately saved contact remains. Direct mode explicitly selected for the local test.');
}finally{await b.close();}
