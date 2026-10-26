import { useEffect, useRef, useState, useCallback } from 'react';
import { WebRtcPeerManager, DEFAULT_RTC_CONFIG, WebRtcConnectionState } from './peer';
import { SignallingClient, SignallingMessage } from './signalling';

export interface TeleconsultationStageState {
  x: number;
  y: number;
  z: number;
  objective: 4 | 10 | 20 | 40;
}

const STAGE_LIMITS = {
  minX: -25000,
  maxX: 25000,
  minY: -12500,
  maxY: 12500,
  minZ: -50,
  maxZ: 50,
} as const;

const VALID_OBJECTIVES = [4, 10, 20, 40] as const;

export function sanitizeTeleconsultationStage(input: unknown): TeleconsultationStageState | null {
  if (!input || typeof input !== 'object') return null;
  const candidate = input as Record<string, unknown>;
  if (
    typeof candidate.x !== 'number' ||
    !Number.isFinite(candidate.x) ||
    typeof candidate.y !== 'number' ||
    !Number.isFinite(candidate.y) ||
    typeof candidate.z !== 'number' ||
    !Number.isFinite(candidate.z) ||
    typeof candidate.objective !== 'number' ||
    !VALID_OBJECTIVES.includes(candidate.objective as 4 | 10 | 20 | 40)
  ) {
    return null;
  }

  return {
    x: Math.max(STAGE_LIMITS.minX, Math.min(STAGE_LIMITS.maxX, candidate.x)),
    y: Math.max(STAGE_LIMITS.minY, Math.min(STAGE_LIMITS.maxY, candidate.y)),
    z: Math.max(STAGE_LIMITS.minZ, Math.min(STAGE_LIMITS.maxZ, candidate.z)),
    objective: candidate.objective as 4 | 10 | 20 | 40,
  };
}

export interface TeleconsultationPin {
  id: string;
  stageX: number;
  stageY: number;
  color: string;
  label?: string;
}

export type TeleconsultationSpecimen = 'synthetic' | 'clinical';

export interface UseTeleconsultationOptions {
  roomId: string;
  role: 'host' | 'viewer';
  signalingUrl?: string;
  localStream?: MediaStream | null;
  specimen?: TeleconsultationSpecimen;
  onRemoteStream?: (stream: MediaStream) => void;
  onRemoteStageSync?: (stage: TeleconsultationStageState) => void;
  onRemotePinSync?: (pin: TeleconsultationPin) => void;
  onRemoteSpecimenSync?: (specimen: TeleconsultationSpecimen) => void;
  onRoleAssigned?: (assignedRole: 'host' | 'viewer', reason?: string) => void;
  onRoomState?: (state: { hasHost: boolean; hostClientId: string | null; peerCount: number }) => void;
}

export interface UseTeleconsultationResult {
  peerState: WebRtcConnectionState;
  signalingConnected: boolean;
  remoteStream: MediaStream | null;
  clientId: string;
  remoteControlEnabled: boolean;
  emergencyStop: boolean;
  setRemoteControlEnabled: (enabled: boolean) => void;
  setEmergencyStop: (locked: boolean) => void;
  sendStageSync: (stage: TeleconsultationStageState) => void;
  sendPinSync: (pin: TeleconsultationPin) => void;
  sendSpecimenSync: (specimen: TeleconsultationSpecimen) => void;
  reconnect: () => void;
}

