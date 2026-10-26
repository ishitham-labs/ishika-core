import test from 'node:test';
import assert from 'node:assert/strict';
import { WebRtcPeerManager, DEFAULT_ICE_SERVERS, WebRtcConnectionState } from '../src/peer';
import {
  SignallingClient,
  SignallingMessage,
  MAX_SIGNALLING_MESSAGE_BYTES,
  isValidRoomId,
  generateRoomId,
  validateSignallingMessage,
} from '../src/signalling';
import { sanitizeTeleconsultationStage } from '../src/useTeleconsultation';

test('DEFAULT_ICE_SERVERS configures Google STUN servers', () => {
  assert(DEFAULT_ICE_SERVERS.length >= 2);
  const stunUrls = DEFAULT_ICE_SERVERS.map((s) => (typeof s.urls === 'string' ? s.urls : s.urls[0]));
  assert(stunUrls.some((u) => u.includes('stun.l.google.com')));
});

test('WebRtcPeerManager initializes in idle state', () => {
  const states: WebRtcConnectionState[] = [];
  const peer = new WebRtcPeerManager({
    onStateChange: (st) => states.push(st),
  });

  assert.equal(peer.getState(), 'idle');
  peer.close();
  assert.equal(peer.getState(), 'closed');
  assert(states.includes('closed'));
});

test('SignallingClient handles message construction and closure', () => {
  let receivedMessage: SignallingMessage | null = null;

  const client = new SignallingClient({
    sessionId: 'test-session-123',
    clientId: 'pathologist-client-1',
    onMessage: (msg) => {
      receivedMessage = msg;
    },
  });

  // Test sending broadcast message
  const ok = client.send('ping', { test: true });
  assert.equal(ok, true);
  assert.equal(receivedMessage, null);

  // Oversized message (> 16 KB) is dropped
  const oversized = 'x'.repeat(MAX_SIGNALLING_MESSAGE_BYTES + 100);
  assert.equal(client.send('ping', { data: oversized }), false);

  assert.doesNotThrow(() => {
    client.close();
  });
});

test('isValidRoomId and generateRoomId enforce strict session room admission rules', () => {
  assert.equal(isValidRoomId('case-402-biopsy'), true);
  assert.equal(isValidRoomId('room_123'), true);

  // Rejects default-room, empty, short, long, or special characters
  assert.equal(isValidRoomId('default-room'), false);
  assert.equal(isValidRoomId(''), false);
  assert.equal(isValidRoomId('ab'), false);
  assert.equal(isValidRoomId('a'.repeat(65)), false);
  assert.equal(isValidRoomId('room/../../etc'), false);
  assert.equal(isValidRoomId(null), false);

  const generated = generateRoomId('biopsy');
  assert.equal(isValidRoomId(generated), true);
  assert(generated.startsWith('biopsy-'));
});

test('validateSignallingMessage enforces 16KB size ceiling and strict envelope schema', () => {
  const validRaw = JSON.stringify({
    type: 'stage_sync',
    senderId: 'host_abc123',
    payload: { x: 100, y: -200, z: 0, objective: 20 },
    timestamp: Date.now(),
  });
  const parsed = validateSignallingMessage(validRaw);
  assert(parsed !== null);
  assert.equal(parsed?.type, 'stage_sync');
  assert.equal(parsed?.senderId, 'host_abc123');

  // Validates specimen_sync message type
  const specimenMsg = validateSignallingMessage({
    type: 'specimen_sync',
    senderId: 'host_abc123',
    payload: { specimen: 'clinical' },
    timestamp: Date.now(),
  });
  assert(specimenMsg !== null);
  assert.equal(specimenMsg?.type, 'specimen_sync');

  // Rejects oversized messages (> 16 KB)
  const hugeRaw = JSON.stringify({
    type: 'ping',
    senderId: 'host_1',
    payload: 'A'.repeat(MAX_SIGNALLING_MESSAGE_BYTES + 1),
    timestamp: Date.now(),
  });
  assert.equal(validateSignallingMessage(hugeRaw), null);

  // Rejects unknown message types or missing senderId
  assert.equal(
    validateSignallingMessage(
      JSON.stringify({ type: 'exec_shell', senderId: 'attacker', timestamp: Date.now() })
    ),
    null
  );
  assert.equal(
    validateSignallingMessage(
      JSON.stringify({ type: 'ping', senderId: '', timestamp: Date.now() })
    ),
    null
  );
});

test('sanitizeTeleconsultationStage clamps coordinates and rejects invalid objectives', () => {
  const valid = sanitizeTeleconsultationStage({ x: 50000, y: -50000, z: 120, objective: 40 });
  assert.deepEqual(valid, { x: 25000, y: -12500, z: 50, objective: 40 });

  assert.equal(sanitizeTeleconsultationStage({ x: 0, y: 0, z: 0, objective: 100 }), null);
  assert.equal(sanitizeTeleconsultationStage({ x: NaN, y: 0, z: 0, objective: 10 }), null);
});

