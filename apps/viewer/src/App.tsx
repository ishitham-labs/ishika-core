import { useState } from 'react';
import { VirtualMicroscope, DEFAULT_STAGE_BOUNDS } from '@ishika/simulator';
import { useLiveStream, useTeleconsultation, isValidRoomId, generateRoomId } from '@ishika/streaming';
import type { StageState } from '@ishika/simulator';
import { ControllerOverlay } from './components/ControllerOverlay';
import { InteractiveOverlay, PointerAnnotation } from './components/InteractiveOverlay';
import { Minimap } from './components/Minimap';
import { WsiViewer } from './components/WsiViewer';
import { WebRtcDiagnosticsModal } from './components/WebRtcDiagnosticsModal';
import { TeleconsultationBar } from './components/TeleconsultationBar';
import { FeatureTourModal } from './components/FeatureTourModal';

const TOUR_STORAGE_KEY = 'ishika_tour_completed';

const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
const paramRoom = searchParams.get('room') || searchParams.get('session');
const initialRoom = isValidRoomId(paramRoom) ? paramRoom : generateRoomId('case');
const initialRole = (searchParams.get('role') as 'host' | 'viewer') || 'host';
const initialSignaling = searchParams.get('signaling') || (
  typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'ws://localhost:8787'
    : 'wss://ishika-signaling.ishika-core.workers.dev'
);

