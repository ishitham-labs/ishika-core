export type SignallingType =
  | 'offer'
  | 'answer'
  | 'candidate'
  | 'stage_sync'
  | 'pin_sync'
  | 'control_sync'
  | 'estop_sync'
  | 'specimen_sync'
  | 'role_assigned'
  | 'room_state'
  | 'peer_joined'
  | 'peer_left'
  | 'request_offer'
  | 'ping'
  | 'pong';

export const ALLOWED_SIGNALLING_TYPES: readonly SignallingType[] = [
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
];

export const MAX_SIGNALLING_MESSAGE_BYTES = 16 * 1024; // 16 KB ceiling
export const ROOM_ID_REGEX = /^[a-zA-Z0-9_-]{3,64}$/;

/**
 * Validates that a session/room identifier is explicitly provided, matches safe
 * alphanumeric/hyphen/underscore syntax (3..64 chars), and is not 'default-room'.
 */
export function isValidRoomId(roomId: unknown): roomId is string {
  return (
    typeof roomId === 'string' &&
    roomId !== 'default-room' &&
    ROOM_ID_REGEX.test(roomId)
  );
}

/**
 * Generates a unique, cryptographically random room identifier when none is provided.
 */
export function generateRoomId(prefix: string = 'case'): string {
  const cleanPrefix = prefix.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) || 'case';
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(4);
    crypto.getRandomValues(bytes);
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${cleanPrefix}-${hex}`;
  }
  return `${cleanPrefix}-${Math.random().toString(36).substring(2, 10)}`;
}

/**
 * Validates raw incoming signalling JSON or object against the strict message envelope schema
 * and enforces the 16 KB message size ceiling.
 */
export function validateSignallingMessage(rawOrObj: unknown): SignallingMessage | null {
  let parsed: unknown = rawOrObj;

  if (typeof rawOrObj === 'string') {
    if (rawOrObj.length > MAX_SIGNALLING_MESSAGE_BYTES) {
      return null;
    }
    try {
      parsed = JSON.parse(rawOrObj);
    } catch {
      return null;
    }
  } else if (rawOrObj && typeof rawOrObj === 'object') {
    try {
      const serialized = JSON.stringify(rawOrObj);
      if (serialized.length > MAX_SIGNALLING_MESSAGE_BYTES) {
        return null;
      }
    } catch {
      return null;
    }
  } else {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;
  const msg = parsed as Record<string, unknown>;

  if (
    typeof msg.type !== 'string' ||
    !ALLOWED_SIGNALLING_TYPES.includes(msg.type as SignallingType)
  ) {
    return null;
  }

  if (typeof msg.senderId !== 'string' || msg.senderId.length === 0 || msg.senderId.length > 64) {
    return null;
  }

  if (msg.targetId !== undefined && (typeof msg.targetId !== 'string' || msg.targetId.length > 64)) {
    return null;
  }

  if (typeof msg.timestamp !== 'number' || !Number.isFinite(msg.timestamp)) {
    return null;
  }

  return {
    type: msg.type as SignallingType,
    senderId: msg.senderId,
    targetId: msg.targetId as string | undefined,
    payload: msg.payload,
    timestamp: msg.timestamp,
  };
}

export interface SignallingMessage {
  type: SignallingType;
  senderId: string;
  targetId?: string;
  payload: any;
  timestamp: number;
}

export interface SignallingClientOptions {
  sessionId: string;
  clientId: string;
  websocketUrl?: string;
  onMessage?: (msg: SignallingMessage) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
}

export class SignallingClient {
  private sessionId: string;
  private clientId: string;
  private ws: WebSocket | null = null;
  private channel: BroadcastChannel | null = null;
  private options: SignallingClientOptions;
  private seenMessages = new Set<string>();

  constructor(options: SignallingClientOptions) {
    this.options = options;
    this.sessionId = isValidRoomId(options.sessionId)
      ? options.sessionId
      : generateRoomId('session');
    this.clientId = options.clientId;

    // 1. Always initialize in-browser BroadcastChannel for zero-server multi-tab signalling
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this.channel = new BroadcastChannel(`ishika_signalling_${this.sessionId}`);
        this.channel.onmessage = (event) => {
          const validated = validateSignallingMessage(event.data);
          if (validated) {
            this.handleIncoming(validated);
          }
        };
      } catch (err) {
        console.warn('BroadcastChannel not supported:', err);
      }
    }

    // 2. If WebSocket URL is provided, connect to external signalling server (e.g. Cloudflare Worker)
    if (options.websocketUrl && typeof WebSocket !== 'undefined') {
      this.connectWebSocket(options.websocketUrl);
    } else {
      // Local tab-to-tab connected immediately
      this.options.onConnect?.();
    }
  }

  getSessionId(): string {
    return this.sessionId;
  }

  private handleIncoming(msg: SignallingMessage): void {
    if (!msg || msg.senderId === this.clientId) return;
    if (msg.targetId && msg.targetId !== this.clientId) return;

    // Deduplicate identical messages arriving via both BroadcastChannel and WebSocket
    const msgKey = `${msg.type}_${msg.senderId}_${msg.timestamp}_${msg.targetId || ''}`;
    if (this.seenMessages.has(msgKey)) return;
    this.seenMessages.add(msgKey);
    if (this.seenMessages.size > 200) {
      const oldest = Array.from(this.seenMessages).slice(0, 50);
      oldest.forEach((k) => this.seenMessages.delete(k));
    }

    this.options.onMessage?.(msg);
  }

  private connectWebSocket(url: string): void {
    try {
      const safeSession = encodeURIComponent(this.sessionId);
      const safeClient = encodeURIComponent(this.clientId);
      this.ws = new WebSocket(`${url}?session=${safeSession}&client=${safeClient}`);

      this.ws.onopen = () => {
        this.options.onConnect?.();
      };

      this.ws.onmessage = (event) => {
        const validated = validateSignallingMessage(event.data);
        if (validated) {
          this.handleIncoming(validated);
        } else {
          console.warn('Rejected invalid or oversized incoming signalling message');
        }
      };

      this.ws.onclose = () => {
        this.options.onDisconnect?.();
      };

      this.ws.onerror = (err) => {
        console.warn('Signalling WebSocket error:', err);
      };
    } catch (err) {
      console.warn('Could not establish WebSocket connection:', err);
    }
  }

  send(type: SignallingType, payload: any, targetId?: string): boolean {
    const msg: SignallingMessage = {
      type,
      senderId: this.clientId,
      targetId,
      payload,
      timestamp: Date.now(),
    };

    const serialized = JSON.stringify(msg);
    if (serialized.length > MAX_SIGNALLING_MESSAGE_BYTES) {
      console.warn(`Dropped outbound signalling message exceeding ${MAX_SIGNALLING_MESSAGE_BYTES} bytes`);
      return false;
    }

    // Broadcast across local browser tabs
    if (this.channel) {
      try {
        this.channel.postMessage(msg);
      } catch (err) {
        console.warn('BroadcastChannel send error:', err);
      }
    }

    // Send over WebSocket if connected
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(serialized);
    }
    return true;
  }

  close(): void {
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.options.onDisconnect?.();
  }
}
