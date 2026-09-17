import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
const base=process.env.IMICALL_TEST_URL||'http://localhost:8080';
const browser=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});
const click=async(p,t)=>{await p.waitForFunction(t=>Array.from(document.querySelectorAll('button')).some(e=>e.textContent.trim()===t),{},t);await p.evaluate(t=>Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()===t).click(),t);};
try{
 const ca=await browser.createBrowserContext(),cb=await browser.createBrowserContext();const a=await ca.newPage(),b=await cb.newPage();
 for(const p of[a,b]){await p.setViewport({width:1200,height:900});await p.evaluateOnNewDocument(()=>{
  window.__pcCount=0;window.__micCount=0;window.__wire=[];window.__dropAck=true;
  const PC=RTCPeerConnection;window.RTCPeerConnection=new Proxy(PC,{construct(t,args){window.__pcCount++;return new t(...args);}});
  navigator.mediaDevices.getUserMedia=async()=>{window.__micCount++;throw new DOMException('Not allowed','NotAllowedError');};
  const WS=WebSocket;window.WebSocket=new Proxy(WS,{construct(t,args){const ws=new t(...args),send=ws.send.bind(ws);let next=0;ws.send=data=>{const m=JSON.parse(data);if(!['tiny-message','tiny-ack'].includes(m.type)){send(data);return;}window.__wire.push(data);if(m.type==='tiny-ack'&&window.__dropAck){window.__dropAck=false;return;}const bytes=new TextEncoder().encode(data).length;next=Math.max(Date.now(),next)+1200+bytes*8/6000*1000;setTimeout(()=>{if(ws.readyState===1)send(data);},next-Date.now());};return ws;}});
 });}
 await a.goto(base);await click(a,'Browse contacts first');await a.waitForSelector('.contact-select');const line=await a.evaluate(()=>JSON.parse(localStorage.getItem('imicall_saved_lines_list_v2'))[0]);
 await b.goto(`${base}/#connect=${line.id}&pin=${line.passcode}&from=Peer`);await click(b,'Browse contacts first');await click(b,'Connect & Save to Phone Book');
 await a.waitForFunction(()=>document.body.innerText.includes('Available now'));await click(a,'Tiny messages');await click(b,'Tiny messages');await a.waitForSelector('[aria-label="Tiny message"]');const message='Tiny secret message on a very weak link';await a.type('[aria-label="Tiny message"]',message);const started=Date.now();await click(a,'Send tiny message');
 await b.waitForFunction(t=>document.querySelector('.tiny-list')?.textContent.includes(t),{},message);await a.waitForFunction(()=>document.querySelector('.tiny-list')?.textContent.includes('Delivered to device'),{timeout:30000});
 assert.equal(await b.$$eval('.tiny-list .chat-bubble',els=>els.length),1);
 for(const p of[a,b]){assert.deepEqual(await p.evaluate(()=>[window.__pcCount,window.__micCount]),[0,0]);assert.equal(await p.evaluate(t=>Object.values(localStorage).join().includes(t),message),false);assert.equal(await p.evaluate(t=>window.__wire.some(w=>w.includes(t)),message),false);}
 console.log(`Encrypted tiny message delivered with a deliberately lost first receipt, 6 kbps application-message pacing and 1.2 s delay per send, in ${Date.now()-started} ms. No duplicate, microphone, RTCPeerConnection, TURN, plaintext wire payload or persisted message.`);
 await a.setViewport({width:390,height:844});assert.equal(await a.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await click(a,'Close & clear');await click(a,'Tiny messages');assert.equal(await a.$$eval('.tiny-list .chat-bubble',els=>els.length),0);
}finally{await browser.close();}
