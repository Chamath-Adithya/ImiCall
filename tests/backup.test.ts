import { beforeAll, describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import { exportConnections, importConnections } from '../src/core/backup';
import { newLineId, newLineSecret } from '../src/core/privateLine';
import { validateVoicePreset, VOICE_PRESETS } from '../src/core/voicePreset';
beforeAll(() => { Object.defineProperty(globalThis,'crypto',{value:webcrypto,configurable:true}); });
describe('Portable encrypted backups',()=>{
 it('round-trips contacts but rejects the wrong password and tampering',async()=>{
  const lines=[{id:newLineId(),name:'Private contact',passcode:newLineSecret(),createdAt:1}];
  const file=await exportConnections(lines,'a long unique password');
  expect(file).not.toContain(lines[0].passcode);expect(file).not.toContain(lines[0].name);
  expect(await importConnections(file,'a long unique password')).toEqual(lines);
  await expect(importConnections(file,'wrong password')).rejects.toThrow();
  const changed=JSON.parse(file);changed.data='AAAA'+changed.data.slice(4);
  await expect(importConnections(JSON.stringify(changed),'a long unique password')).rejects.toThrow();
  changed.rounds=999999999;await expect(importConnections(JSON.stringify(changed),'password')).rejects.toThrow(/Unsupported/);
 });
 it('rejects short export passwords',async()=>{await expect(exportConnections([],'short')).rejects.toThrow(/12/);});
});
describe('Declarative voice presets',()=>{
 it('accepts bounded presets and rejects invalid processing parameters',()=>{
  expect(validateVoicePreset(VOICE_PRESETS[1])).toEqual(VOICE_PRESETS[1]);
  expect(()=>validateVoicePreset({...VOICE_PRESETS[1],pitch:9000})).toThrow();
  expect(()=>validateVoicePreset({...VOICE_PRESETS[1],carrier:NaN})).toThrow();
  expect(validateVoicePreset({...VOICE_PRESETS[1],code:'malicious()'})).not.toHaveProperty('code');
 });
});
