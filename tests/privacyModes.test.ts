import { describe, it, expect, vi, afterEach } from 'vitest';
import { privateIceConfig } from '../src/core/transportPrivacy';
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
describe('IP protection',()=>{
 it('fails closed without a relay',()=>{expect(()=>privateIceConfig([{urls:'stun:example.org'}],true)).toThrow('no direct connection');});
 it('uses relay policy, strips STUN and preserves credentials',()=>{const c=privateIceConfig([{urls:['stun:example.org','turns:relay.example.org'],username:'u',credential:'c'}],true);expect(c.iceTransportPolicy).toBe('relay');expect(c.iceCandidatePoolSize).toBe(0);expect(c.iceServers).toEqual([{urls:['turns:relay.example.org'],username:'u',credential:'c'}]);});
 it('permits direct transport only when explicitly selected',()=>expect(privateIceConfig([],false).iceTransportPolicy).toBe('all'));
});
describe('Temporary storage',()=>{
 it('neither reads nor overwrites saved contacts and forgets on module reload',async()=>{
  const disk=new Map([['imicall_saved_lines_list_v2','private-saved-contact']]);const session=new Map();
  const storage={getItem:vi.fn(k=>disk.get(k)??null),setItem:vi.fn((k,v)=>disk.set(k,v)),removeItem:vi.fn(k=>disk.delete(k))};
  vi.stubGlobal('location',{search:'?temporary=1'});vi.stubGlobal('localStorage',storage);vi.stubGlobal('sessionStorage',{getItem:(k:string)=>session.get(k)??null,setItem:(k:string,v:string)=>session.set(k,v)});
  const {localStore}=await import('../src/core/localStore');expect(localStore.isTemporary()).toBe(true);expect(localStore.getItem('imicall_saved_lines_list_v2')).toBeNull();localStore.setItem('imicall_saved_lines_list_v2','temporary-contact');expect(localStore.getItem('imicall_saved_lines_list_v2')).toBe('temporary-contact');expect(storage.setItem).not.toHaveBeenCalled();vi.resetModules();const fresh=await import('../src/core/localStore');expect(fresh.localStore.getItem('imicall_saved_lines_list_v2')).toBeNull();fresh.localStore.clearImiCall();expect(disk.get('imicall_saved_lines_list_v2')).toBe('private-saved-contact');
 });
});
