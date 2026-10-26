export interface StageBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export type ObjectiveMagnification = 4 | 10 | 20 | 40;

export interface StageState {
  x: number;       // Horizontal position in micrometers (µm)
  y: number;       // Vertical position in micrometers (µm)
  z: number;       // Focal plane offset in micrometers (µm), 0 = perfect focus
  objective: ObjectiveMagnification; // Current objective lens
}

export const DEFAULT_STAGE_BOUNDS: StageBounds = {
  minX: -25000, // 25mm left
  maxX: 25000,  // 25mm right
  minY: -12500, // 12.5mm top
  maxY: 12500,  // 12.5mm bottom
  minZ: -50,    // -50µm out of focus
  maxZ: 50,     // +50µm out of focus
};

export const MAX_STEP_DELTA = {
  x: 5000, // Max 5mm per single step command
  y: 5000, // Max 5mm per single step command
  z: 100,  // Max full Z focal range (100µm) per step command
} as const;

export const VALID_OBJECTIVES: readonly ObjectiveMagnification[] = [4, 10, 20, 40];

/**
 * Validates and sanitizes an untrusted stage state payload (e.g. from P2P/WebSocket signaling).
 * Returns null if the payload is malformed, contains NaN/Infinity, or specifies an invalid objective lens.
 */
export function sanitizeStageState(
  input: unknown,
  bounds: StageBounds = DEFAULT_STAGE_BOUNDS
): StageState | null {
  if (!input || typeof input !== 'object') return null;
  const candidate = input as Record<string, unknown>;

  if (
    typeof candidate.x !== 'number' ||
    !Number.isFinite(candidate.x) ||
    typeof candidate.y !== 'number' ||
    !Number.isFinite(candidate.y) ||
    typeof candidate.z !== 'number' ||
    !Number.isFinite(candidate.z)
  ) {
    return null;
  }

  const obj = candidate.objective;
  if (typeof obj !== 'number' || !VALID_OBJECTIVES.includes(obj as ObjectiveMagnification)) {
    return null;
  }

  return {
    x: Math.max(bounds.minX, Math.min(bounds.maxX, candidate.x)),
    y: Math.max(bounds.minY, Math.min(bounds.maxY, candidate.y)),
    z: Math.max(bounds.minZ, Math.min(bounds.maxZ, candidate.z)),
    objective: obj as ObjectiveMagnification,
  };
}

export const CLINICAL_SLIDE_DIMENSIONS = {
  width: 2220,
  height: 2967,
} as const;

export interface ImagePixelCoord {
  x: number;
  y: number;
  pxPerMicronX: number;
  pxPerMicronY: number;
}

/**
 * Maps physical stage coordinates (µm) to image pixel coordinates (0..imageWidth, 0..imageHeight)
 * across the full stage travel range so 100% of the specimen is reachable.
 */
export function stageToImagePx(
  stageX: number,
  stageY: number,
  imageWidth: number,
  imageHeight: number,
  bounds: StageBounds = DEFAULT_STAGE_BOUNDS
): ImagePixelCoord {
  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  const pxPerMicronX = imageWidth / spanX;
  const pxPerMicronY = imageHeight / spanY;

  const normX = Math.max(0, Math.min(1, (stageX - bounds.minX) / spanX));
  const normY = Math.max(0, Math.min(1, (stageY - bounds.minY) / spanY));

  return {
    x: normX * imageWidth,
    y: normY * imageHeight,
    pxPerMicronX,
    pxPerMicronY,
  };
}

/**
 * Maps image pixel coordinates (0..imageWidth, 0..imageHeight) back to physical stage coordinates (µm).
 */
export function imagePxToStage(
  imgX: number,
  imgY: number,
  imageWidth: number,
  imageHeight: number,
  bounds: StageBounds = DEFAULT_STAGE_BOUNDS
): { x: number; y: number } {
  const normX = Math.max(0, Math.min(1, imgX / Math.max(1, imageWidth)));
  const normY = Math.max(0, Math.min(1, imgY / Math.max(1, imageHeight)));

  return {
    x: bounds.minX + normX * (bounds.maxX - bounds.minX),
    y: bounds.minY + normY * (bounds.maxY - bounds.minY),
  };
}

export interface ViewportProjectionOptions {
  width: number;
  height: number;
  specimenType?: 'synthetic' | 'clinical';
  imageWidth?: number;
  imageHeight?: number;
  bounds?: StageBounds;
}

/**
 * Projects a physical stage coordinate (targetX, targetY in µm) onto the microscope
 * viewport canvas (in screen pixels) given the current stage state.
 */
export function stageToViewportPx(
  targetX: number,
  targetY: number,
  currentStage: StageState,
  options: ViewportProjectionOptions
): { x: number; y: number; scaleX: number; scaleY: number } {
  const {
    width,
    height,
    specimenType = 'synthetic',
    imageWidth = CLINICAL_SLIDE_DIMENSIONS.width,
    imageHeight = CLINICAL_SLIDE_DIMENSIONS.height,
    bounds = DEFAULT_STAGE_BOUNDS,
  } = options;

  const centerX = width / 2;
  const centerY = height / 2;
  const zoomScale = currentStage.objective / 10;

  if (specimenType === 'clinical') {
    const radius = Math.min(centerX, centerY) * 0.95;
    const fovWidth = (width / zoomScale) * 0.7;
    const opticScale = (radius * 2) / fovWidth;
    const { pxPerMicronX, pxPerMicronY } = stageToImagePx(
      currentStage.x,
      currentStage.y,
      imageWidth,
      imageHeight,
      bounds
    );
    const scaleX = pxPerMicronX * opticScale;
    const scaleY = pxPerMicronY * opticScale;
    return {
      x: centerX + (targetX - currentStage.x) * scaleX,
      y: centerY + (targetY - currentStage.y) * scaleY,
      scaleX,
      scaleY,
    };
  }

  return {
    x: centerX + (targetX - currentStage.x) * zoomScale,
    y: centerY + (targetY - currentStage.y) * zoomScale,
    scaleX: zoomScale,
    scaleY: zoomScale,
  };
}

