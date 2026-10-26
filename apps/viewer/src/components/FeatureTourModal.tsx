import { useState, useEffect, useRef } from 'react';

export interface TourStep {
  targetId?: string;
  title: string;
  badge: string;
  description: string;
  actionHint?: string;
  tabRequirement?: 'microscope' | 'wsi';
}

export const TOUR_STEPS: TourStep[] = [
  {
    title: 'Welcome to Ishika Tele-Pathology',
    badge: 'Overview',
    description:
      'Ishika is a zero-install, browser-native tele-pathology platform that bridges optical laboratory microscopes with remote diagnostic workstations via 30 FPS peer-to-peer WebRTC video streaming and WebHID stage control.',
    actionHint: 'Click "Next" to walk through each interactive laboratory control on screen.',
  },
  {
    targetId: 'tour-viewport',
    title: 'Live Optical Eyepiece Viewport',
    badge: '60 FPS Canvas & 30 FPS WebRTC',
    description:
      'This viewport emulates an optical microscope eyepiece. Use WASD or Arrow Keys to actuate the motorized stage in physical microns (µm). Use +/- to adjust focal plane depth with realistic optical blur, and 1-4 to switch objectives.',
    actionHint: 'Try dragging directly on the glass slide or pressing WASD to pan.',
    tabRequirement: 'microscope',
  },
  {
    targetId: 'tour-slide-select',
    title: 'Slide Specimen Selection',
    badge: 'Clinical vs. Benchmark',
    description:
      'Toggle between an authentic clinical whole-slide biopsy (Aperio CMU-1 H&E scan) and a procedural synthetic benchmark. In consultation mode, slide selection is locked to the physical Lab Host and synchronized automatically.',
    actionHint: 'Lab hosts control the active slide; remote viewers receive live synchronized feeds.',
  },
  {
    targetId: 'tour-tabs',
    title: 'Live Stream vs. Gigapixel Deep Zoom',
    badge: 'Dual-Engine Architecture',
    description:
      'Switch between the Live Optical Stream (camera feed with interactive reticles) and Gigapixel WSI Deep Zoom (multi-resolution Deep Zoom pyramidal tile engine rendering full whole-slide scans).',
    actionHint: 'Click "Gigapixel WSI Deep Zoom" to inspect tissue at whole-slide resolution.',
  },
  {
    targetId: 'tour-teleconsultation',
    title: 'P2P Tele-Consultation & Stage Arbitration',
    badge: 'Single-Driver & E-Stop',
    description:
      'Coordinate remote consultations in real time. Share the consultation link with a remote pathologist. Hosts can lock or grant remote stage actuation ("Single-Driver Arbitration") and engage an immediate Emergency Stop ("E-Stop").',
    actionHint: 'Click "Share Tele-Consultation" to copy a guest link for a remote colleague.',
  },
  {
    targetId: 'tour-minimap',
    title: 'Slide Specimen Map & Macro Navigation',
    badge: 'Hardware Coordinate Mapping',
    description:
      'The slide minimap represents the physical glass slide on the motorized stage. Click anywhere on the tissue silhouette to instantly jump the physical stage motors to that exact region in microns.',
    actionHint: 'Click any point on the glass slide minimap to rapidly navigate.',
  },
  {
    targetId: 'tour-pins',
    title: 'Pathologist Annotation Pins',
    badge: 'Sub-Pixel Tissue Anchoring',
    description:
      'Click anywhere inside the eyepiece viewport to anchor a diagnostic region-of-interest (ROI) pin. Pins are locked to physical tissue coordinates (µm) rather than screen pixels and sync instantly to remote peers.',
    actionHint: 'Click an existing pin in the sidebar list to jump the stage directly to it.',
  },
  {
    targetId: 'tour-capture',
    title: 'Biopsy Frame Shutter & WebHID Pedals',
    badge: 'Foot Pedal & Spacebar',
    description:
      'Press Spacebar, click "Capture Biopsy", or tap a connected USB WebHID foot pedal to capture high-resolution diagnostic frames. Captures are archived locally and ready for diagnostic review.',
    actionHint: 'Press Spacebar anytime to capture a frame into the Biopsy Gallery.',
  },
  {
    targetId: 'tour-diag',
    title: 'WebRTC Diagnostic Inspector',
    badge: 'Zero-Cloud E2E Telemetry',
    description:
      'Click the "WebRTC Stream 📊 Diag" badge anytime to inspect real-time video codec parameters, packet loss, round-trip time (RTT), and verify client-side loopback performance.',
    actionHint: 'You can restart this interactive tour anytime by clicking "✨ Feature Tour" in the top bar.',
  },
];

