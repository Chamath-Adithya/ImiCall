import puppeteer from 'puppeteer-core';
import fs from 'node:fs/promises';
const out=process.env.IMICALL_ARTIFACTS||'work/verification';
await fs.mkdir(out,{recursive:true});
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});
try {
 const p=await b.newPage();await p.setViewport({width:390,height:844,deviceScaleFactor:1,isMobile:true,hasTouch:true});
 const c=await p.createCDPSession();await c.send('Network.enable');await c.send('Network.emulateNetworkConditions',{offline:false,latency:800,downloadThroughput:150000/8,uploadThroughput:50000/8});
 const start=Date.now();await p.goto('http://localhost:8080/',{waitUntil:'domcontentloaded'});await p.waitForSelector('.phonebook-panel');
 const result={conditions:'150 kbps download, 50 kbps upload, 800 ms latency; desktop Chrome mobile viewport, empty cache',phoneBookMs:Date.now()-start,paint:await p.evaluate(()=>performance.getEntriesByType('paint').map(x=>({name:x.name,ms:Math.round(x.startTime)})))};
 console.log(JSON.stringify(result));await fs.writeFile(out+'/imicall-performance.json',JSON.stringify(result,null,2));
 await c.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
 await p.waitForSelector('.permission-setup');
 await p.evaluate(() => Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Browse contacts first')?.click());
 await p.waitForSelector('.permission-setup', {hidden:true});
 for(const [name,width,height] of [['mobile',390,844],['tablet',820,1180],['desktop',1440,1000]]){await p.setViewport({width,height});await p.screenshot({path:out+`/imicall-${name}.png`,fullPage:true});}
} finally {await b.close();}
