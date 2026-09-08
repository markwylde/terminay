import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { acceptSessionSignalingUpgrade } from "./signalingHostBoundary.js";

/**
 * A frame larger than this is not signaling. Offers, answers, and ICE
 * candidates are small; the cap keeps a hostile client from buying memory on
 * the server it is not yet authenticated to.
 */
export const DIRECT_SIGNALING_MAX_FRAME_BYTES = 128 * 1024;
/** Concurrent handshakes admitted per room inside the window below. */
export const DIRECT_SIGNALING_ROOM_HANDSHAKES = 4;
export const DIRECT_SIGNALING_HANDSHAKE_WINDOW_MS = 60_000;

/** Frames the relay routes. It reads the type and the room or session a frame
 * belongs to, and nothing else: transcripts, offers, proofs, and credentials
 * are forwarded as the bytes they arrived as. */
const PAIRING_HOST_FRAME = "host-ready";
const DEVICE_HOST_FRAME = "device-host-ready";
const PAIRING_JOIN_FRAME = "client-join";
const DEVICE_JOIN_FRAME = "device-join";
const PAIRING_PLANE_FRAMES = new Set(["offer", "answer", "ice"]);
const DEVICE_PLANE_FRAMES = new Set(["device-offer", "device-answer", "device-ice"]);
const PEER_CLOSED_FRAME = "peer-closed";

export interface DirectSignalingRelayOptions {
	/** Exact HTTPS origin this server advertises for its own listener. */
	readonly sessionOrigin: string;
	/** Public connection-manager origin, which must never accept signaling. */
	readonly managerOrigin: string;
	readonly signalingPath?: string;
	readonly maxFrameBytes?: number;
	readonly roomHandshakes?: number;
	readonly handshakeWindowMs?: number;
	readonly now?: () => number;
	readonly onDiagnostic?: (event: Readonly<Record<string, unknown>>) => void;
}

export interface DirectSignalingRelayStatus {
	readonly pairingHostRegistered: boolean;
	readonly deviceHostRegistered: boolean;
	readonly pairingRoomId: string | undefined;
	readonly deviceSessionId: string | undefined;
	readonly connections: number;
}

export interface DirectSignalingRelay {
	readonly signalingPath: string;
	/** Accept or refuse an HTTP upgrade. Refusal destroys the socket. */
	handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void;
	status(): DirectSignalingRelayStatus;
	close(): Promise<void>;
}

interface Plane {
	host: WebSocket | undefined;
	hostRoom: string | undefined;
	client: WebSocket | undefined;
}

/**
 * A data-blind signaling endpoint a standalone server serves itself.
 *
 * It routes the hosted frame vocabulary between exactly one registered host
 * and the client currently handshaking with it, retains nothing beyond that
 * routing state, and never parses a transcript, an offer, or a credential.
 * Authentication of the endpoint is the server host key's signature over the
 * transport transcript, exactly as for the hosted relay; this router is not
 * trusted for confidentiality or integrity.
 */
