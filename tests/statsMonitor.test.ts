import { afterEach, expect, it, vi } from 'vitest';
import { StatsMonitor } from '../src/core/statsMonitor';
afterEach(()=>vi.useRealTimers());
it('reacts to recent packet loss rather than hiding it in lifetime totals',async()=>{
 vi.useFakeTimers();let lost=0,received=10000;
 const pc={connectionState:'connected',getStats:async()=>new Map([['audio',{type:'inbound-rtp',kind:'audio',packetsLost:lost,packetsReceived:received}],['pair',{type:'candidate-pair',state:'succeeded',nominated:true,localCandidateId:'selected',currentRoundTripTime:.1}],['selected',{type:'local-candidate',candidateType:'relay'}],['unused',{type:'remote-candidate',candidateType:'host'}]])};
 const results:any[]=[];const monitor=new StatsMonitor(pc as unknown as RTCPeerConnection);monitor.start(1000,s=>results.push(s));await vi.advanceTimersByTimeAsync(1000);lost=10;received+=10;await vi.advanceTimersByTimeAsync(1000);
 expect(results[1].packetLoss).toBe(50);expect(results[1].qualityRating).toBe('critical');expect(results[1].candidateType).toBe('relay');received+=100;await vi.advanceTimersByTimeAsync(1000);expect(results[2].packetLoss).toBe(0);monitor.stop();
});
