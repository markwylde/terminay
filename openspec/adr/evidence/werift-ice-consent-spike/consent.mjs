// Two loopback Werift peers; log ICE and peer state changes for 40 seconds.
// Usage: node consent.mjs <path to the staged runtime's lib/index.mjs>
const { RTCPeerConnection } = await import(process.argv[2]);
const config = {
	iceServers: [],
	iceAdditionalHostAddresses: ['127.0.0.1'],
	iceInterfaceAddresses: { udp4: '127.0.0.1' },
	iceUseIpv4: true,
	iceUseIpv6: false,
};
const a = new RTCPeerConnection(config);
const b = new RTCPeerConnection(config);
const t0 = Date.now();
const ts = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
for (const [name, pc] of [
	['a', a],
	['b', b],
]) {
	pc.iceConnectionStateChange.subscribe((s) =>
		console.log(`${ts()} ${name} ice=${s}`),
	);
	pc.connectionStateChange.subscribe((s) =>
		console.log(`${ts()} ${name} peer=${s}`),
	);
}
a.onIceCandidate.subscribe((c) => c && b.addIceCandidate(c));
b.onIceCandidate.subscribe((c) => c && a.addIceCandidate(c));
b.onDataChannel.subscribe(() => undefined);
a.createDataChannel('x');
await a.setLocalDescription(await a.createOffer());
await b.setRemoteDescription(a.localDescription);
await b.setLocalDescription(await b.createAnswer());
await a.setRemoteDescription(b.localDescription);
await new Promise((r) => setTimeout(r, 40_000));
console.log(
	`final a=${a.iceConnectionState}/${a.connectionState} b=${b.iceConnectionState}/${b.connectionState}`,
);
process.exit(0);
