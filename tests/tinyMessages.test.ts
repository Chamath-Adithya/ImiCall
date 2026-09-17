import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { TinyMessages } from '../src/core/tinyMessages';
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-17T00:00:00Z'));vi.stubGlobal('crypto',webcrypto);});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
it('retries a lost receipt without displaying duplicate messages',async()=>{
 let a!:TinyMessages,b!:TinyMessages;let drop=true,count=0;
 a=new TinyMessages(async(t,p)=>{count++;b.receive(t,p);},()=>true);
 b=new TinyMessages(async(t,p)=>{if(!drop)a.receive(t,p);},()=>true);
 a.send('Hello on a weak link');expect(b.items).toHaveLength(1);expect(a.items[0].status).toBe('sending');drop=false;await vi.advanceTimersByTimeAsync(10000);expect(count).toBe(2);expect(b.items).toHaveLength(1);expect(a.items[0].status).toBe('delivered');a.close();b.close();
});
it('stops after three attempts and clears expired content',async()=>{const send=vi.fn(async()=>{});const a=new TinyMessages(send,()=>true);a.send('hello');await vi.advanceTimersByTimeAsync(31000);expect(send).toHaveBeenCalledTimes(3);expect(a.items[0].status).toBe('unconfirmed');await vi.advanceTimersByTimeAsync(60000);expect(a.items).toHaveLength(0);a.close();});
it('rejects oversized/offline traffic and cancels queued delivery on clear',async()=>{const tx=vi.fn(async()=>{});const a=new TinyMessages(tx,()=>true);expect(()=>a.send('a'.repeat(501))).toThrow();a.send('hello');a.clear();await vi.advanceTimersByTimeAsync(20000);expect(tx).toHaveBeenCalledTimes(1);const b=new TinyMessages(tx,()=>false);expect(()=>b.send('hello')).toThrow('Both people');a.close();b.close();});
