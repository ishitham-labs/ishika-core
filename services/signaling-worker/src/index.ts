/**
 * Ishika Open Core: Cloudflare Worker WebRTC Signaling Relay
 * License: AGPL-3.0-or-later
 *
 * Provides zero-cost ($0/month) WebRTC signaling room coordination across
 * remote browsers using Cloudflare Workers and Durable Objects.
 *
 * Only transient ~1KB SDP offers, answers, ICE candidates, and stage sync
 * JSON payloads pass through this worker; the 30 FPS video streams directly
 * peer-to-peer between the client browsers.
 */

export interface Env {
  SIGNALING_ROOM: DurableObjectNamespace;
}

const MAX_MESSAGE_BYTES = 16 * 1024; // 16 KB ceiling
const MAX_PEERS_PER_ROOM = 16;
const RATE_LIMIT_WINDOW_MS = 1000;
const MAX_MESSAGES_PER_WINDOW = 60;
const ROOM_ID_REGEX = /^[a-zA-Z0-9_-]{3,64}$/;
const CLIENT_ID_REGEX = /^[a-zA-Z0-9_-]{3,64}$/;

const ALLOWED_TYPES = new Set([
  'offer',
  'answer',
  'candidate',
  'stage_sync',
  'pin_sync',
  'control_sync',
  'estop_sync',
  'specimen_sync',
  'role_assigned',
  'room_state',
  'peer_joined',
  'peer_left',
  'request_offer',
  'ping',
  'pong',
]);

const VALID_OBJECTIVES = new Set([4, 10, 20, 40]);

function getCorsOrigin(originHeader: string | null): string {
  if (!originHeader) return 'https://ishitham-labs.github.io';
  if (
    originHeader === 'https://ishitham-labs.github.io' ||
    originHeader === 'https://ishitham.com' ||
    originHeader.startsWith('http://localhost:') ||
    originHeader.startsWith('http://127.0.0.1:')
  ) {
    return originHeader;
  }
  return 'https://ishitham-labs.github.io';
}

function sanitizeAndValidateMessage(raw: string, authenticatedClientId: string): { serialized: string; targetId?: string } | null {
  if (raw.length > MAX_MESSAGE_BYTES) return null;

  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!msg || typeof msg !== 'object') return null;
  if (typeof msg.type !== 'string' || !ALLOWED_TYPES.has(msg.type)) return null;
  if (msg.targetId !== undefined && (typeof msg.targetId !== 'string' || msg.targetId.length > 64)) {
    return null;
  }

  // Sanitize stage_sync payloads at the relay boundary
  if (msg.type === 'stage_sync') {
    const p = msg.payload as Record<string, unknown> | undefined;
    if (
      !p ||
      typeof p !== 'object' ||
      typeof p.x !== 'number' ||
      !Number.isFinite(p.x) ||
      typeof p.y !== 'number' ||
      !Number.isFinite(p.y) ||
      typeof p.z !== 'number' ||
      !Number.isFinite(p.z) ||
      typeof p.objective !== 'number' ||
      !VALID_OBJECTIVES.has(p.objective)
    ) {
      return null;
    }
    msg.payload = {
      x: Math.max(-25000, Math.min(25000, p.x)),
      y: Math.max(-12500, Math.min(12500, p.y)),
      z: Math.max(-50, Math.min(50, p.z)),
      objective: p.objective,
    };
  }

  // Enforce authenticated senderId to prevent peer spoofing
  const sanitizedEnvelope = {
    type: msg.type,
    senderId: authenticatedClientId,
    targetId: msg.targetId as string | undefined,
    payload: msg.payload,
    timestamp: typeof msg.timestamp === 'number' && Number.isFinite(msg.timestamp) ? msg.timestamp : Date.now(),
  };

  return {
    serialized: JSON.stringify(sanitizedEnvelope),
    targetId: sanitizedEnvelope.targetId,
  };
}

interface PeerMeta {
  clientId: string;
  role: 'host' | 'viewer';
  windowStart: number;
  msgCount: number;
}

export class SignalingRoom {
  private state: DurableObjectState;
  private peers: Map<WebSocket, PeerMeta>;
  private hostClientId: string | null = null;

  constructor(state: DurableObjectState) {
    this.state = state;
    this.peers = new Map();
  }

