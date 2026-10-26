import test from 'node:test';
import assert from 'node:assert/strict';
import {
  StageController,
  DEFAULT_STAGE_BOUNDS,
  MAX_STEP_DELTA,
  CLINICAL_SLIDE_DIMENSIONS,
  sanitizeStageState,
  stageToImagePx,
  imagePxToStage,
  stageToViewportPx,
  viewportPxToStage,
} from '../src/stage';

test('StageController initializes at default origin', () => {
  const stage = new StageController();
  const state = stage.getState();

  assert.equal(state.x, 0);
  assert.equal(state.y, 0);
  assert.equal(state.z, 0);
  assert.equal(state.objective, 10);
});

test('StageController pan scales displacement inversely with magnification', () => {
  const stage4x = new StageController({ x: 0, y: 0, objective: 4 });
  const stage40x = new StageController({ x: 0, y: 0, objective: 40 });

  stage4x.pan(1, 0, 10); // at 4x: (10/4)*10 = 25µm
  stage40x.pan(1, 0, 10); // at 40x: (10/40)*10 = 2.5µm

  assert.equal(stage4x.getState().x, 25);
  assert.equal(stage40x.getState().x, 2.5);
  assert(stage4x.getState().x > stage40x.getState().x, 'Low magnification must traverse faster than high magnification');
});

test('StageController clamps displacement to physical slide boundaries', () => {
  const stage = new StageController({ x: 24900, y: 0 });
  stage.pan(100, 0, 10); // Would push to 27400 without clamping

  assert.equal(stage.getState().x, DEFAULT_STAGE_BOUNDS.maxX);
});

test('StageController clamps focal Z plane offset', () => {
  const stage = new StageController({ z: 45 });
  stage.adjustFocus(10, 1); // 45 + 10 = 55 -> clamped to 50

  assert.equal(stage.getState().z, DEFAULT_STAGE_BOUNDS.maxZ);

  stage.adjustFocus(-150, 1); // clamped to minZ (-50)
  assert.equal(stage.getState().z, DEFAULT_STAGE_BOUNDS.minZ);
});

test('StageController sets objective lenses and resets to origin', () => {
  const stage = new StageController();
  stage.setObjective(40);
  assert.equal(stage.getState().objective, 40);

  stage.pan(10, 10);
  stage.reset();
  const resetState = stage.getState();

  assert.equal(resetState.x, 0);
  assert.equal(resetState.y, 0);
  assert.equal(resetState.z, 0);
  assert.equal(resetState.objective, 10);
});

test('StageController setPosition and setState clamp and synchronize external coordinates', () => {
  const stage = new StageController();

  stage.setPosition(1500, -2000, 12);
  const pos = stage.getState();
  assert.equal(pos.x, 1500);
  assert.equal(pos.y, -2000);
  assert.equal(pos.z, 12);

  stage.setState({ x: 99999, objective: 40 });
  const clamped = stage.getState();
  assert.equal(clamped.x, DEFAULT_STAGE_BOUNDS.maxX);
  assert.equal(clamped.objective, 40);
});

test('stageToImagePx and imagePxToStage map full stage bounds across 100% of clinical image', () => {
  const { width, height } = CLINICAL_SLIDE_DIMENSIONS;

  // Origin (0, 0) maps to image center
  const center = stageToImagePx(0, 0, width, height);
  assert.equal(center.x, width / 2);
  assert.equal(center.y, height / 2);

  // Top-left bound maps to (0, 0)
  const topLeft = stageToImagePx(DEFAULT_STAGE_BOUNDS.minX, DEFAULT_STAGE_BOUNDS.minY, width, height);
  assert.equal(topLeft.x, 0);
  assert.equal(topLeft.y, 0);

  // Bottom-right bound maps to (width, height) — 100% vertical and horizontal reachability
  const bottomRight = stageToImagePx(DEFAULT_STAGE_BOUNDS.maxX, DEFAULT_STAGE_BOUNDS.maxY, width, height);
  assert.equal(bottomRight.x, width);
  assert.equal(bottomRight.y, height);

  // Round-trip inverse mapping
  const sampleStage = { x: -8500, y: 6250 };
  const px = stageToImagePx(sampleStage.x, sampleStage.y, width, height);
  const roundTrip = imagePxToStage(px.x, px.y, width, height);
  assert(Math.abs(roundTrip.x - sampleStage.x) < 1e-6);
  assert(Math.abs(roundTrip.y - sampleStage.y) < 1e-6);
});

