import { randomHex } from './privateLine';
export interface TinyMessage { id: string; text: string; mine: boolean; status: 'sending'|'delivered'|'unconfirmed'|'received'; expires: number; }
/** Short, in-memory messages. Receipts confirm arrival, not reading. */
export class TinyMessages {
 items: TinyMessage[] = [];
 private pending = new Map<string,{item:TinyMessage; tries:number; next:number}>();
 private seen = new Map<string,number>();
 private listeners = new Set<()=>void>();
 private timer: ReturnType<typeof setInterval>;
 private lastSend = 0;
 private closed = false;
 constructor(private transmit:(type:string,payload:unknown)=>Promise<unknown>,private ready:()=>boolean) { this.timer=setInterval(()=>this.tick(),1000); }
 subscribe(fn:()=>void) { this.listeners.add(fn); return ()=>{this.listeners.delete(fn);}; }
 private changed() { this.listeners.forEach(fn=>fn()); }
 send(text:string) {
  text=text.trim();
  if(this.closed||!this.ready())throw new Error('Both people must have this connection open. Reconnect and try again.');
  if(!text||text.length>500||new TextEncoder().encode(text).length>2000)throw new Error('Keep messages within 500 characters and 2 KB.');
  if(this.pending.size>=3||Date.now()-this.lastSend<1000)throw new Error('Wait for the previous message before sending more.');
  this.lastSend=Date.now();const item:TinyMessage={id:randomHex(16),text,mine:true,status:'sending',expires:Date.now()+90000};
  this.items=[...this.items.slice(-19),item];this.pending.set(item.id,{item,tries:0,next:0});this.changed();this.tick();
 }
 receive(type:string,payload:any) {
  if(this.closed||!payload||typeof payload.id!=='string'||!/^[a-f0-9]{32}$/.test(payload.id))return;
  if(type==='tiny-ack') {const p=this.pending.get(payload.id);if(p){p.item.status='delivered';this.pending.delete(payload.id);this.changed();}return;}
  if(type!=='tiny-message'||typeof payload.text!=='string'||!payload.text.trim()||payload.text.length>500||new TextEncoder().encode(payload.text).length>2000||!Number.isFinite(payload.expires)||payload.expires<=Date.now()||payload.expires>Date.now()+95000)return;
  const isNew = !this.seen.has(payload.id);
  if(isNew){
   if(this.seen.size>=100)return;
   this.seen.set(payload.id,payload.expires);
   this.items=[...this.items.slice(-19),{id:payload.id,text:payload.text,mine:false,status:'received',expires:payload.expires}];this.changed();
  }
  void this.transmit('tiny-ack',{id:payload.id}).catch(()=>{});
  return isNew;
 }
 private tick() {
  if(this.closed)return;const now=Date.now();let changed=false;
  const before=this.items.length;this.items=this.items.filter(i=>i.expires>now);changed=before!==this.items.length;
  for(const[id,expiry]of this.seen)if(expiry<=now)this.seen.delete(id);
  for(const[id,p]of this.pending){
   if(p.item.expires<=now||p.tries>=3&&now>=p.next){p.item.status='unconfirmed';this.pending.delete(id);changed=true;continue;}
   if(now>=p.next&&this.ready()){p.tries++;p.next=now+10000;void this.transmit('tiny-message',{id,text:p.item.text,expires:p.item.expires}).catch(()=>{});}
  }
  if(changed)this.changed();
 }
 clear(){this.items=[];this.pending.clear();this.changed();}
 close(){this.clear();this.closed=true;clearInterval(this.timer);this.listeners.clear();this.seen.clear();}
}
