import { describe, it, expect } from 'vitest';
import { tuneSdpForLowBandwidth } from '../src/core/sdpTuner';

describe('SDP Tuner for Low Bandwidth', () => {
  const sampleSdp = [
    'v=0',
    'o=- 123456 2 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'm=audio 9 UDP/TLS/RTP/SAVPF 111 126',
    'c=IN IP4 0.0.0.0',
    'a=rtpmap:111 opus/48000/2',
    'a=fmtp:111 minptime=10;useinbandfec=1',
    'a=rtpmap:126 telephone-event/8000',
  ].join('\r\n');

  it('should inject extreme low bandwidth parameters into Opus fmtp', () => {
    const tuned = tuneSdpForLowBandwidth(sampleSdp, 'extreme');

    expect(tuned).toContain('maxaveragebitrate=6000');
    expect(tuned).toContain('useinbandfec=1');
    expect(tuned).toContain('usedtx=1');
    expect(tuned).toContain('cbr=1');
    expect(tuned).toContain('maxplaybackrate=8000');
    expect(tuned).toContain('a=ptime:60');
    expect(tuned).toContain('a=maxptime:60');
  });

  it('should inject balanced profile parameters correctly', () => {
    const tuned = tuneSdpForLowBandwidth(sampleSdp, 'balanced');

    expect(tuned).toContain('maxaveragebitrate=12000');
    expect(tuned).toContain('useinbandfec=1');
    expect(tuned).toContain('usedtx=1');
    expect(tuned).toContain('maxplaybackrate=16000');
    expect(tuned).toContain('a=ptime:40');
  });

  it('should handle SDP without existing fmtp line by creating one', () => {
    const sdpWithoutFmtp = [
      'v=0',
      'm=audio 9 UDP/TLS/RTP/SAVPF 111',
      'a=rtpmap:111 opus/48000/2',
    ].join('\r\n');

    const tuned = tuneSdpForLowBandwidth(sdpWithoutFmtp, 'extreme');
    expect(tuned).toContain('a=fmtp:111');
    expect(tuned).toContain('maxaveragebitrate=6000');
  });
});