export function createDirectSignalingRelay(
	options: DirectSignalingRelayOptions,
): DirectSignalingRelay {
	const signalingPath = options.signalingPath ?? "/signal";
	const maxFrameBytes = options.maxFrameBytes ?? DIRECT_SIGNALING_MAX_FRAME_BYTES;
	const roomHandshakes = options.roomHandshakes ?? DIRECT_SIGNALING_ROOM_HANDSHAKES;
	const handshakeWindowMs = options.handshakeWindowMs ?? DIRECT_SIGNALING_HANDSHAKE_WINDOW_MS;
	const now = options.now ?? (() => Date.now());
	const diagnose = options.onDiagnostic ?? (() => undefined);
	// Validate the boundary configuration once, at construction, so a
	// misconfigured origin pair cannot be discovered only under load.
	acceptSessionSignalingUpgrade(
		{ host: new URL(options.sessionOrigin).host, upgrade: "websocket", url: signalingPath },
		{ managerOrigin: options.managerOrigin, sessionOrigin: options.sessionOrigin, signalingPath },
	);

	const server = new WebSocketServer({ noServer: true, maxPayload: maxFrameBytes });
	const pairing: Plane = { host: undefined, hostRoom: undefined, client: undefined };
	const device: Plane = { host: undefined, hostRoom: undefined, client: undefined };
	const handshakes = new Map<string, number[]>();
	const sockets = new Set<WebSocket>();
	let closed = false;

	function admitHandshake(room: string): boolean {
		const at = now();
		const recent = (handshakes.get(room) ?? []).filter(
			(stamp) => at - stamp < handshakeWindowMs,
		);
		if (recent.length >= roomHandshakes) {
			handshakes.set(room, recent);
			return false;
		}
		recent.push(at);
		handshakes.set(room, recent);
		return true;
	}

	function refuse(socket: WebSocket, cause: string): void {
		diagnose({ type: "refused", cause });
		socket.close(1008, cause);
	}

	function route(plane: Plane, socket: WebSocket, raw: Buffer | ArrayBuffer | Buffer[]): void {
		const counterpart = socket === plane.host ? plane.client : plane.host;
		counterpart?.send(raw as Buffer);
	}

	function onFrame(socket: WebSocket, raw: Buffer | ArrayBuffer | Buffer[]): void {
		const routing = readRouting(raw);
		if (routing === undefined) {
			refuse(socket, "unroutable-frame");
			return;
		}
		if (routing.type === PAIRING_HOST_FRAME) {
			registerHost(pairing, socket, routing.room, "host-registered", "roomId");
			return;
		}
		if (routing.type === DEVICE_HOST_FRAME) {
			registerHost(device, socket, routing.room, "device-host-registered", "sessionId");
			return;
		}
		if (routing.type === PAIRING_JOIN_FRAME || routing.type === DEVICE_JOIN_FRAME) {
			const plane = routing.type === PAIRING_JOIN_FRAME ? pairing : device;
			if (plane.host === undefined) {
				refuse(socket, "no-registered-host");
				return;
			}
			// A join names the room it wants; only the room this relay's one
			// registered host actually owns is admitted.
			if (routing.room !== undefined && routing.room !== plane.hostRoom) {
				refuse(socket, "unknown-room");
				return;
			}
			if (!admitHandshake(`${routing.type}:${plane.hostRoom ?? ""}`)) {
				refuse(socket, "handshake-limit");
				return;
			}
			plane.client = socket;
			plane.host.send(raw as Buffer);
			return;
		}
		if (routing.type === PEER_CLOSED_FRAME) {
			if (socket === pairing.host || socket === pairing.client) route(pairing, socket, raw);
			if (socket === device.host || socket === device.client) route(device, socket, raw);
			return;
		}
		if (PAIRING_PLANE_FRAMES.has(routing.type)) {
			route(pairing, socket, raw);
			return;
		}
		if (DEVICE_PLANE_FRAMES.has(routing.type)) {
			route(device, socket, raw);
			return;
		}
		refuse(socket, "unroutable-frame");
	}

	function registerHost(
		plane: Plane,
		socket: WebSocket,
		room: string | undefined,
		acknowledgement: string,
		roomField: string,
	): void {
		if (room === undefined) {
			refuse(socket, "host-registration-needs-a-room");
			return;
		}
		// Exactly one host owns this session. A second registration is a second
		// authority claiming the same server, so it is refused rather than
		// silently taking the room over.
		if (plane.host !== undefined && plane.host !== socket) {
			refuse(socket, "host-already-registered");
			return;
		}
		plane.host = socket;
		plane.hostRoom = room;
		diagnose({ type: "host-registered", room: roomField });
		socket.send(JSON.stringify({ type: acknowledgement, [roomField]: room }));
	}

	server.on("connection", (socket: WebSocket) => {
		sockets.add(socket);
		socket.on("message", (raw: Buffer | ArrayBuffer | Buffer[]) => {
			if (closed) return;
			onFrame(socket, raw);
		});
		// An oversized or malformed frame surfaces here. It is a routing fault,
		// not a server fault: drop the connection instead of letting it reach the
		// process as an unhandled error.
		socket.on("error", (error: Error) => {
			diagnose({ type: "socket-error", cause: error.message });
			socket.terminate();
		});
		socket.once("close", () => {
			sockets.delete(socket);
			for (const plane of [pairing, device]) {
				if (plane.host === socket) {
					plane.host = undefined;
					plane.hostRoom = undefined;
				}
				if (plane.client === socket) plane.client = undefined;
			}
		});
	});

	return Object.freeze({
		signalingPath,
		handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
			if (closed) {
				socket.destroy();
				return;
			}
			try {
				acceptSessionSignalingUpgrade(
					{ host: request.headers.host, upgrade: request.headers.upgrade, url: request.url },
					{
						managerOrigin: options.managerOrigin,
						sessionOrigin: options.sessionOrigin,
						signalingPath,
					},
				);
			} catch (error) {
				diagnose({
					type: "upgrade-refused",
					cause: error instanceof Error ? error.message : "invalid upgrade",
				});
				socket.destroy();
				return;
			}
			server.handleUpgrade(request, socket, head, (websocket) => {
				server.emit("connection", websocket, request);
			});
		},
		status(): DirectSignalingRelayStatus {
			return Object.freeze({
				pairingHostRegistered: pairing.host !== undefined,
				deviceHostRegistered: device.host !== undefined,
				pairingRoomId: pairing.hostRoom,
				deviceSessionId: device.hostRoom,
				connections: sockets.size,
			});
		},
		async close(): Promise<void> {
			closed = true;
			for (const socket of sockets) socket.terminate();
			sockets.clear();
			await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
		},
	});
}

/**
 * Read only what routing needs: the frame type and the room or session it
 * belongs to. Everything else in the frame stays opaque and is forwarded
 * verbatim.
 */
function readRouting(
	raw: Buffer | ArrayBuffer | Buffer[],
): { readonly type: string; readonly room: string | undefined } | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(
			(Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw as ArrayBuffer)).toString("utf8"),
		);
	} catch {
		return undefined;
	}
	if (parsed === null || typeof parsed !== "object") return undefined;
	const frame = parsed as Record<string, unknown>;
	if (typeof frame.type !== "string" || frame.type.length === 0) return undefined;
	const room = frame.roomId ?? frame.sessionId;
	return Object.freeze({
		type: frame.type,
		room: typeof room === "string" && room.length > 0 ? room : undefined,
	});
}
