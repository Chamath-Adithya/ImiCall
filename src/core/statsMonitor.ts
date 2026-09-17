import { NetworkStats } from './types';

export class StatsMonitor {
  private pc: RTCPeerConnection;
  private intervalId: any = null;
  private lastBytesReceived: number = 0;
  private lastBytesSent: number = 0;
  private lastLost = 0;
  private lastReceived = 0;
  private lastTimestamp: number = 0;
  private onStatsCallback: ((stats: NetworkStats) => void) | null = null;

  constructor(pc: RTCPeerConnection) {
    this.pc = pc;
  }

  start(intervalMs: number = 1000, onStats: (stats: NetworkStats) => void) {
    this.onStatsCallback = onStats;
    this.intervalId = setInterval(() => this.collectStats(), intervalMs);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async collectStats() {
    if (!this.pc || this.pc.connectionState === 'closed') return;

    try {
      const report = await this.pc.getStats();
      const now = performance.now();
      const timeDelta = (now - this.lastTimestamp) / 1000; // in seconds

      let rtt = 0;
      let packetsLost = 0;
      let packetsReceived = 0;
      let jitter = 0;
      let bytesReceived = 0;
      let bytesSent = 0;
      let candidateType = 'unknown';

      report.forEach((stat) => {
        // Inbound RTP audio
        if (stat.type === 'inbound-rtp' && stat.kind === 'audio') {
          packetsLost = stat.packetsLost || 0;
          packetsReceived = stat.packetsReceived || 0;
          jitter = Math.round((stat.jitter || 0) * 1000); // ms
          bytesReceived = stat.bytesReceived || 0;
        }

        // Outbound RTP audio
        if (stat.type === 'outbound-rtp' && stat.kind === 'audio') {
          bytesSent = stat.bytesSent || 0;
        }

        // Candidate pair for RTT
        if (stat.type === 'candidate-pair' && stat.state === 'succeeded' && stat.nominated) {
          rtt = Math.round((stat.currentRoundTripTime || 0) * 1000);
          candidateType = report.get(stat.localCandidateId)?.candidateType || 'unknown'; // ms
        }


      });

      // Calculate bitrates in kbps
      let bitrateReceived = 0;
      let bitrateSent = 0;
      if (this.lastTimestamp > 0 && timeDelta > 0) {
        bitrateReceived = Math.round(((bytesReceived - this.lastBytesReceived) * 8) / (timeDelta * 1000));
        bitrateSent = Math.round(((bytesSent - this.lastBytesSent) * 8) / (timeDelta * 1000));
      }

      this.lastBytesReceived = bytesReceived;
      this.lastBytesSent = bytesSent;
      this.lastTimestamp = now;

      // Calculate packet loss percentage
      const lostNow = Math.max(0, packetsLost - this.lastLost);
      const receivedNow = Math.max(0, packetsReceived - this.lastReceived);
      this.lastLost = packetsLost; this.lastReceived = packetsReceived;
      const totalPackets = receivedNow + lostNow;
      const packetLossPct = totalPackets > 0 ? Math.min(100, Math.round((lostNow / totalPackets) * 100)) : 0;

      // Quality rating algorithm tailored for rural/low-signal WebRTC
      let qualityRating: NetworkStats['qualityRating'] = 'good';
      if (rtt > 600 || packetLossPct > 25) {
        qualityRating = 'critical';
      } else if (rtt > 350 || packetLossPct > 15) {
        qualityRating = 'poor';
      } else if (rtt > 180 || packetLossPct > 5) {
        qualityRating = 'fair';
      } else if (rtt < 80 && packetLossPct <= 1) {
        qualityRating = 'excellent';
      }

      const stats: NetworkStats = {
        rtt,
        packetLoss: packetLossPct,
        jitter,
        bitrateReceived: Math.max(0, bitrateReceived),
        bitrateSent: Math.max(0, bitrateSent),
        qualityRating,
        candidateType,
      };

      if (this.onStatsCallback) {
        this.onStatsCallback(stats);
      }
    } catch (err) {
      // Ignore stat collection errors during connection tear down
    }
  }
}
