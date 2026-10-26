import { useEffect, useRef } from 'react';
import type { StageControlsOptions } from './types';

const DEADZONE = 0.1;

export function useGamepad({ onPan, onZoom, onCapture, onPreset }: StageControlsOptions = {}) {
  const previousButtonsRef = useRef<boolean[]>([]);
  const requestRef = useRef<number | undefined>(undefined);
  const callbacksRef = useRef({ onPan, onZoom, onCapture, onPreset });

  useEffect(() => {
    callbacksRef.current = { onPan, onZoom, onCapture, onPreset };
  }, [onPan, onZoom, onCapture, onPreset]);

  useEffect(() => {
    const loop = () => {
      if (typeof navigator === 'undefined' || !navigator.getGamepads) {
        return;
      }

      const gamepads = navigator.getGamepads();
      const gamepad = Array.from(gamepads).find((gp) => gp !== null && gp.connected);

      if (gamepad) {
        const { onPan, onZoom, onCapture, onPreset } = callbacksRef.current;

        // Axes: 0,1 for X/Y stage translation, axis 3 for Z focus/zoom
        if (gamepad.axes && gamepad.axes.length >= 4) {
          const dx = Math.abs(gamepad.axes[0]) > DEADZONE ? gamepad.axes[0] : 0;
          const dy = Math.abs(gamepad.axes[1]) > DEADZONE ? gamepad.axes[1] : 0;
          if ((dx !== 0 || dy !== 0) && onPan) {
            onPan(dx, dy);
          }

          const dz = Math.abs(gamepad.axes[3]) > DEADZONE ? gamepad.axes[3] : 0;
          if (dz !== 0 && onZoom) {
            onZoom(dz);
          }
        }

        // Buttons: 0 for image capture, 4-7 for lens magnification presets (4x, 10x, 20x, 40x)
        if (gamepad.buttons) {
          const currentButtons = gamepad.buttons.map((b) => b.pressed);
          const previousButtons = previousButtonsRef.current;

          if (currentButtons.length > 0 && currentButtons[0] && !previousButtons[0] && onCapture) {
            onCapture();
          }

          if (onPreset) {
            if (currentButtons.length > 4 && currentButtons[4] && !previousButtons[4]) onPreset(0);
            if (currentButtons.length > 5 && currentButtons[5] && !previousButtons[5]) onPreset(1);
            if (currentButtons.length > 6 && currentButtons[6] && !previousButtons[6]) onPreset(2);
            if (currentButtons.length > 7 && currentButtons[7] && !previousButtons[7]) onPreset(3);
          }

          previousButtonsRef.current = currentButtons;
        }
      }

      requestRef.current = requestAnimationFrame(loop);
    };

    requestRef.current = requestAnimationFrame(loop);

    return () => {
      if (requestRef.current !== undefined) {
        cancelAnimationFrame(requestRef.current);
      }
    };
  }, []);
}
