import { useState } from 'react';

export interface ControllerOverlayProps {
  currentStage?: { x: number; y: number; z: number; objective: number };
  onSelectObjective?: (obj: 4 | 10 | 20 | 40) => void;
}

export function ControllerOverlay({ currentStage, onSelectObjective }: ControllerOverlayProps) {
  const [isExpanded, setIsExpanded] = useState<boolean>(true);

  if (!isExpanded) {
    return (
      <button
        onClick={() => setIsExpanded(true)}
        style={{
          position: 'absolute',
          bottom: '16px',
          left: '16px',
          background: 'rgba(15, 23, 42, 0.85)',
          color: '#38bdf8',
          border: '1px solid #334155',
          borderRadius: '8px',
          padding: '6px 12px',
          fontSize: '12px',
          fontFamily: 'monospace',
          cursor: 'pointer',
          zIndex: 40,
        }}
      >
        🎮 Show Controls HUD
      </button>
    );
  }

  return (
    <div
      style={{
        position: 'absolute',
        bottom: '16px',
        left: '16px',
        background: 'rgba(15, 23, 42, 0.92)',
        backdropFilter: 'blur(10px)',
        border: '1px solid #334155',
        color: '#f8fafc',
        padding: '14px',
        borderRadius: '10px',
        fontSize: '12px',
        fontFamily: 'system-ui, sans-serif',
        zIndex: 40,
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        width: '320px',
        maxWidth: 'calc(100% - 32px)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', borderBottom: '1px solid #334155', paddingBottom: '6px' }}>
        <h4 style={{ margin: 0, fontWeight: '700', fontSize: '13px', color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span>🕹️</span> Stage & Optics HUD
        </h4>
        <button
          onClick={() => setIsExpanded(false)}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#94a3b8',
            cursor: 'pointer',
            fontSize: '14px',
            padding: '2px 6px',
          }}
          aria-label="Minimize HUD"
        >
          ✕
        </button>
      </div>

      {/* Objective Lens Turret Selectors */}
      <div style={{ marginBottom: '12px' }}>
        <span style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>
          Objective Turret:
        </span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px' }}>
          {([4, 10, 20, 40] as const).map((mag) => {
            const isActive = currentStage?.objective === mag;
            return (
              <button
                key={mag}
                onClick={() => onSelectObjective?.(mag)}
                style={{
                  background: isActive ? '#0284c7' : '#1e293b',
                  color: isActive ? '#ffffff' : '#94a3b8',
                  border: isActive ? '1px solid #38bdf8' : '1px solid #334155',
                  borderRadius: '4px',
                  padding: '4px 0',
                  fontWeight: '600',
                  fontSize: '11px',
                  cursor: 'pointer',
                }}
              >
                {mag}x
              </button>
            );
          })}
        </div>
      </div>

      {/* Controller Mapping Legend */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '11px' }}>
        <div>
          <span style={{ color: '#60a5fa', fontWeight: '600' }}>Gamepad</span>
          <ul style={{ margin: '4px 0 0 0', paddingLeft: '14px', color: '#94a3b8', lineHeight: 1.5 }}>
            <li><strong>L-Stick:</strong> Pan XY</li>
            <li><strong>R-Stick Y:</strong> Z-Focus</li>
            <li><strong>A / X:</strong> Capture</li>
            <li><strong>L1/R1:</strong> Presets</li>
          </ul>
        </div>
        <div>
          <span style={{ color: '#4ade80', fontWeight: '600' }}>Keyboard</span>
          <ul style={{ margin: '4px 0 0 0', paddingLeft: '14px', color: '#94a3b8', lineHeight: 1.5 }}>
            <li><strong>WASD / ➔:</strong> Pan XY</li>
            <li><strong>+ / -:</strong> Focus</li>
            <li><strong>Space:</strong> Capture</li>
            <li><strong>1-4:</strong> Turret</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
