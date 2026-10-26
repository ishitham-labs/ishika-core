#!/usr/bin/env node
/**
 * Ishika Open Core: Zero-Dependency Local WebSocket Signaling Server
 * License: AGPL-3.0-or-later
 *
 * Provides local cross-browser WebRTC signaling without requiring Cloudflare,
 * Docker, or external npm dependencies.
 *
 * Implements RFC 6455 WebSocket framing directly on Node.js net/http.
 */

import http from 'http';
import crypto from 'crypto';
import { URL } from 'url';

const PORT = parseInt(process.env.PORT || '8787', 10);
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE_BYTES = 16 * 1024; // 16 KB ceiling
const ROOM_ID_REGEX = /^[a-zA-Z0-9_-]{3,64}$/;
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

// Room Map: roomId -> { peers: Set<{ socket, clientId, role }>, hostClientId: string | null }
const rooms = new Map();

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      peers: new Set(),
      hostClientId: null,
    });
  }
  return rooms.get(roomId);
}

function broadcastToRoom(roomId, messageString, senderSocket, targetId) {
  const room = rooms.get(roomId);
  if (!room) return;

  for (const peer of room.peers) {
    if (peer.socket !== senderSocket && !peer.socket.destroyed) {
      if (!targetId || targetId === peer.clientId) {
        sendWsFrame(peer.socket, messageString);
      }
    }
  }
}

function sendWsFrame(socket, text) {
  if (socket.destroyed || !socket.writable) return;

  const payload = Buffer.from(text, 'utf8');
  const length = payload.length;
  let header;

  if (length <= 125) {
    header = Buffer.from([0x81, length]);
  } else if (length <= 65535) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }

  try {
    socket.write(Buffer.concat([header, payload]));
  } catch (err) {
    console.warn('Socket write error:', err.message);
  }
}

const server = http.createServer((req, res) => {
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify({
    status: 'ok',
    service: 'ishika-local-signaling-server',
    port: PORT,
    activeRooms: rooms.size,
    timestamp: new Date().toISOString(),
  }, null, 2));
});