  async fetch(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get('Upgrade');
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    if (this.peers.size >= MAX_PEERS_PER_ROOM) {
      return new Response('Signaling room capacity reached', { status: 429 });
    }

    const url = new URL(request.url);
    const rawClient = url.searchParams.get('client');
    const clientId = rawClient && CLIENT_ID_REGEX.test(rawClient) ? rawClient : `peer_${crypto.randomUUID().slice(0, 8)}`;

    const webSocketPair = new WebSocketPair();
    const [clientSocket, serverSocket] = Object.values(webSocketPair);

    // Accept server-side WebSocket connection
    serverSocket.accept();
    this.peers.set(serverSocket, {
      clientId,
      role: 'viewer',
      windowStart: Date.now(),
      msgCount: 0,
    });

    // Notify connecting client of current room state
    try {
      serverSocket.send(
        JSON.stringify({
          type: 'room_state',
          senderId: 'server',
          timestamp: Date.now(),
          payload: {
            hasHost: Boolean(this.hostClientId),
            hostClientId: this.hostClientId,
            peerCount: this.peers.size,
          },
        })
      );
    } catch (_) {}

    // Notify other peers in this room that a new peer joined
    this.broadcast(
      JSON.stringify({
        type: 'peer_joined',
        senderId: clientId,
        timestamp: Date.now(),
        payload: { peerCount: this.peers.size, hasHost: Boolean(this.hostClientId) },
      }),
      serverSocket
    );

    serverSocket.addEventListener('message', (event) => {
      try {
        const meta = this.peers.get(serverSocket);
        if (!meta) return;

        // Per-connection sliding-window rate limiting
        const now = Date.now();
        if (now - meta.windowStart > RATE_LIMIT_WINDOW_MS) {
          meta.windowStart = now;
          meta.msgCount = 0;
        }
        meta.msgCount += 1;
        if (meta.msgCount > MAX_MESSAGES_PER_WINDOW) {
          return;
        }

        const raw = typeof event.data === 'string'
          ? event.data
          : new TextDecoder().decode(event.data as ArrayBuffer);

        const validated = sanitizeAndValidateMessage(raw, clientId);
        if (!validated) return;

        // Strict Single-Host Enforcement
        try {
          const parsed = JSON.parse(validated.serialized);
          if (parsed.type === 'peer_joined') {
            const requestedRole = parsed.payload?.role;
            if (requestedRole === 'host') {
              if (!this.hostClientId || this.hostClientId === clientId) {
                this.hostClientId = clientId;
                meta.role = 'host';
                serverSocket.send(
                  JSON.stringify({
                    type: 'role_assigned',
                    senderId: 'server',
                    timestamp: Date.now(),
                    payload: { role: 'host' },
                  })
                );
              } else {
                // Host slot already occupied! Enforce viewer role
                meta.role = 'viewer';
                serverSocket.send(
                  JSON.stringify({
                    type: 'role_assigned',
                    senderId: 'server',
                    timestamp: Date.now(),
                    payload: {
                      role: 'viewer',
                      reason: 'host_already_exists',
                      currentHostId: this.hostClientId,
                    },
                  })
                );
                return;
              }
            } else {
              meta.role = 'viewer';
            }
          }
        } catch (_) {}

        // Route message: if targetId specified, route directly; otherwise broadcast
        this.broadcast(validated.serialized, serverSocket, validated.targetId);
      } catch (err) {
        console.warn('Signaling message parse error:', err);
      }
    });

    const cleanup = () => {
      this.peers.delete(serverSocket);
      if (this.hostClientId === clientId) {
        this.hostClientId = null;
      }
      this.broadcast(
        JSON.stringify({
          type: 'peer_left',
          senderId: clientId,
          timestamp: Date.now(),
          payload: { peerCount: this.peers.size, hasHost: Boolean(this.hostClientId) },
        }),
        serverSocket
      );
    };

    serverSocket.addEventListener('close', cleanup);
    serverSocket.addEventListener('error', cleanup);

    return new Response(null, {
      status: 101,
      webSocket: clientSocket,
    });
  }

  private broadcast(message: string, senderSocket: WebSocket, targetId?: string): void {
    for (const [ws, meta] of this.peers.entries()) {
      if (ws !== senderSocket && ws.readyState === WebSocket.OPEN) {
        if (!targetId || targetId === meta.clientId) {
          try {
            ws.send(message);
          } catch (err) {
            console.warn('Failed to dispatch WebSocket message:', err);
          }
        }
      }
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const corsOrigin = getCorsOrigin(request.headers.get('Origin'));

    // Health check & status landing page
    const upgradeHeader = request.headers.get('Upgrade');
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
      return new Response(
        JSON.stringify({
          status: 'ok',
          service: 'ishika-webrtc-signaling',
          version: '0.2.0',
          protocol: 'AGPL-3.0-or-later',
          description: 'Zero-cost hardened serverless WebRTC signaling relay for tele-pathology',
          security: {
            maxMessageBytes: MAX_MESSAGE_BYTES,
            rateLimitPerSec: MAX_MESSAGES_PER_WINDOW,
            defaultRoomDisabled: true,
          },
          usage: 'Connect via wss://<domain>?session=<roomId>&client=<clientId>',
          timestamp: new Date().toISOString(),
        }, null, 2),
        {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': corsOrigin,
            'Vary': 'Origin',
          },
        }
      );
    }

    // Resolve and validate explicit session/room query parameter (no default-room fallback)
    const roomId = url.searchParams.get('session') || url.searchParams.get('room');
    if (!roomId || roomId === 'default-room' || !ROOM_ID_REGEX.test(roomId)) {
      return new Response(
        JSON.stringify({
          error: 'Invalid or missing session room ID. Must be 3-64 alphanumeric/hyphen characters and cannot be default-room.',
        }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': corsOrigin,
          },
        }
      );
    }

    const id = env.SIGNALING_ROOM.idFromName(roomId);
    const roomObject = env.SIGNALING_ROOM.get(id);

    return roomObject.fetch(request);
  },
};
