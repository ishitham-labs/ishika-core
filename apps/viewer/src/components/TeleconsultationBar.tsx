import { useState } from 'react';
import type { WebRtcConnectionState } from '@ishika/streaming';

export interface TeleconsultationBarProps {
  roomId: string;
  role: 'host' | 'viewer';
  peerState: WebRtcConnectionState;
  signalingConnected: boolean;
  remoteControlEnabled: boolean;
  emergencyStop: boolean;
  hasHostInRoom?: boolean;
  peerCount?: number;
  onRoleChange: (newRole: 'host' | 'viewer') => void;
  onRoomChange: (newRoom: string) => void;
  onToggleRemoteControl: (enabled: boolean) => void;
  onToggleEmergencyStop: (locked: boolean) => void;
}

export function TeleconsultationBar({
  roomId,
  role,
  peerState,
  signalingConnected,
  remoteControlEnabled,
  emergencyStop,
  hasHostInRoom = false,
  peerCount = 1,
  onRoleChange,
  onRoomChange,
  onToggleRemoteControl,
  onToggleEmergencyStop,
}: TeleconsultationBarProps) {
  const [copied, setCopied] = useState<boolean>(false);
  const [isEditingRoom, setIsEditingRoom] = useState<boolean>(false);
  const [roomInput, setRoomInput] = useState<string>(roomId);

  const handleCopyLink = () => {
    // Generate viewer link if currently host, or host link if currently viewer
    const targetRole = role === 'host' ? 'viewer' : 'host';
    const url = new URL(window.location.href);
    url.searchParams.set('room', roomId);
    url.searchParams.set('role', targetRole);

    navigator.clipboard.writeText(url.toString()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }).catch(console.warn);
  };

  const handleSaveRoom = () => {
    if (roomInput.trim()) {
      onRoomChange(roomInput.trim());
      setIsEditingRoom(false);
    }
  };

  return (
    <div style={{
      marginBottom: '1rem',
      background: '#0f172a',
      border: '1px solid #1e293b',
      borderRadius: '10px',
      padding: '0.6rem 1rem',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: '0.75rem',
      fontSize: '0.82rem',
    }}>
      {/* Left: Role & Room identification */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <span style={{ color: '#94a3b8', fontWeight: '600' }}>Mode:</span>
          <div style={{ display: 'flex', background: '#020617', borderRadius: '6px', padding: '2px', border: '1px solid #1e293b' }}>
            <button
              onClick={() => {
                if (role !== 'host' && hasHostInRoom) {
                  alert('This consultation room already has an active Lab Host. Only one host is allowed per room; additional participants join as Remote Pathologists.');
                  return;
                }
                onRoleChange('host');
              }}
              disabled={role !== 'host' && hasHostInRoom}
              title={role !== 'host' && hasHostInRoom ? 'A Lab Host is already active in this room' : 'Act as Lab Microscope Host'}
              style={{
                background: role === 'host' ? '#0284c7' : 'transparent',
                color: role === 'host' ? '#ffffff' : (hasHostInRoom ? '#475569' : '#94a3b8'),
                border: 'none',
                borderRadius: '4px',
                padding: '3px 8px',
                fontSize: '0.75rem',
                fontWeight: '600',
                cursor: role !== 'host' && hasHostInRoom ? 'not-allowed' : 'pointer',
                opacity: role !== 'host' && hasHostInRoom ? 0.6 : 1,
              }}
            >
              🔬 Lab Host {role !== 'host' && hasHostInRoom && <span style={{ fontSize: '10px' }}>(Occupied)</span>}
            </button>
            <button
              onClick={() => onRoleChange('viewer')}
              style={{
                background: role === 'viewer' ? '#0284c7' : 'transparent',
                color: role === 'viewer' ? '#ffffff' : '#94a3b8',
                border: 'none',
                borderRadius: '4px',
                padding: '3px 8px',
                fontSize: '0.75rem',
                fontWeight: '600',
                cursor: 'pointer',
              }}
            >
              👥 Remote Pathologist
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <span style={{ color: '#94a3b8', fontWeight: '600' }}>Room:</span>
          {isEditingRoom ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <input
                type="text"
                value={roomInput}
                onChange={(e) => setRoomInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveRoom()}
                style={{
                  background: '#1e293b',
                  border: '1px solid #38bdf8',
                  borderRadius: '4px',
                  color: '#f8fafc',
                  padding: '2px 6px',
                  fontSize: '0.75rem',
                  fontFamily: 'monospace',
                  width: '100px',
                }}
                autoFocus
              />
              <button
                onClick={handleSaveRoom}
                style={{ background: '#0284c7', color: '#fff', border: 'none', borderRadius: '4px', padding: '2px 6px', fontSize: '11px', cursor: 'pointer' }}
              >
                Save
              </button>
            </div>
          ) : (
            <span
              onClick={() => setIsEditingRoom(true)}
              title="Click to change session room"
              style={{
                fontFamily: 'monospace',
                fontWeight: 'bold',
                color: '#38bdf8',
                background: '#1e293b',
                padding: '2px 8px',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              #{roomId} ✎
            </span>
          )}
        </div>

        {/* Signaling & P2P Peer Status Indicators */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            fontSize: '0.72rem',
            padding: '2px 8px',
            borderRadius: '9999px',
            background: signalingConnected ? 'rgba(34, 197, 94, 0.12)' : 'rgba(234, 179, 8, 0.12)',
            color: signalingConnected ? '#4ade80' : '#facc15',
            border: signalingConnected ? '1px solid rgba(34, 197, 94, 0.3)' : '1px solid rgba(234, 179, 8, 0.3)',
          }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'currentColor' }} />
            {signalingConnected ? 'Relay Active' : 'Connecting Relay...'}
          </span>

          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            fontSize: '0.72rem',
            padding: '2px 8px',
            borderRadius: '9999px',
            background: peerState === 'connected' ? 'rgba(56, 189, 248, 0.12)' : 'rgba(100, 116, 139, 0.12)',
            color: peerState === 'connected' ? '#38bdf8' : '#94a3b8',
            border: peerState === 'connected' ? '1px solid rgba(56, 189, 248, 0.3)' : '1px solid rgba(100, 116, 139, 0.3)',
          }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'currentColor' }} />
            {peerState === 'connected'
              ? (role === 'host' ? `P2P Active (${peerCount > 1 ? `${peerCount - 1} Viewers` : 'Connected'})` : 'P2P Stream Active')
              : 'Waiting for Remote Peer...'}
          </span>
        </div>
      </div>

      {/* Right: Stage Arbitration, E-Stop & 1-Click Copy Tele-Consultation Link */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        {role === 'host' ? (
          <button
            onClick={() => onToggleRemoteControl(!remoteControlEnabled)}
            title="Single-Driver Arbitration: Allow or lock remote viewer stage movements"
            style={{
              background: remoteControlEnabled ? 'rgba(56, 189, 248, 0.12)' : 'rgba(245, 158, 11, 0.15)',
              color: remoteControlEnabled ? '#38bdf8' : '#fbbf24',
              border: remoteControlEnabled ? '1px solid rgba(56, 189, 248, 0.35)' : '1px solid rgba(245, 158, 11, 0.4)',
              borderRadius: '6px',
              padding: '4px 10px',
              fontSize: '0.75rem',
              fontWeight: '600',
              cursor: 'pointer',
            }}
          >
            {remoteControlEnabled ? '🔓 Remote Stage: Allowed' : '🔒 Remote Stage: Host Only'}
          </button>
        ) : (
          <span
            title="Host stage control arbitration status"
            style={{
              background: remoteControlEnabled ? 'rgba(56, 189, 248, 0.1)' : 'rgba(245, 158, 11, 0.15)',
              color: remoteControlEnabled ? '#38bdf8' : '#fbbf24',
              border: remoteControlEnabled ? '1px solid rgba(56, 189, 248, 0.25)' : '1px solid rgba(245, 158, 11, 0.35)',
              borderRadius: '6px',
              padding: '4px 10px',
              fontSize: '0.73rem',
              fontWeight: '600',
            }}
          >
            {remoteControlEnabled ? '🕹️ Stage Control: Active' : '🔒 Stage Locked by Host'}
          </span>
        )}

        <button
          onClick={() => onToggleEmergencyStop(!emergencyStop)}
          title="Hardware Safety Lock: Immediately freeze all stage motors and remote actuation"
          style={{
            background: emergencyStop ? '#dc2626' : 'rgba(239, 68, 68, 0.14)',
            color: emergencyStop ? '#ffffff' : '#f87171',
            border: emergencyStop ? '1px solid #ef4444' : '1px solid rgba(239, 68, 68, 0.4)',
            borderRadius: '6px',
            padding: '4px 10px',
            fontSize: '0.75rem',
            fontWeight: '700',
            cursor: 'pointer',
          }}
        >
          {emergencyStop ? '⚠️ E-STOP ENGAGED (Unlock)' : '🛑 E-Stop'}
        </button>

        <button
          onClick={handleCopyLink}
          style={{
            background: copied ? '#15803d' : '#0284c7',
            color: '#ffffff',
            border: 'none',
            borderRadius: '6px',
            padding: '5px 12px',
            fontSize: '0.78rem',
            fontWeight: '600',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            transition: 'background 0.2s',
          }}
        >
          <span>{copied ? '✓ Link Copied!' : '🔗 Share Tele-Consultation'}</span>
        </button>
      </div>
    </div>
  );
}