export function useTeleconsultation(options: UseTeleconsultationOptions): UseTeleconsultationResult {
  const {
    roomId,
    role,
    signalingUrl,
    localStream = null,
    specimen = 'clinical',
    onRemoteStream,
    onRemoteStageSync,
    onRemotePinSync,
    onRemoteSpecimenSync,
    onRoleAssigned,
    onRoomState,
  } = options;
  const [peerState, setPeerState] = useState<WebRtcConnectionState>('idle');
  const [signalingConnected, setSignalingConnected] = useState<boolean>(false);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [remoteControlEnabled, setRemoteControlEnabledState] = useState<boolean>(true);
  const [emergencyStop, setEmergencyStopState] = useState<boolean>(false);

  const specimenRef = useRef<TeleconsultationSpecimen>(specimen);
  specimenRef.current = specimen;

  const remoteControlRef = useRef<boolean>(remoteControlEnabled);
  remoteControlRef.current = remoteControlEnabled;

  const emergencyStopRef = useRef<boolean>(emergencyStop);
  emergencyStopRef.current = emergencyStop;

  const clientIdRef = useRef<string>(`client_${Math.random().toString(36).substring(2, 9)}`);
  // Viewer uses single peerManager connected to Host; Host uses hostViewersRef map to broadcast to multiple remote viewers
  const peerManagerRef = useRef<WebRtcPeerManager | null>(null);
  const hostViewersRef = useRef<Map<string, WebRtcPeerManager>>(new Map());
  const signallingClientRef = useRef<SignallingClient | null>(null);
  const pendingPeersRef = useRef<Set<string>>(new Set());

  const onRemoteStreamRef = useRef(onRemoteStream);
  onRemoteStreamRef.current = onRemoteStream;

  const onRemoteStageSyncRef = useRef(onRemoteStageSync);
  onRemoteStageSyncRef.current = onRemoteStageSync;

  const onRemotePinSyncRef = useRef(onRemotePinSync);
  onRemotePinSyncRef.current = onRemotePinSync;

  const onRemoteSpecimenSyncRef = useRef(onRemoteSpecimenSync);
  onRemoteSpecimenSyncRef.current = onRemoteSpecimenSync;

  const onRoleAssignedRef = useRef(onRoleAssigned);
  onRoleAssignedRef.current = onRoleAssigned;

  const onRoomStateRef = useRef(onRoomState);
  onRoomStateRef.current = onRoomState;

  // Initialize or re-initialize WebRTC Peer & Signaling Client
  const setupConnection = useCallback(() => {
    // 1. Teardown existing instances
    if (peerManagerRef.current) {
      peerManagerRef.current.close();
      peerManagerRef.current = null;
    }
    for (const p of hostViewersRef.current.values()) {
      p.close();
    }
    hostViewersRef.current.clear();

    if (signallingClientRef.current) {
      signallingClientRef.current.close();
      signallingClientRef.current = null;
    }

    const clientId = clientIdRef.current;

    // Helper: Create an isolated WebRtcPeerManager for a specific viewer (Host mode)
    const createHostPeerForViewer = (viewerId: string): WebRtcPeerManager => {
      const existing = hostViewersRef.current.get(viewerId);
      if (existing) {
        existing.close();
      }

      const pm = new WebRtcPeerManager({
        rtcConfig: DEFAULT_RTC_CONFIG,
        onStateChange: (st) => {
          setPeerState(st);
        },
        onIceCandidate: (candidate) => {
          signallingClientRef.current?.send('candidate', candidate, viewerId);
        },
      });

      if (localStreamRef.current) {
        pm.addLocalStream(localStreamRef.current);
      }

      hostViewersRef.current.set(viewerId, pm);
      return pm;
    };

    // 2. In Viewer mode, initialize single WebRtcPeerManager to consume host stream
    if (role === 'viewer') {
      const peerManager = new WebRtcPeerManager({
        rtcConfig: DEFAULT_RTC_CONFIG,
        onStateChange: (st) => setPeerState(st),
        onIceCandidate: (candidate) => {
          signallingClientRef.current?.send('candidate', candidate);
        },
        onRemoteStream: (stream) => {
          setRemoteStream(stream);
          onRemoteStreamRef.current?.(stream);
        },
      });
      peerManagerRef.current = peerManager;
    }

    // 3. Initialize SignallingClient
    const signalling = new SignallingClient({
      sessionId: roomId,
      clientId,
      websocketUrl: signalingUrl,
      onConnect: () => {
        setSignalingConnected(true);
        // Announce presence and requested role in room
        signalling.send('peer_joined', { role, clientId });
      },
      onDisconnect: () => {
        setSignalingConnected(false);
      },
      onMessage: async (msg: SignallingMessage) => {
        try {
          switch (msg.type) {
            case 'role_assigned':
              if (msg.payload && msg.payload.role) {
                onRoleAssignedRef.current?.(msg.payload.role, msg.payload.reason);
              }
              break;

            case 'room_state':
              if (msg.payload) {
                onRoomStateRef.current?.(msg.payload);
              }
              break;

            case 'peer_joined':
            case 'request_offer':
              if (msg.senderId === clientId) break;
              // Host handles newly joined viewer
              if (role === 'host') {
                const targetViewerId = msg.senderId;
                // Synchronize current control, E-Stop, and specimen slide state with newly joined peer
                signalling.send('control_sync', { remoteControlEnabled: remoteControlRef.current }, targetViewerId);
                signalling.send('estop_sync', { emergencyStop: emergencyStopRef.current }, targetViewerId);
                signalling.send('specimen_sync', { specimen: specimenRef.current }, targetViewerId);

                const pm = createHostPeerForViewer(targetViewerId);
                if (localStreamRef.current) {
                  const offer = await pm.createOffer();
                  signalling.send('offer', offer, targetViewerId);
                } else {
                  pendingPeersRef.current.add(targetViewerId);
                }
              } else if (role === 'viewer') {
                // When viewer enters or receives announcement, request offer from host
                signalling.send('request_offer', { role: 'viewer', clientId }, msg.senderId);
              }
              break;

            case 'peer_left':
              if (role === 'host') {
                const departingViewer = hostViewersRef.current.get(msg.senderId);
                if (departingViewer) {
                  departingViewer.close();
                  hostViewersRef.current.delete(msg.senderId);
                }
                pendingPeersRef.current.delete(msg.senderId);
              }
              break;

            case 'offer':
              // Viewer responds with answer
              if (role === 'viewer' && peerManagerRef.current) {
                const answer = await peerManagerRef.current.handleOffer(msg.payload);
                signalling.send('answer', answer, msg.senderId);
              }
              break;

            case 'answer':
              // Host applies remote answer from the specific viewer
              if (role === 'host') {
                const pm = hostViewersRef.current.get(msg.senderId);
                if (pm) {
                  await pm.handleAnswer(msg.payload);
                }
              }
              break;

            case 'candidate':
              if (role === 'host') {
                const pm = hostViewersRef.current.get(msg.senderId);
                if (pm && msg.payload) {
                  await pm.addIceCandidate(msg.payload);
                }
              } else if (role === 'viewer' && peerManagerRef.current) {
                if (msg.payload) {
                  await peerManagerRef.current.addIceCandidate(msg.payload);
                }
              }
              break;

            case 'stage_sync':
              if (emergencyStopRef.current) break;
              // If host has locked remote stage control, ignore remote viewer actuation
              if (role === 'host' && !remoteControlRef.current) break;
              if (msg.payload) {
                const sanitized = sanitizeTeleconsultationStage(msg.payload);
                if (sanitized) {
                  onRemoteStageSyncRef.current?.(sanitized);
                }
              }
              break;

            case 'control_sync':
              if (msg.payload && typeof msg.payload.remoteControlEnabled === 'boolean') {
                setRemoteControlEnabledState(msg.payload.remoteControlEnabled);
              }
              break;

            case 'estop_sync':
              if (msg.payload && typeof msg.payload.emergencyStop === 'boolean') {
                setEmergencyStopState(msg.payload.emergencyStop);
              }
              break;

            case 'specimen_sync':
              if (
                role === 'viewer' &&
                msg.payload &&
                (msg.payload.specimen === 'synthetic' || msg.payload.specimen === 'clinical')
              ) {
                onRemoteSpecimenSyncRef.current?.(msg.payload.specimen);
              }
              break;

            case 'pin_sync':
              if (msg.payload) {
                onRemotePinSyncRef.current?.(msg.payload);
              }
              break;
          }
        } catch (err) {
          console.warn('Signaling message handle error:', err);
        }
      },
    });

    signallingClientRef.current = signalling;
  }, [roomId, role, signalingUrl]);

  // Keep localStream ref fresh
  const localStreamRef = useRef<MediaStream | null>(localStream);
  localStreamRef.current = localStream;

  // Dynamically attach local stream tracks to all active viewer peers on Host
  useEffect(() => {
    if (role === 'host' && localStream) {
      for (const pm of hostViewersRef.current.values()) {
        pm.addLocalStream(localStream);
      }

      // Flush any peers that joined before localStream was initialized
      if (pendingPeersRef.current.size > 0 && signallingClientRef.current) {
        pendingPeersRef.current.forEach((peerId) => {
          const pm = hostViewersRef.current.get(peerId);
          if (pm) {
            pm.createOffer()
              .then((offer) => signallingClientRef.current?.send('offer', offer, peerId))
              .catch((err) => console.warn('Failed to send offer to pending peer:', err));
          }
        });
        pendingPeersRef.current.clear();
      }
    }
  }, [role, localStream]);

  useEffect(() => {
    setupConnection();

    return () => {
      if (peerManagerRef.current) {
        peerManagerRef.current.close();
        peerManagerRef.current = null;
      }
      for (const p of hostViewersRef.current.values()) {
        p.close();
      }
      hostViewersRef.current.clear();
      if (signallingClientRef.current) {
        signallingClientRef.current.close();
        signallingClientRef.current = null;
      }
    };
  }, [setupConnection]);

  // Toggle remote viewer stage actuation permission (Single-Driver Arbitration)
  const setRemoteControlEnabled = useCallback((enabled: boolean) => {
    const next = Boolean(enabled);
    setRemoteControlEnabledState(next);
    remoteControlRef.current = next;
    signallingClientRef.current?.send('control_sync', { remoteControlEnabled: next });
  }, []);

  // Toggle Emergency Stop (E-Stop) hardware safety lock
  const setEmergencyStop = useCallback((locked: boolean) => {
    const next = Boolean(locked);
    setEmergencyStopState(next);
    emergencyStopRef.current = next;
    signallingClientRef.current?.send('estop_sync', { emergencyStop: next });
  }, []);

  // Dispatch stage synchronization to remote peer
  const sendStageSync = useCallback((stage: TeleconsultationStageState) => {
    if (emergencyStopRef.current) return;
    if (role === 'viewer' && !remoteControlRef.current) return;
    const sanitized = sanitizeTeleconsultationStage(stage);
    if (sanitized) {
      signallingClientRef.current?.send('stage_sync', sanitized);
    }
  }, [role]);

  // Dispatch pathologist pin synchronization to remote peer
  const sendPinSync = useCallback((pin: TeleconsultationPin) => {
    signallingClientRef.current?.send('pin_sync', pin);
  }, []);

  // Dispatch specimen synchronization from host to remote viewers
  const sendSpecimenSync = useCallback((newSpecimen: TeleconsultationSpecimen) => {
    if (role !== 'host') return;
    if (newSpecimen === 'synthetic' || newSpecimen === 'clinical') {
      specimenRef.current = newSpecimen;
      signallingClientRef.current?.send('specimen_sync', { specimen: newSpecimen });
    }
  }, [role]);

  return {
    peerState,
    signalingConnected,
    remoteStream,
    clientId: clientIdRef.current,
    remoteControlEnabled,
    emergencyStop,
    setRemoteControlEnabled,
    setEmergencyStop,
    sendStageSync,
    sendPinSync,
    sendSpecimenSync,
    reconnect: setupConnection,
  };
}
