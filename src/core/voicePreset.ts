export interface VoicePreset { schema: 'imicall-voice'; version: 1; name: string; pitch: number; carrier: number; cutoff: number; mix: number; }
export const NATURAL: VoicePreset = { schema: 'imicall-voice', version: 1, name: 'Natural', pitch: 0, carrier: 0, cutoff: 20000, mix: 0 };
export const VOICE_PRESETS: VoicePreset[] = [NATURAL,
 { schema: 'imicall-voice', version: 1, name: 'Low voice', pitch: -5, carrier: 0, cutoff: 4200, mix: 1 },
 { schema: 'imicall-voice', version: 1, name: 'Radio', pitch: 0, carrier: 0, cutoff: 2200, mix: 1 },
 { schema: 'imicall-voice', version: 1, name: 'Robot', pitch: -3, carrier: 65, cutoff: 4000, mix: 1 },
];
export function validateVoicePreset(value: unknown): VoicePreset {
 const p = value as VoicePreset;
 if (!p || p.schema !== 'imicall-voice' || p.version !== 1 || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 40 || !Number.isFinite(p.pitch) || p.pitch < -7 || p.pitch > 7 || !Number.isFinite(p.carrier) || p.carrier < 0 || p.carrier > 100 || !Number.isFinite(p.cutoff) || p.cutoff < 1200 || p.cutoff > 20000 || !Number.isFinite(p.mix) || p.mix < 0 || p.mix > 1) throw new Error('Invalid preset. Use an ImiCall preset JSON file with supported numeric settings.');
 return { schema: 'imicall-voice', version: 1, name: p.name.trim(), pitch: p.pitch, carrier: p.carrier, cutoff: p.cutoff, mix: p.mix };
}
