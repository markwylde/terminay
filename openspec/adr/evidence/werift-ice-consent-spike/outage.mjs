// Two loopback Werift peers on a netem-delayed `lo`. Twenty seconds after
// setup the path is cut (100% loss), restored twelve seconds later, then cut
// for good eighteen seconds after that. Needs root and `tc` (iproute2), with
// `tc qdisc add dev lo root netem delay 40ms` already applied.
// Usage: node outage.mjs <path to the staged runtime's lib/index.mjs>
import { execSync } from 'node:child_process';

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
const at = (seconds, run) => setTimeout(run, seconds * 1000);
const tc = (args) => {
	console.log(`${ts()} tc ${args}`);
	execSync(`tc qdisc change dev lo root netem ${args}`);
};
at(20, () => tc('delay 40ms loss 100%'));
at(32, () => tc('delay 40ms'));
at(50, () => tc('delay 40ms loss 100%'));
await new Promise((r) => setTimeout(r, 110_000));
console.log(
	`final a=${a.iceConnectionState}/${a.connectionState} b=${b.iceConnectionState}/${b.connectionState}`,
);
process.exit(0);