export interface FeatureTourModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectTab?: (tab: 'microscope' | 'wsi') => void;
}

interface TargetSpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function FeatureTourModal({ isOpen, onClose, onSelectTab }: FeatureTourModalProps) {
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  const [targetRect, setTargetRect] = useState<TargetSpotlightRect | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const step = TOUR_STEPS[currentStepIndex];
  const isFirst = currentStepIndex === 0;
  const isLast = currentStepIndex === TOUR_STEPS.length - 1;

  useEffect(() => {
    if (!isOpen) {
      setCurrentStepIndex(0);
      setTargetRect(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && step?.tabRequirement && onSelectTab) {
      onSelectTab(step.tabRequirement);
    }
  }, [isOpen, currentStepIndex, step?.tabRequirement, onSelectTab]);

  // Track and update the bounding box of the active target element
  useEffect(() => {
    if (!isOpen) {
      setTargetRect(null);
      return;
    }

    if (!step?.targetId) {
      setTargetRect(null);
      return;
    }

    const updateRect = () => {
      const el = document.getElementById(step.targetId!);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        const rect = el.getBoundingClientRect();
        setTargetRect({
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        });
      } else {
        setTargetRect(null);
      }
    };

    // Initial check + short delay to allow tab/DOM layout to settle
    updateRect();
    const timer = setTimeout(updateRect, 100);

    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', updateRect, true);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('scroll', updateRect, true);
    };
  }, [isOpen, currentStepIndex, step?.targetId]);

  if (!isOpen) return null;

  // Calculate position of the tour card relative to the spotlighted element
  const getCardStyle = (): React.CSSProperties => {
    if (!targetRect || typeof window === 'undefined') {
      // Default centered modal for intro overview step
      return {
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
      };
    }

    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const cardW = Math.min(480, viewportW - 32);

    // If target is in the top half, place card below it; if in bottom half, place card above it
    const spaceBelow = viewportH - (targetRect.top + targetRect.height);
    const spaceAbove = targetRect.top;

    let top: number;
    if (spaceBelow >= 260 || spaceBelow > spaceAbove) {
      top = Math.min(viewportH - 280, targetRect.top + targetRect.height + 16);
    } else {
      top = Math.max(16, targetRect.top - 260);
    }

    // Align horizontally with target center, bounded within viewport margins
    let left = targetRect.left + targetRect.width / 2 - cardW / 2;
    left = Math.max(16, Math.min(viewportW - cardW - 16, left));

    return {
      position: 'fixed',
      top: `${Math.round(top)}px`,
      left: `${Math.round(left)}px`,
      width: `${cardW}px`,
      transition: 'top 0.25s ease-out, left 0.25s ease-out',
    };
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, pointerEvents: 'none' }}>
      {/* Dynamic SVG Spotlight Cutout Mask: Darkens the page while keeping the targeted feature 100% crystal clear */}
      <svg
        style={{
          position: 'fixed',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'auto',
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <defs>
          <mask id="spotlight-mask">
            {/* White background: dark overlay applies everywhere */}
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {/* Black cutout: carves a transparent hole over the spotlighted element */}
            {targetRect && (
              <rect
                x={targetRect.left - 8}
                y={targetRect.top - 8}
                width={targetRect.width + 16}
                height={targetRect.height + 16}
                rx="12"
                ry="12"
                fill="black"
              />
            )}
          </mask>
        </defs>

        {/* Semi-transparent dark overlay with SVG mask cutout (NO blur) */}
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="rgba(2, 6, 23, 0.72)"
          mask="url(#spotlight-mask)"
        />

        {/* Cyan Glowing Border directly around the spotlighted cut-out */}
        {targetRect && (
          <rect
            x={targetRect.left - 8}
            y={targetRect.top - 8}
            width={targetRect.width + 16}
            height={targetRect.height + 16}
            rx="12"
            ry="12"
            fill="none"
            stroke="#38bdf8"
            strokeWidth="2.5"
            strokeDasharray="6 4"
            style={{
              filter: 'drop-shadow(0 0 10px rgba(56, 189, 248, 0.6))',
              animation: 'none',
            }}
          />
        )}
      </svg>

      {/* Floating Tour Guide Card */}
      <div
        ref={cardRef}
        style={{
          ...getCardStyle(),
          pointerEvents: 'auto',
          background: '#0f172a',
          border: '1px solid #38bdf8',
          boxShadow: '0 20px 40px -10px rgba(2, 6, 23, 0.8), 0 0 20px rgba(56, 189, 248, 0.25)',
          borderRadius: '14px',
          maxWidth: '480px',
          padding: '1.25rem 1.5rem',
          color: '#f8fafc',
          zIndex: 10000,
        }}
      >
        {/* Header Bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{
                background: 'rgba(56, 189, 248, 0.15)',
                color: '#38bdf8',
                border: '1px solid rgba(56, 189, 248, 0.35)',
                padding: '2px 8px',
                borderRadius: '9999px',
                fontSize: '0.72rem',
                fontWeight: '700',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              {step.badge}
            </span>
            <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: '600' }}>
              Step {currentStepIndex + 1} of {TOUR_STEPS.length}
            </span>
          </div>

          <button
            onClick={onClose}
            title="Skip and close tour"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              fontSize: '1.2rem',
              cursor: 'pointer',
              padding: '0 4px',
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* Step Title & Content */}
        <h2 style={{ fontSize: '1.15rem', fontWeight: 'bold', margin: '0 0 0.5rem 0', color: '#f8fafc' }}>
          {step.title}
        </h2>
        <p style={{ fontSize: '0.84rem', lineHeight: '1.5', color: '#cbd5e1', margin: '0 0 0.9rem 0' }}>
          {step.description}
        </p>

        {/* Interactive Action Hint */}
        {step.actionHint && (
          <div
            style={{
              background: 'rgba(30, 41, 59, 0.85)',
              borderLeft: '3px solid #38bdf8',
              padding: '7px 10px',
              borderRadius: '0 6px 6px 0',
              fontSize: '0.75rem',
              color: '#94a3b8',
              marginBottom: '1rem',
            }}
          >
            💡 <strong style={{ color: '#e2e8f0' }}>Tip:</strong> {step.actionHint}
          </div>
        )}

        {/* Step Progress Dots */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '5px', marginBottom: '1rem' }}>
          {TOUR_STEPS.map((_, idx) => (
            <button
              key={idx}
              onClick={() => setCurrentStepIndex(idx)}
              title={`Jump to step ${idx + 1}`}
              style={{
                width: idx === currentStepIndex ? '18px' : '6px',
                height: '6px',
                borderRadius: '9999px',
                background: idx === currentStepIndex ? '#38bdf8' : '#334155',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            />
          ))}
        </div>

        {/* Footer Navigation Controls */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              fontSize: '0.8rem',
              fontWeight: '600',
              cursor: 'pointer',
              padding: '4px 8px',
            }}
          >
            Skip Tour
          </button>

          <div style={{ display: 'flex', gap: '8px' }}>
            {!isFirst && (
              <button
                onClick={() => setCurrentStepIndex((p) => Math.max(0, p - 1))}
                style={{
                  background: '#1e293b',
                  color: '#e2e8f0',
                  border: '1px solid #334155',
                  borderRadius: '6px',
                  padding: '5px 12px',
                  fontSize: '0.8rem',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                ← Back
              </button>
            )}

            <button
              onClick={() => {
                if (isLast) {
                  onClose();
                } else {
                  setCurrentStepIndex((p) => Math.min(TOUR_STEPS.length - 1, p + 1));
                }
              }}
              style={{
                background: isLast ? '#10b981' : '#0284c7',
                color: '#ffffff',
                border: 'none',
                borderRadius: '6px',
                padding: '5px 14px',
                fontSize: '0.8rem',
                fontWeight: '700',
                cursor: 'pointer',
                boxShadow: isLast
                  ? '0 2px 10px rgba(16, 185, 129, 0.4)'
                  : '0 2px 10px rgba(2, 132, 199, 0.4)',
              }}
            >
              {isLast ? 'Get Started 🚀' : 'Next Step →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
