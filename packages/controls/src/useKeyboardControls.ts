import { useEffect, useRef } from 'react';
import type { StageControlsOptions } from './types';

export function useKeyboardControls({
  onPan,
  onZoom,
  onCapture,
  onPreset,
}: StageControlsOptions = {}) {
  const requestRef = useRef<number | undefined>(undefined);
  const keysRef = useRef<Set<string>>(new Set());
  const callbacksRef = useRef({ onPan, onZoom, onCapture, onPreset });

  useEffect(() => {
    callbacksRef.current = { onPan, onZoom, onCapture, onPreset };
  }, [onPan, onZoom, onCapture, onPreset]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input or textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      keysRef.current.add(e.code);

      const { onCapture, onPreset } = callbacksRef.current;

      // Spacebar triggers snapshot capture
      if (e.code === 'Space' && onCapture && !e.repeat) {
        e.preventDefault();
        onCapture();
      }

      // Number keys 1-4 trigger objective lens presets (4x, 10x, 20x, 40x)
      if (onPreset && !e.repeat) {
        if (e.code === 'Digit1') onPreset(0);
        else if (e.code === 'Digit2') onPreset(1);
        else if (e.code === 'Digit3') onPreset(2);
        else if (e.code === 'Digit4') onPreset(3);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      keysRef.current.delete(e.code);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    const loop = () => {
      const keys = keysRef.current;
      const { onPan, onZoom } = callbacksRef.current;

      let dx = 0;
      let dy = 0;
      // Arrow keys and WASD for XY stage panning
      if (keys.has('ArrowLeft') || keys.has('KeyA')) dx -= 1;
      if (keys.has('ArrowRight') || keys.has('KeyD')) dx += 1;
      if (keys.has('ArrowUp') || keys.has('KeyW')) dy -= 1;
      if (keys.has('ArrowDown') || keys.has('KeyS')) dy += 1;

      if ((dx !== 0 || dy !== 0) && onPan) {
        onPan(dx, dy);
      }

      let dz = 0;
      // Plus / Minus for Z-focus / magnification adjustment
      if (keys.has('Equal') || keys.has('NumpadAdd')) dz += 1;
      if (keys.has('Minus') || keys.has('NumpadSubtract')) dz -= 1;

      if (dz !== 0 && onZoom) {
        onZoom(dz);
      }

      requestRef.current = requestAnimationFrame(loop);
    };

    requestRef.current = requestAnimationFrame(loop);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      if (requestRef.current !== undefined) {
        cancelAnimationFrame(requestRef.current);
      }
    };
  }, []);
}
