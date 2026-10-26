import { useRef, useEffect, useState } from 'react';
import {
  stageToViewportPx,
  viewportPxToStage,
  type StageState,
} from '@ishika/simulator';

export interface PointerAnnotation {
  id: string;
  stageX: number; // Physical stage X coordinate in µm
  stageY: number; // Physical stage Y coordinate in µm
  color: string;
  label?: string;
}

export interface InteractiveOverlayProps {
  pointers?: PointerAnnotation[];
  currentStage: StageState;
  specimenType?: 'synthetic' | 'clinical';
  onPointerClick?: (stageX: number, stageY: number) => void;
  onStagePan?: (dxMicrons: number, dyMicrons: number) => void;
  width: number;
  height: number;
}

export function InteractiveOverlay({
  pointers = [],
  currentStage,
  specimenType = 'clinical',
  onPointerClick,
  onStagePan,
  width,
  height,
}: InteractiveOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDraggingRef = useRef<boolean>(false);
  const dragMovedRef = useRef<boolean>(false);
  const downPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const lastMousePosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(centerX, centerY) * 0.95;

    ctx.save();
    // Clip annotations to the circular eyepiece aperture so off-screen pins don't bleed outside the lens
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.clip();

    pointers.forEach((p) => {
      const { x: px, y: py } = stageToViewportPx(p.stageX, p.stageY, currentStage, {
        width,
        height,
        specimenType,
      });

      // Draw outer target ring
      ctx.beginPath();
      ctx.arc(px, py, 14, 0, Math.PI * 2);
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Draw solid center dot
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();

      // Draw annotation label tag
      if (p.label) {
        ctx.font = '11px system-ui, sans-serif';
        ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
        const textWidth = ctx.measureText(p.label).width;
        ctx.fillRect(px + 10, py - 18, textWidth + 8, 18);

        ctx.fillStyle = '#ffffff';
        ctx.fillText(p.label, px + 14, py - 5);
      }
    });

    ctx.restore();
  }, [pointers, currentStage, specimenType, width, height]);

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    isDraggingRef.current = true;
    dragMovedRef.current = false;
    downPosRef.current = { x: e.clientX, y: e.clientY };
    lastMousePosRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDraggingRef.current || !canvasRef.current) return;

    const totalDist = Math.hypot(
      e.clientX - downPosRef.current.x,
      e.clientY - downPosRef.current.y
    );
    if (totalDist > 4) {
      dragMovedRef.current = true;
      if (!isDragging) setIsDragging(true);
    }

    if (dragMovedRef.current && onStagePan) {
      const rect = canvasRef.current.getBoundingClientRect();
      const cssScaleX = width / Math.max(1, rect.width);
      const cssScaleY = height / Math.max(1, rect.height);
      const dxPx = (e.clientX - lastMousePosRef.current.x) * cssScaleX;
      const dyPx = (e.clientY - lastMousePosRef.current.y) * cssScaleY;

      const { scaleX, scaleY } = stageToViewportPx(
        currentStage.x,
        currentStage.y,
        currentStage,
        { width, height, specimenType }
      );
      onStagePan(-dxPx / scaleX, -dyPx / scaleY);
    }

    lastMousePosRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    setIsDragging(false);

    if (!dragMovedRef.current && onPointerClick && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const screenX = ((e.clientX - rect.left) / Math.max(1, rect.width)) * width;
      const screenY = ((e.clientY - rect.top) / Math.max(1, rect.height)) * height;

      // Ignore clicks outside the circular eyepiece aperture
      const centerX = width / 2;
      const centerY = height / 2;
      const radius = Math.min(centerX, centerY) * 0.95;
      if (Math.hypot(screenX - centerX, screenY - centerY) <= radius) {
        const { x: stageX, y: stageY } = viewportPxToStage(
          screenX,
          screenY,
          currentStage,
          { width, height, specimenType }
        );
        onPointerClick(stageX, stageY);
      }
    }
  };

  const handleMouseLeave = () => {
    isDraggingRef.current = false;
    setIsDragging(false);
  };

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'auto',
        cursor: isDragging ? 'grabbing' : 'crosshair',
        zIndex: 20,
      }}
    />
  );
}