test('stageToViewportPx and viewportPxToStage anchor pins to physical tissue across pan and zoom', () => {
  const viewport = { width: 900, height: 540 };
  const pin = { x: 120, y: -80 };

  // 1. Synthetic mode round-trip and magnification scaling
  const stage10x = { x: 0, y: 0, z: 0, objective: 10 as const };
  const stage40x = { x: 0, y: 0, z: 0, objective: 40 as const };

  const proj10x = stageToViewportPx(pin.x, pin.y, stage10x, { ...viewport, specimenType: 'synthetic' });
  const proj40x = stageToViewportPx(pin.x, pin.y, stage40x, { ...viewport, specimenType: 'synthetic' });

  // At 40x, the pin's offset from viewport center must be 4x larger than at 10x
  assert.equal(proj40x.x - viewport.width / 2, (proj10x.x - viewport.width / 2) * 4);
  assert.equal(proj40x.y - viewport.height / 2, (proj10x.y - viewport.height / 2) * 4);

  // Round-trip from screen pixel back to physical stage µm
  const backSynthetic = viewportPxToStage(proj10x.x, proj10x.y, stage10x, {
    ...viewport,
    specimenType: 'synthetic',
  });
  assert(Math.abs(backSynthetic.x - pin.x) < 1e-6);
  assert(Math.abs(backSynthetic.y - pin.y) < 1e-6);

  // 2. Clinical mode round-trip and pan invariance
  const clinicalStage = { x: -1500, y: 900, z: 0, objective: 20 as const };
  const projClinical = stageToViewportPx(pin.x, pin.y, clinicalStage, {
    ...viewport,
    specimenType: 'clinical',
  });
  const backClinical = viewportPxToStage(projClinical.x, projClinical.y, clinicalStage, {
    ...viewport,
    specimenType: 'clinical',
  });
  assert(Math.abs(backClinical.x - pin.x) < 1e-6);
  assert(Math.abs(backClinical.y - pin.y) < 1e-6);
});

test('sanitizeStageState validates and clamps untrusted remote stage payloads', () => {
  // Valid payload within bounds
  const valid = sanitizeStageState({ x: 1200, y: -800, z: 5, objective: 20 });
  assert.deepEqual(valid, { x: 1200, y: -800, z: 5, objective: 20 });

  // Out-of-bounds coordinates are clamped to physical limits
  const clamped = sanitizeStageState({ x: 999999, y: -999999, z: 500, objective: 40 });
  assert.deepEqual(clamped, {
    x: DEFAULT_STAGE_BOUNDS.maxX,
    y: DEFAULT_STAGE_BOUNDS.minY,
    z: DEFAULT_STAGE_BOUNDS.maxZ,
    objective: 40,
  });

  // Malformed or tampered payloads return null
  assert.equal(sanitizeStageState(null), null);
  assert.equal(sanitizeStageState({ x: NaN, y: 0, z: 0, objective: 10 }), null);
  assert.equal(sanitizeStageState({ x: Infinity, y: 0, z: 0, objective: 10 }), null);
  assert.equal(sanitizeStageState({ x: 0, y: 0, z: 0, objective: 99 }), null);
  assert.equal(sanitizeStageState({ x: '100', y: 0, z: 0, objective: 10 }), null);
});

test('StageController enforces instantaneous step delta limits and Emergency Stop (E-Stop)', () => {
  const stage = new StageController({ x: 0, y: 0, z: 0, objective: 10 });

  // Single massive step spike is bounded by MAX_STEP_DELTA
  stage.pan(10000, -10000, 20);
  assert.equal(stage.getState().x, MAX_STEP_DELTA.x);
  assert.equal(stage.getState().y, -MAX_STEP_DELTA.y);

  // Engage E-Stop: all subsequent pan, focus, and setPosition calls must be ignored
  stage.setEmergencyStop(true);
  assert.equal(stage.isEmergencyStopped(), true);

  stage.pan(50, 50, 20);
  stage.adjustFocus(10, 1);
  stage.setPosition(0, 0, 0);
  stage.setObjective(40);

  assert.equal(stage.getState().x, MAX_STEP_DELTA.x);
  assert.equal(stage.getState().y, -MAX_STEP_DELTA.y);
  assert.equal(stage.getState().z, 0);
  assert.equal(stage.getState().objective, 10);

  // Release E-Stop: stage movement resumes normally
  stage.setEmergencyStop(false);
  stage.setPosition(100, -100, 5);
  assert.equal(stage.getState().x, 100);
  assert.equal(stage.getState().y, -100);
  assert.equal(stage.getState().z, 5);
});




