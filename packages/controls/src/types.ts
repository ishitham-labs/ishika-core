export interface StageMovement {
  dx: number;
  dy: number;
}

export interface StageControlsOptions {
  onPan?: (dx: number, dy: number) => void;
  onZoom?: (dz: number) => void;
  onCapture?: () => void;
  onPreset?: (index: number) => void;
}