server.on('upgrade', (req, socket, head) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const roomId = reqUrl.searchParams.get('session') || reqUrl.searchParams.get('room');
  if (!roomId || roomId === 'default-room' || !ROOM_ID_REGEX.test(roomId)) {
    socket.write('HTTP/1.1 400 Bad Request\r\nContent-Type: text/plain\r\n\r\nInvalid or missing session room ID\r\n');
    socket.destroy();
    return;
  }
  const clientId = reqUrl.searchParams.get('client') || crypto.randomUUID();

  const secKey = req.headers['sec-websocket-key'];
  if (!secKey) {
    socket.destroy();
    return;
  }

  // Handshake response
  const acceptKey = crypto.createHash('sha1').update(secKey + WS_GUID).digest('base64');
  const responseHeaders = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey}`,
    '\r\n',
  ].join('\r\n');

  socket.write(responseHeaders);

  const room = getOrCreateRoom(roomId);
  const peerRecord = { socket, clientId, role: 'viewer' };
  room.peers.add(peerRecord);

  console.log(`\x1b[32m[+]\x1b[0m Client \x1b[36m${clientId.substring(0, 8)}\x1b[0m joined room: \x1b[33m${roomId}\x1b[0m (Total: ${room.peers.size})`);

  // Immediately inform the joining client of current room state (e.g. who is host)
  sendWsFrame(socket, JSON.stringify({
    type: 'room_state',
    senderId: 'server',
    timestamp: Date.now(),
    payload: {
      hasHost: Boolean(room.hostClientId),
      hostClientId: room.hostClientId,
      peerCount: room.peers.size,
    },
  }));

  // Notify others
  broadcastToRoom(roomId, JSON.stringify({
    type: 'peer_joined',
    senderId: clientId,
    timestamp: Date.now(),
    payload: { peerCount: room.peers.size, hasHost: Boolean(room.hostClientId) },
  }), socket);

  let buffer = Buffer.alloc(0);

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);

    while (buffer.length >= 2) {
      const firstByte = buffer[0];
      const secondByte = buffer[1];
      const isMasked = (secondByte & 0x80) !== 0;
      let payloadLength = secondByte & 0x7f;
      let offset = 2;

      if (payloadLength === 126) {
        if (buffer.length < 4) break;
        payloadLength = buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLength === 127) {
        if (buffer.length < 10) break;
        payloadLength = Number(buffer.readBigUInt64BE(2));
        offset = 10;
      }

      const maskLength = isMasked ? 4 : 0;
      const totalFrameLen = offset + maskLength + payloadLength;
      if (buffer.length < totalFrameLen) break;

      const maskingKey = isMasked ? buffer.subarray(offset, offset + 4) : null;
      const rawData = buffer.subarray(offset + maskLength, totalFrameLen);

      if (isMasked && maskingKey) {
        for (let i = 0; i < rawData.length; i++) {
          rawData[i] ^= maskingKey[i % 4];
        }
      }

      const opcode = firstByte & 0x0f;
      if (opcode === 0x08) {
        // Connection Close frame
        socket.destroy();
        break;
      } else if (opcode === 0x01) {
        // Text frame
        if (rawData.length > MAX_MESSAGE_BYTES) {
          console.warn(`\x1b[31m[!]\x1b[0m Dropped oversized message (${rawData.length} bytes) from ${clientId.substring(0, 8)}`);
          buffer = buffer.subarray(totalFrameLen);
          continue;
        }
        const text = rawData.toString('utf8');
        try {
          const parsed = JSON.parse(text);
          if (!parsed || typeof parsed !== 'object' || !ALLOWED_TYPES.has(parsed.type)) {
            buffer = buffer.subarray(totalFrameLen);
            continue;
          }
          // Strict Single-Host Enforcement
          if (parsed.type === 'peer_joined') {
            const requestedRole = parsed.payload?.role;
            if (requestedRole === 'host') {
              if (!room.hostClientId || room.hostClientId === clientId) {
                room.hostClientId = clientId;
                peerRecord.role = 'host';
                console.log(`\x1b[32m[👑]\x1b[0m Client \x1b[36m${clientId.substring(0, 8)}\x1b[0m established as Lab Host for room \x1b[33m${roomId}\x1b[0m`);
                sendWsFrame(socket, JSON.stringify({
                  type: 'role_assigned',
                  senderId: 'server',
                  timestamp: Date.now(),
                  payload: { role: 'host' },
                }));
              } else {
                // Another host already registered for this room! Force viewer role.
                peerRecord.role = 'viewer';
                console.warn(`\x1b[33m[!]\x1b[0m Client \x1b[36m${clientId.substring(0, 8)}\x1b[0m requested Host, but \x1b[36m${room.hostClientId.substring(0, 8)}\x1b[0m is already Host. Downgrading to Remote Pathologist.`);
                sendWsFrame(socket, JSON.stringify({
                  type: 'role_assigned',
                  senderId: 'server',
                  timestamp: Date.now(),
                  payload: {
                    role: 'viewer',
                    reason: 'host_already_exists',
                    currentHostId: room.hostClientId,
                  },
                }));
                buffer = buffer.subarray(totalFrameLen);
                continue;
              }
            } else {
              peerRecord.role = 'viewer';
            }
          }

          if (parsed.type === 'stage_sync') {
            const p = parsed.payload;
            if (
              !p ||
              typeof p !== 'object' ||
              typeof p.x !== 'number' ||
              !Number.isFinite(p.x) ||
              typeof p.y !== 'number' ||
              !Number.isFinite(p.y) ||
              typeof p.z !== 'number' ||
              !Number.isFinite(p.z) ||
              !VALID_OBJECTIVES.has(p.objective)
            ) {
              buffer = buffer.subarray(totalFrameLen);
              continue;
            }
            parsed.payload = {
              x: Math.max(-25000, Math.min(25000, p.x)),
              y: Math.max(-12500, Math.min(12500, p.y)),
              z: Math.max(-50, Math.min(50, p.z)),
              objective: p.objective,
            };
          }
          parsed.senderId = clientId;
          const sanitizedText = JSON.stringify(parsed);
          console.log(`\x1b[34m[↔]\x1b[0m \x1b[33m${roomId}\x1b[0m | \x1b[36m${clientId.substring(0, 8)}\x1b[0m -> \x1b[32m${parsed.type}\x1b[0m`);
          broadcastToRoom(roomId, sanitizedText, socket, parsed.targetId);
        } catch (_) {
          // Drop malformed non-JSON frames
        }
      }

      buffer = buffer.subarray(totalFrameLen);
    }
  });

  const cleanup = () => {
    room.peers.delete(peerRecord);
    if (room.hostClientId === clientId) {
      room.hostClientId = null;
      console.log(`\x1b[33m[!]\x1b[0m Lab Host left room: \x1b[33m${roomId}\x1b[0m. Room host slot is now open.`);
    }
    if (room.peers.size === 0) {
      rooms.delete(roomId);
    }
    console.log(`\x1b[31m[-]\x1b[0m Client \x1b[36m${clientId.substring(0, 8)}\x1b[0m left room: \x1b[33m${roomId}\x1b[0m (Remaining: ${room.peers.size})`);
    broadcastToRoom(roomId, JSON.stringify({
      type: 'peer_left',
      senderId: clientId,
      timestamp: Date.now(),
      payload: { peerCount: room.peers.size, hasHost: Boolean(room.hostClientId) },
    }), socket);
  };

  socket.on('close', cleanup);
  socket.on('error', cleanup);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n\x1b[1m\x1b[36m🔬 Ishika Local WebRTC Signaling Server\x1b[0m');
  console.log(`🚀 Listening on: \x1b[1m\x1b[32mws://localhost:${PORT}\x1b[0m`);
  console.log(`🌐 Ready to connect remote browsers across localhost or local network.`);
  console.log(`Press \x1b[1mCtrl+C\x1b[0m to stop server.\n`);
});
