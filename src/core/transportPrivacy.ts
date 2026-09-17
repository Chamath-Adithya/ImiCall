export function privateIceConfig(servers: RTCIceServer[], relayOnly: boolean): RTCConfiguration {
 const relays = servers.map(server => ({ ...server, urls: [server.urls].flat().filter(url => /^turns?:/i.test(url)) })).filter(server => server.urls.length);
 if (relayOnly && !relays.length) throw new Error('IP protection requires a configured TURN relay. This call was stopped; no direct connection was attempted. Ask the operator to configure TURN, or explicitly choose Direct calls in Settings.');
 return { iceServers: relayOnly ? relays : servers, iceTransportPolicy: relayOnly ? 'relay' : 'all', iceCandidatePoolSize: 0, bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require' };
}