/**
 * Inverse projection: maps a viewport canvas pixel (screenX, screenY) back to
 * physical stage coordinates (µm) given the current stage state.
 */
export function viewportPxToStage(
  screenX: number,
  screenY: number,
  currentStage: StageState,
  options: ViewportProjectionOptions
): { x: number; y: number } {
  const { bounds = DEFAULT_STAGE_BOUNDS } = options;
  const centerX = options.width / 2;
  const centerY = options.height / 2;
  const { scaleX, scaleY } = stageToViewportPx(
    currentStage.x,
    currentStage.y,
    currentStage,
    options
  );

  const rawX = currentStage.x + (screenX - centerX) / scaleX;
  const rawY = currentStage.y + (screenY - centerY) / scaleY;

  return {
    x: Math.max(bounds.minX, Math.min(bounds.maxX, rawX)),
    y: Math.max(bounds.minY, Math.min(bounds.maxY, rawY)),
  };
}

export class StageController {
  private state: StageState;
  private bounds: StageBounds;
  private emergencyStop: boolean = false;

  constructor(initialState?: Partial<StageState>, bounds: StageBounds = DEFAULT_STAGE_BOUNDS) {
    this.bounds = bounds;
    this.state = {
      x: initialState?.x ?? 0,
      y: initialState?.y ?? 0,
      z: initialState?.z ?? 0,
      objective: initialState?.objective ?? 10,
    };
    this.clamp();
  }

  getState(): StageState {
    return { ...this.state };
  }

  /**
   * Engages or releases the hardware Emergency Stop (E-Stop) lock.
   * When engaged, all stage translation and focus commands are ignored.
   */
  setEmergencyStop(locked: boolean): boolean {
    this.emergencyStop = Boolean(locked);
    return this.emergencyStop;
  }

  isEmergencyStopped(): boolean {
    return this.emergencyStop;
  }

  /**
   * Translates the stage along X and Y.
   * Displacement is automatically scaled inversely by objective magnification
   * to provide fine control at high magnification and fast scanning at low magnification.
   */
  pan(dx: number, dy: number, baseSpeed: number = 20): StageState {
    if (this.emergencyStop || !Number.isFinite(dx) || !Number.isFinite(dy)) {
      return this.getState();
    }
    // Speed factor: 4x -> 10µm/tick, 40x -> 1µm/tick
    const scaleFactor = (10 / this.state.objective) * baseSpeed;
    const stepX = Math.max(-MAX_STEP_DELTA.x, Math.min(MAX_STEP_DELTA.x, dx * scaleFactor));
    const stepY = Math.max(-MAX_STEP_DELTA.y, Math.min(MAX_STEP_DELTA.y, dy * scaleFactor));
    this.state.x += stepX;
    this.state.y += stepY;
    this.clamp();
    return this.getState();
  }

  /**
   * Adjusts the fine focal plane along Z.
   */
  adjustFocus(dz: number, step: number = 1.0): StageState {
    if (this.emergencyStop || !Number.isFinite(dz)) {
      return this.getState();
    }
    const stepZ = Math.max(-MAX_STEP_DELTA.z, Math.min(MAX_STEP_DELTA.z, dz * step));
    this.state.z += stepZ;
    this.clamp();
    return this.getState();
  }

  /**
   * Selects an objective turret lens preset.
   */
  setObjective(objective: ObjectiveMagnification): StageState {
    if (this.emergencyStop || !VALID_OBJECTIVES.includes(objective)) {
      return this.getState();
    }
    this.state.objective = objective;
    return this.getState();
  }

  /**
   * Sets stage coordinates and clamps to physical bounds.
   */
  setPosition(x?: number, y?: number, z?: number): StageState {
    if (this.emergencyStop) return this.getState();
    if (x !== undefined && Number.isFinite(x)) this.state.x = x;
    if (y !== undefined && Number.isFinite(y)) this.state.y = y;
    if (z !== undefined && Number.isFinite(z)) this.state.z = z;
    this.clamp();
    return this.getState();
  }

  /**
   * Partially updates stage state from an external controller or HUD.
   */
  setState(partial: Partial<StageState>): StageState {
    if (this.emergencyStop) return this.getState();
    if (partial.x !== undefined && Number.isFinite(partial.x)) this.state.x = partial.x;
    if (partial.y !== undefined && Number.isFinite(partial.y)) this.state.y = partial.y;
    if (partial.z !== undefined && Number.isFinite(partial.z)) this.state.z = partial.z;
    if (partial.objective !== undefined && VALID_OBJECTIVES.includes(partial.objective)) {
      this.state.objective = partial.objective;
    }
    this.clamp();
    return this.getState();
  }

  reset(): StageState {
    this.state = {
      x: 0,
      y: 0,
      z: 0,
      objective: 10,
    };
    return this.getState();
  }

  private clamp(): void {
    this.state.x = Math.max(this.bounds.minX, Math.min(this.bounds.maxX, this.state.x));
    this.state.y = Math.max(this.bounds.minY, Math.min(this.bounds.maxY, this.state.y));
    this.state.z = Math.max(this.bounds.minZ, Math.min(this.bounds.maxZ, this.state.z));
  }
}