export function App() {
  const [roomId, setRoomId] = useState<string>(initialRoom);
  const [role, setRole] = useState<'host' | 'viewer'>(initialRole);
  const [activeTab, setActiveTab] = useState<'microscope' | 'wsi'>('microscope');
  const [specimen, setSpecimen] = useState<'synthetic' | 'clinical'>('clinical');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [stageState, setStageState] = useState<StageState>({ x: 0, y: 0, z: 0, objective: 10 });
  const [snapshots, setSnapshots] = useState<string[]>([]);
  const [wsiCaptureTrigger, setWsiCaptureTrigger] = useState<number>(0);
  const [showDiagnostics, setShowDiagnostics] = useState<boolean>(false);
  const [showTour, setShowTour] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem(TOUR_STORAGE_KEY) !== 'true';
    } catch {
      return false;
    }
  });
  const [hasHostInRoom, setHasHostInRoom] = useState<boolean>(false);
  const [peerCount, setPeerCount] = useState<number>(1);
  const [annotations, setAnnotations] = useState<PointerAnnotation[]>([
    { id: '1', stageX: 40, stageY: -25, color: '#ec4899', label: 'Atypical Nuclei' },
  ]);

  // Establish WebRTC cross-browser tele-consultation session
  const {
    peerState,
    signalingConnected,
    remoteStream,
    remoteControlEnabled,
    emergencyStop,
    setRemoteControlEnabled,
    setEmergencyStop,
    sendStageSync,
    sendPinSync,
    sendSpecimenSync,
  } = useTeleconsultation({
    roomId,
    role,
    signalingUrl: initialSignaling,
    localStream: stream,
    specimen,
    onRemoteStageSync: (newStage) => {
      setStageState(newStage);
    },
    onRemotePinSync: (newPin) => {
      setAnnotations((prev) => {
        if (prev.some((p) => p.id === newPin.id)) return prev;
        return [...prev, newPin];
      });
    },
    onRemoteSpecimenSync: (remoteSpecimen) => {
      setSpecimen(remoteSpecimen);
    },
    onRoleAssigned: (assignedRole, reason) => {
      if (assignedRole !== role) {
        setRole(assignedRole);
        if (reason === 'host_already_exists') {
          console.info('A Lab Host is already active in this room. Connected as Remote Pathologist.');
        }
      }
    },
    onRoomState: (roomState) => {
      setHasHostInRoom(roomState.hasHost);
      setPeerCount(roomState.peerCount);
    },
  });

  // Use local stream for host, remote WebRTC stream for viewer
  const activeStream = role === 'viewer' ? remoteStream : stream;
  const { videoRef, isConnected, captureSnapshot } = useLiveStream({ stream: activeStream });

  const handleSnapshot = (dataUrl: string) => {
    setSnapshots((prev) => [dataUrl, ...prev].slice(0, 4));
  };

  const handleManualCapture = () => {
    if (activeTab === 'wsi') {
      setWsiCaptureTrigger((prev) => prev + 1);
      return;
    }
    const snap = captureSnapshot();
    if (snap) {
      handleSnapshot(snap);
    }
  };

  const handlePointerClick = (stageX: number, stageY: number) => {
    const newAnnotation: PointerAnnotation = {
      id: Date.now().toString(),
      stageX,
      stageY,
      color: role === 'host' ? '#38bdf8' : '#ec4899',
      label: `${role === 'host' ? 'Host' : 'Remote'} ROI #${annotations.length + 1}`,
    };
    setAnnotations((prev) => [...prev, newAnnotation]);
    sendPinSync(newAnnotation);
  };

  const handleCloseTour = () => {
    setShowTour(false);
    try {
      localStorage.setItem(TOUR_STORAGE_KEY, 'true');
    } catch {
      // Ignore localStorage permission errors
    }
  };

  const handleStartTour = () => {
    setShowTour(true);
  };

  const canActuateStage = !emergencyStop && (role === 'host' || remoteControlEnabled);

  const handleStagePan = (dxMicrons: number, dyMicrons: number) => {
    if (!canActuateStage) return;
    setStageState((prev) => {
      const next = {
        ...prev,
        x: Math.max(DEFAULT_STAGE_BOUNDS.minX, Math.min(DEFAULT_STAGE_BOUNDS.maxX, prev.x + dxMicrons)),
        y: Math.max(DEFAULT_STAGE_BOUNDS.minY, Math.min(DEFAULT_STAGE_BOUNDS.maxY, prev.y + dyMicrons)),
      };
      sendStageSync(next);
      return next;
    });
  };

  const handleMinimapNavigate = (x: number, y: number) => {
    if (!canActuateStage) return;
    setStageState((prev) => {
      const next = { ...prev, x, y };
      sendStageSync(next);
      return next;
    });
  };

  return (
    <div className="app-container">
      {/* Hidden video element for WebRTC consumer verification */}
      <video ref={videoRef} style={{ display: 'none' }} playsInline muted />

      <header className="app-header">
        <div>
          <h1 style={{ fontSize: '1.6rem', fontWeight: 'bold', margin: 0, color: '#38bdf8' }}>
            🔬 Ishika Open Core
          </h1>
          <p style={{ color: '#94a3b8', margin: '0.25rem 0 0 0', fontSize: '0.85rem' }}>
            AGPLv3 Low-Latency Tele-Pathology Streaming, Virtual Stage & Gigapixel WSI Viewer
          </p>
        </div>

        {/* View Mode & Specimen Toggle & Live Badge */}
        <div className="header-controls">
          {/* Quick Tour Button */}
          <button
            onClick={handleStartTour}
            title="Start interactive tour of Ishika features"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              background: 'rgba(56, 189, 248, 0.12)',
              border: '1px solid rgba(56, 189, 248, 0.35)',
              color: '#38bdf8',
              borderRadius: '8px',
              padding: '6px 12px',
              fontSize: '0.8rem',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <span>✨</span>
            <span>Feature Tour</span>
          </button>

          {/* Specimen Source Selector */}
          <div id="tour-slide-select" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: '#0f172a', borderRadius: '8px', padding: '4px 8px', border: '1px solid #1e293b' }}>
            <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: '600' }}>
              {role === 'viewer' ? '🔒 Slide:' : 'Slide:'}
            </span>
            {role === 'viewer' ? (
              <span
                title="Slide selection is locked and controlled by the Lab Host"
                style={{
                  background: '#1e293b',
                  color: specimen === 'clinical' ? '#f472b6' : '#38bdf8',
                  border: '1px solid #334155',
                  borderRadius: '6px',
                  padding: '4px 8px',
                  fontSize: '0.78rem',
                  fontWeight: '600',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                {specimen === 'clinical' ? '🧬 Clinical Biopsy (Aperio CMU-1)' : '🔬 Synthetic H&E'}
                <span style={{ fontSize: '0.7rem', color: '#64748b' }}>(Host)</span>
              </span>
            ) : (
              <select
                value={specimen}
                onChange={(e) => {
                  const next = e.target.value as 'synthetic' | 'clinical';
                  setSpecimen(next);
                  sendSpecimenSync(next);
                }}
                title="Switch physical specimen mounted on microscope stage"
                style={{
                  background: '#1e293b',
                  color: '#f8fafc',
                  border: '1px solid #334155',
                  borderRadius: '6px',
                  padding: '4px 8px',
                  fontSize: '0.78rem',
                  fontWeight: '600',
                  cursor: 'pointer',
                  outline: 'none',
                }}
              >
                <option value="synthetic">🔬 Synthetic H&E Benchmark</option>
                <option value="clinical">🧬 Clinical Biopsy (Aperio CMU-1 H&E)</option>
              </select>
            )}
          </div>

          <div id="tour-tabs" style={{ display: 'flex', background: '#0f172a', borderRadius: '8px', padding: '3px', border: '1px solid #1e293b' }}>
            <button
              onClick={() => setActiveTab('microscope')}
              style={{
                background: activeTab === 'microscope' ? '#0284c7' : 'transparent',
                color: activeTab === 'microscope' ? '#ffffff' : '#94a3b8',
                border: 'none',
                borderRadius: '6px',
                padding: '6px 14px',
                fontSize: '0.8rem',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              🎥 Live Optical Stream
            </button>
            <button
              onClick={() => setActiveTab('wsi')}
              style={{
                background: activeTab === 'wsi' ? '#0284c7' : 'transparent',
                color: activeTab === 'wsi' ? '#ffffff' : '#94a3b8',
                border: 'none',
                borderRadius: '6px',
                padding: '6px 14px',
                fontSize: '0.8rem',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              🗺️ Gigapixel WSI Deep Zoom
            </button>
          </div>

          <button
            id="tour-diag"
            onClick={() => setShowDiagnostics(true)}
            title="Click to open WebRTC diagnostic inspector & loopback telemetry"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              background: isConnected ? 'rgba(34, 197, 94, 0.15)' : 'rgba(234, 179, 8, 0.15)',
              border: isConnected ? '1px solid #22c55e' : '1px solid #eab308',
              color: isConnected ? '#4ade80' : '#facc15',
              padding: '4px 10px',
              borderRadius: '9999px',
              fontSize: '0.8rem',
              fontWeight: '600',
              cursor: 'pointer',
            }}
          >
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: isConnected ? '#22c55e' : '#eab308' }} />
            {isConnected ? 'WebRTC Stream 30fps' : 'Simulating...'}
            <span style={{ fontSize: '0.7rem', opacity: 0.8, marginLeft: '2px' }}>📊 Diag</span>
          </button>

          <button
            id="tour-capture"
            onClick={handleManualCapture}
            style={{
              background: '#0284c7',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              padding: '6px 14px',
              fontSize: '0.85rem',
              fontWeight: '600',
              cursor: 'pointer'
            }}
          >
            📸 Capture Biopsy
          </button>
        </div>
      </header>

      {/* Tele-Consultation Cross-Browser Session Bar */}
      <div id="tour-teleconsultation">
        <TeleconsultationBar
          roomId={roomId}
          role={role}
          peerState={peerState}
          signalingConnected={signalingConnected}
          remoteControlEnabled={remoteControlEnabled}
          emergencyStop={emergencyStop}
          hasHostInRoom={hasHostInRoom}
          peerCount={peerCount}
          onRoleChange={(newRole) => setRole(newRole)}
          onRoomChange={(newRoom) => {
            if (isValidRoomId(newRoom)) {
              setRoomId(newRoom);
            }
          }}
          onToggleRemoteControl={setRemoteControlEnabled}
          onToggleEmergencyStop={setEmergencyStop}
        />
      </div>

      <main className="main-layout">
        {/* Left Column: Primary Viewport (Microscope or WSI) */}
        <div style={{ minWidth: 0, width: '100%' }}>
          <div className="viewport-card" id="tour-viewport">
            <div className="viewport-stage-wrapper">
              {/* Live Optical Stream Viewport (Host Canvas Simulator or Remote Pathologist WebRTC Video) */}
              <div
                style={{
                  position: 'relative',
                  width: '100%',
                  height: '100%',
                  background: '#020617',
                  overflow: 'hidden',
                  display: activeTab === 'microscope' ? 'block' : 'none',
                }}
              >
                {role === 'viewer' ? (
                  <>
                    {remoteStream ? (
                      <video
                        ref={(el) => {
                          if (el) {
                            if (el.srcObject !== remoteStream) {
                              el.srcObject = remoteStream;
                            }
                            if (el.paused) {
                              el.play().catch(console.warn);
                            }
                          }
                        }}
                        autoPlay
                        playsInline
                        muted
                        style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
                      />
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94a3b8', padding: '1rem' }}>
                        <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>📡</div>
                        <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#38bdf8', textAlign: 'center' }}>Connecting to Live Optical Stream...</div>
                        <div style={{ fontSize: '0.82rem', color: '#64748b', marginTop: '0.4rem', textAlign: 'center' }}>
                          Room #{roomId} | Waiting for Lab Host to broadcast microscope video.
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#475569', marginTop: '0.75rem', maxWidth: '400px', lineHeight: 1.4, textAlign: 'center' }}>
                          Tip: Open this link in another browser or switch to "🔬 Lab Host" to act as the microscope camera broadcaster.
                        </div>
                      </div>
                    )}
                    <InteractiveOverlay
                      width={900}
                      height={540}
                      currentStage={stageState}
                      specimenType={specimen}
                      pointers={annotations}
                      onPointerClick={handlePointerClick}
                      onStagePan={handleStagePan}
                    />
                    <ControllerOverlay
                      currentStage={stageState}
                      onSelectObjective={(obj) => {
                        if (!canActuateStage) return;
                        const next = { ...stageState, objective: obj };
                        setStageState(next);
                        sendStageSync(next);
                      }}
                    />
                  </>
                ) : (
                  <>
                    <VirtualMicroscope
                      width={900}
                      height={540}
                      stage={stageState}
                      emergencyStop={emergencyStop}
                      specimenType={specimen}
                      onStreamReady={(s) => setStream(s)}
                      onStageChange={(st) => {
                        setStageState(st);
                        sendStageSync(st);
                      }}
                      onSnapshot={handleSnapshot}
                    />
                    <InteractiveOverlay
                      width={900}
                      height={540}
                      currentStage={stageState}
                      specimenType={specimen}
                      pointers={annotations}
                      onPointerClick={handlePointerClick}
                      onStagePan={handleStagePan}
                    />
                    <ControllerOverlay
                      currentStage={stageState}
                      onSelectObjective={(obj) => {
                        if (!canActuateStage) return;
                        const next = { ...stageState, objective: obj };
                        setStageState(next);
                        sendStageSync(next);
                      }}
                    />
                  </>
                )}
              </div>

              {/* Gigapixel WSI Deep Zoom Viewport */}
              <div
                style={{
                  position: 'relative',
                  width: '100%',
                  height: '100%',
                  display: activeTab === 'wsi' ? 'block' : 'none',
                }}
              >
                <WsiViewer
                  width={900}
                  height={540}
                  stageX={stageState.x}
                  stageY={stageState.y}
                  specimenType={specimen}
                  pointers={annotations}
                  onPointerClick={handlePointerClick}
                  onStageChange={(x, y) => {
                    if (!canActuateStage) return;
                    setStageState((p) => {
                      const next = { ...p, x, y };
                      sendStageSync(next);
                      return next;
                    });
                  }}
                  captureTrigger={wsiCaptureTrigger}
                  onSnapshot={handleSnapshot}
                />
              </div>
            </div>
          </div>

          {/* Telemetry Bar */}
          <div className="telemetry-grid">
            <div style={{ background: '#0f172a', padding: '0.6rem 0.75rem', borderRadius: '8px', border: '1px solid #1e293b' }}>
              <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>X Coordinate</span>
              <div style={{ fontSize: '1rem', fontWeight: 'bold' }}>{Math.round(stageState.x)} µm</div>
            </div>
            <div style={{ background: '#0f172a', padding: '0.6rem 0.75rem', borderRadius: '8px', border: '1px solid #1e293b' }}>
              <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Y Coordinate</span>
              <div style={{ fontSize: '1rem', fontWeight: 'bold' }}>{Math.round(stageState.y)} µm</div>
            </div>
            <div style={{ background: '#0f172a', padding: '0.6rem 0.75rem', borderRadius: '8px', border: '1px solid #1e293b' }}>
              <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Focal Z-Offset</span>
              <div style={{ fontSize: '1rem', fontWeight: 'bold', color: stageState.z === 0 ? '#4ade80' : '#f59e0b' }}>
                {stageState.z > 0 ? `+${stageState.z.toFixed(1)}` : stageState.z.toFixed(1)} µm
              </div>
            </div>
            <div style={{ background: '#0f172a', padding: '0.6rem 0.75rem', borderRadius: '8px', border: '1px solid #1e293b' }}>
              <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Active Lens</span>
              <div style={{ fontSize: '1rem', fontWeight: 'bold', color: '#38bdf8' }}>{stageState.objective}x Turret</div>
            </div>
          </div>

          {/* Specimen Clinical Pathology Context Banner */}
          <div className="specimen-banner">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: specimen === 'clinical' ? '#ec4899' : '#38bdf8' }}>
                {specimen === 'clinical' ? '🧬 Specimen: Aperio CMU-1 Benchmark Biopsy' : '🔬 Specimen: Procedural Benchmark Tissue'}
              </span>
              <span style={{ fontSize: '0.75rem', color: '#64748b' }}>|</span>
              <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                {specimen === 'clinical' ? 'OpenSlide Benchmark Suite · Brightfield H&E' : 'In-Memory Deterministic Synthetic H&E'}
              </span>
            </div>
            <span style={{ fontSize: '0.7rem', color: '#64748b', fontFamily: 'monospace' }}>
              {specimen === 'clinical' ? 'Source: CMU Pathology / Aperio SVS' : 'Tissue: Emulated Stroma'}
            </span>
          </div>
        </div>

        {/* Right Column: Minimap, ROIs & Captured Biopsy Gallery */}
        <div className="sidebar-column">
          {/* Whole Slide Minimap Card */}
          <div id="tour-minimap" style={{ background: '#0f172a', padding: '1rem', borderRadius: '10px', border: '1px solid #1e293b', textAlign: 'center' }}>
            <h3 style={{ fontSize: '0.85rem', fontWeight: 'bold', margin: '0 0 0.5rem 0', color: '#f8fafc', textAlign: 'left' }}>
              📍 Slide Specimen Map
            </h3>
            <Minimap
              currentStage={stageState}
              onNavigate={handleMinimapNavigate}
              width={300}
              height={140}
              specimenType={specimen}
            />
            <p style={{ fontSize: '0.75rem', color: '#64748b', margin: '0.4rem 0 0 0' }}>
              Click slide to jump motorized stage to region.
            </p>
          </div>

          {/* Active Annotations / Consultation Pins */}
          <div id="tour-pins" style={{ background: '#0f172a', padding: '1rem', borderRadius: '10px', border: '1px solid #1e293b' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <h3 style={{ fontSize: '0.85rem', fontWeight: 'bold', margin: 0, color: '#f8fafc' }}>
                📌 Pathologist Pins ({annotations.length})
              </h3>
              {annotations.length > 0 && (
                <button
                  onClick={() => setAnnotations([])}
                  style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: '11px', cursor: 'pointer' }}
                >
                  Clear all
                </button>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', maxHeight: '110px', overflowY: 'auto' }}>
              {annotations.map((ann) => (
                <div
                  key={ann.id}
                  onClick={() => setStageState((prev) => ({ ...prev, x: ann.stageX, y: ann.stageY }))}
                  title="Click to jump motorized stage to this ROI"
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: '#1e293b',
                    padding: '5px 8px',
                    borderRadius: '4px',
                    fontSize: '0.75rem',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ color: ann.color, fontWeight: '600' }}>● {ann.label}</span>
                  <span style={{ color: '#64748b', fontFamily: 'monospace' }}>
                    {Math.round(ann.stageX)} µm, {Math.round(ann.stageY)} µm
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Captured Slides Gallery */}
          <div style={{ background: '#0f172a', padding: '1rem', borderRadius: '10px', border: '1px solid #1e293b' }}>
            <h3 style={{ fontSize: '0.85rem', fontWeight: 'bold', margin: '0 0 0.5rem 0', color: '#f8fafc' }}>
              🖼️ Biopsy Captures ({snapshots.length})
            </h3>
            {snapshots.length === 0 ? (
              <p style={{ fontSize: '0.75rem', color: '#64748b', fontStyle: 'italic', margin: 0 }}>
                Press Spacebar or click "Capture Biopsy" to record frames.
              </p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem' }}>
                {snapshots.map((src, i) => (
                  <img
                    key={i}
                    src={src}
                    alt={`Snapshot ${i + 1}`}
                    style={{ width: '100%', height: '70px', objectFit: 'cover', borderRadius: '6px', border: '1px solid #334155' }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* WebRTC Diagnostics Inspector Modal */}
      <WebRtcDiagnosticsModal
        stream={stream}
        isOpen={showDiagnostics}
        onClose={() => setShowDiagnostics(false)}
        onSnapshotCaptured={handleSnapshot}
      />

      {/* Interactive Feature Tour Modal */}
      <FeatureTourModal
        isOpen={showTour}
        onClose={handleCloseTour}
        onSelectTab={(tab) => setActiveTab(tab)}
      />
    </div>
  );
}
