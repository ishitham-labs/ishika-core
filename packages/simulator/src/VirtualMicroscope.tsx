import { useEffect, useRef, useState, useCallback } from 'react';
import { StageController, StageState, ObjectiveMagnification } from './stage';
import { renderMicroscopeView, SpecimenMode } from './optics';
import { useKeyboardControls, useGamepad, useHidCaptureTrigger } from '@ishika/controls';

export interface VirtualMicroscopeProps {
  width?: number;
  height?: number;
  specimenType?: SpecimenMode;
  stage?: StageState;
  emergencyStop?: boolean;
  onStreamReady?: (stream: MediaStream) => void;
  onStageChange?: (state: StageState) => void;
  onSnapshot?: (dataUrl: string) => void;
}

export function VirtualMicroscope({
  width = 960,
  height = 540,
  specimenType = 'clinical',
  stage,
  emergencyStop = false,
  onStreamReady,
  onStageChange,
  onSnapshot,
}: VirtualMicroscopeProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageControllerRef = useRef<StageController>(new StageController(stage));
  const [stageState, setStageState] = useState<StageState>(stageControllerRef.current.getState());
  const streamRef = useRef<MediaStream | null>(null);

  // Sync hardware emergency stop state
  useEffect(() => {
    stageControllerRef.current.setEmergencyStop(emergencyStop);
  }, [emergencyStop]);

  // Sync state changes with parent
  const updateState = useCallback((newState: StageState) => {
    setStageState(newState);
    onStageChange?.(newState);
  }, [onStageChange]);

  // Synchronize external stage actuation (e.g. Minimap clicks or Objective HUD buttons)
  useEffect(() => {
    if (stage) {
      const current = stageControllerRef.current.getState();
      if (
        stage.x !== current.x ||
        stage.y !== current.y ||
        stage.z !== current.z ||
        stage.objective !== current.objective
      ) {
        const next = stageControllerRef.current.setState(stage);
        setStageState(next);
      }
    }
  }, [stage]);

  // Wire keyboard controls
  useKeyboardControls({
    onPan: (dx, dy) => {
      const next = stageControllerRef.current.pan(dx, dy);
      updateState(next);
    },
    onZoom: (dz) => {
      const next = stageControllerRef.current.adjustFocus(dz);
      updateState(next);
    },
    onCapture: () => {
      handleCapture();
    },
    onPreset: (index) => {
      const presets: ObjectiveMagnification[] = [4, 10, 20, 40];
      const next = stageControllerRef.current.setObjective(presets[index] || 10);
      updateState(next);
    },
  });

  // Wire gamepad controls
  useGamepad({
    onPan: (dx, dy) => {
      const next = stageControllerRef.current.pan(dx, dy);
      updateState(next);
    },
    onZoom: (dz) => {
      const next = stageControllerRef.current.adjustFocus(dz);
      updateState(next);
    },
    onCapture: () => {
      handleCapture();
    },
    onPreset: (index) => {
      const presets: ObjectiveMagnification[] = [4, 10, 20, 40];
      const next = stageControllerRef.current.setObjective(presets[index] || 10);
      updateState(next);
    },
  });

  // Wire WebHID pedal/button trigger
  useHidCaptureTrigger(() => {
    handleCapture();
  });

  const handleCapture = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
    onSnapshot?.(dataUrl);
  }, [onSnapshot]);

  // Generate MediaStream via canvas.captureStream()
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || streamRef.current) return;

    if (canvas.captureStream) {
      try {
        const stream = canvas.captureStream(30);
        streamRef.current = stream;
        onStreamReady?.(stream);
      } catch (err) {
        console.warn('Virtual canvas captureStream error:', err);
      }
    }
  }, [onStreamReady]);

  // Track specimen mode and preload authentic clinical biopsy slide photograph
  const specimenTypeRef = useRef<SpecimenMode>(specimenType);
  const clinicalImgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    specimenTypeRef.current = specimenType;
  }, [specimenType]);

  useEffect(() => {
    const img = new Image();
    img.src = './specimens/clinical_slide.webp';
    img.onload = () => {
      clinicalImgRef.current = img;
    };
    img.onerror = () => {
      const fallback = new Image();
      fallback.src = '/specimens/clinical_slide.webp';
      fallback.onload = () => {
        clinicalImgRef.current = fallback;
      };
    };
  }, []);

  // Continuous optical rendering animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let intervalId: any;

    const render = () => {
      renderMicroscopeView(ctx, stageControllerRef.current.getState(), {
        width,
        height,
        showReticle: true,
        showScaleBar: true,
        specimenType: specimenTypeRef.current,
        clinicalImage: clinicalImgRef.current,
      });
      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);

    // Ensure continuous 30 FPS canvas rendering even in headless test runners or background tabs
    intervalId = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) {
        renderMicroscopeView(ctx, stageControllerRef.current.getState(), {
          width,
          height,
          showReticle: true,
          showScaleBar: true,
          specimenType: specimenTypeRef.current,
          clinicalImage: clinicalImgRef.current,
        });
      }
    }, 1000 / 30);

    return () => {
      cancelAnimationFrame(animId);
      if (intervalId) clearInterval(intervalId);
    };
  }, [width, height, specimenType]);

  return (
    <div style={{
      position: 'relative',
      width: '100%',
      height: '100%',
      maxWidth: `${width}px`,
      aspectRatio: `${width} / ${height}`,
      borderRadius: '12px',
      overflow: 'hidden',
      border: '1px solid #1e293b',
      margin: '0 auto',
      display: 'block',
    }}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{ width: '100%', height: '100%', display: 'block', background: '#020617', cursor: 'grab' }}
      />

      {/* On-Screen Optics HUD Overlay */}
      <div style={{
        position: 'absolute',
        top: '12px',
        left: '12px',
        background: 'rgba(15, 23, 42, 0.85)',
        backdropFilter: 'blur(8px)',
        border: '1px solid rgba(51, 65, 85, 0.8)',
        borderRadius: '8px',
        padding: '6px 10px',
        fontSize: 'clamp(10px, 1.8vw, 12px)',
        fontFamily: 'monospace',
        color: '#f8fafc',
        pointerEvents: 'none',
        maxWidth: 'calc(100% - 24px)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#22c55e', flexShrink: 0 }} />
          <span><strong>STAGE:</strong> X: {Math.round(stageState.x)} µm | Y: {Math.round(stageState.y)} µm</span>
        </div>
        <div style={{ color: '#94a3b8' }}>
          <strong>LENS:</strong> <span style={{ color: '#38bdf8' }}>{stageState.objective}x Objective</span> | <strong>Z-FOCUS:</strong> {stageState.z > 0 ? `+${stageState.z.toFixed(1)}` : stageState.z.toFixed(1)} µm
        </div>
      </div>
    </div>
  );
}
