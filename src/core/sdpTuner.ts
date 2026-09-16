import { SignalProfile, SIGNAL_PROFILES } from './types';

/**
 * Tunes WebRTC Session Description Protocol (SDP) for extreme low bandwidth and high packet loss.
 * Implements RFC 7587 (RTP Payload Format for the Opus Speech and Audio Codec) and RFC 6716.
 */
export function tuneSdpForLowBandwidth(sdp: string, profileKey: SignalProfile = 'extreme'): string {
  const profile = SIGNAL_PROFILES[profileKey];
  const lines = sdp.split('\r\n');
  const modifiedLines: string[] = [];

  // Find Opus payload type (default is usually 111)
  let opusPayloadType: string | null = null;
  for (const line of lines) {
    const match = line.match(/^a=rtpmap:(\d+)\s+opus\/48000/i);
    if (match) {
      opusPayloadType = match[1];
      break;
    }
  }

  // Parameters to inject into fmtp line
  // Note: RFC 7587 states cbr MUST NOT be combined with usedtx=1
  const opusParams: Record<string, string | number> = {
    maxaveragebitrate: profile.bitrate,
    stereo: 0,
    'sprop-stereo': 0,
    useinbandfec: 1, // Forward Error Correction recovers dropped packets
    usedtx: 1,       // Silence suppression saves cellular data
  };

  if (profile.id === 'extreme') {
    opusParams['maxplaybackrate'] = 16000; // Wideband speech (warm and intelligible)
  } else if (profile.id === 'balanced') {
    opusParams['maxplaybackrate'] = 24000;
  } else {
    opusParams['maxplaybackrate'] = 48000;
  }

  let fmtpFound = false;
  let inAudioMedia = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('m=audio')) {
      inAudioMedia = true;
      modifiedLines.push(line);
      continue;
    }

    if (line.startsWith('m=video') || line.startsWith('m=application')) {
      inAudioMedia = false;
    }

    if (inAudioMedia && (line.startsWith('a=ptime:') || line.startsWith('a=maxptime:'))) {
      continue;
    }

    if (opusPayloadType && line.startsWith(`a=fmtp:${opusPayloadType}`)) {
      fmtpFound = true;
      const spaceIdx = line.indexOf(' ');
      const prefix = line.substring(0, spaceIdx);
      const paramStr = line.substring(spaceIdx + 1);
      const existingParams: Record<string, string> = {};

      paramStr.split(';').forEach((pair) => {
        const [k, v] = pair.trim().split('=');
        if (k && v !== undefined) existingParams[k.toLowerCase()] = v;
      });

      // Merge our tuned parameters
      for (const [k, v] of Object.entries(opusParams)) {
        existingParams[k.toLowerCase()] = String(v);
      }

      const newParamStr = Object.entries(existingParams)
        .map(([k, v]) => `${k}=${v}`)
        .join(';');

      modifiedLines.push(`${prefix} ${newParamStr}`);
      continue;
    }

    modifiedLines.push(line);
  }

  if (opusPayloadType && !fmtpFound) {
    const finalLines: string[] = [];
    for (const line of modifiedLines) {
      finalLines.push(line);
      if (line.startsWith(`a=rtpmap:${opusPayloadType}`)) {
        const paramStr = Object.entries(opusParams)
          .map(([k, v]) => `${k}=${v}`)
          .join(';');
        finalLines.push(`a=fmtp:${opusPayloadType} ${paramStr}`);
      }
    }
    return appendPtime(finalLines, profile.ptime, profile.maxptime).join('\r\n');
  }

  return appendPtime(modifiedLines, profile.ptime, profile.maxptime).join('\r\n');
}

function appendPtime(lines: string[], ptime: number, maxptime: number): string[] {
  const result: string[] = [];
  let added = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    result.push(line);
    if (!added && line.startsWith('m=audio')) {
      result.push(`a=ptime:${ptime}`);
      result.push(`a=maxptime:${maxptime}`);
      added = true;
    }
  }

  return result;
}
