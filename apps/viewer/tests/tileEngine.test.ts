import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateMaxLevel,
  getLevelDimensions,
  selectBestPyramidLevel,
  getVisibleTiles,
  TileCache,
  DEFAULT_WSI_METADATA,
  CLINICAL_WSI_METADATA,
} from '../src/lib/tileEngine';

test('calculateMaxLevel computes correct pyramid depth', () => {
  // 1024x1024 -> 10
  assert.equal(calculateMaxLevel(1024, 1024), 10);
  // 40960x24576 -> 16
  assert.equal(calculateMaxLevel(40960, 24576), 16);
});

test('getLevelDimensions calculates level dimensions correctly', () => {
  const maxLevel = 16;
  const baseW = 40960;
  const baseH = 24576;

  // Level 16 (Native)
  const l16 = getLevelDimensions(16, maxLevel, baseW, baseH);
  assert.equal(l16.width, 40960);
  assert.equal(l16.height, 24576);
  assert.equal(l16.scale, 1.0);

  // Level 15 (Half resolution)
  const l15 = getLevelDimensions(15, maxLevel, baseW, baseH);
  assert.equal(l15.width, 20480);
  assert.equal(l15.height, 12288);
  assert.equal(l15.scale, 0.5);

  // Level 0 (Macro thumbnail)
  const l0 = getLevelDimensions(0, maxLevel, baseW, baseH);
  assert(l0.width >= 1);
  assert(l0.height >= 1);
});

test('selectBestPyramidLevel picks correct pyramid tiers for zoom levels', () => {
  const maxLevel = 16;
  assert.equal(selectBestPyramidLevel(1.0, maxLevel), 16); // 100% zoom
  assert.equal(selectBestPyramidLevel(0.5, maxLevel), 15); // 50% zoom
  assert.equal(selectBestPyramidLevel(0.25, maxLevel), 14); // 25% zoom
  assert.equal(selectBestPyramidLevel(0.01, maxLevel), 9);
});

test('getVisibleTiles produces valid intersecting tile coordinates', () => {
  const viewport = {
    x: 20480, // Center of slide
    y: 12288,
    width: 1024,
    height: 768,
    zoom: 1.0,
  };

  const { level, tiles } = getVisibleTiles(viewport, DEFAULT_WSI_METADATA);
  assert.equal(level, 16);
  assert(tiles.length > 0);

  // Verify all tiles are within reasonable bounds
  tiles.forEach((t) => {
    assert.equal(t.level, 16);
    assert(t.col >= 0);
    assert(t.row >= 0);
  });
});

test('TileCache evicts oldest items when capacity is exceeded', () => {
  const cache = new TileCache(3);
  const mockCanvas = {} as HTMLCanvasElement;

  cache.set({ level: 16, col: 0, row: 0 }, mockCanvas);
  cache.set({ level: 16, col: 1, row: 0 }, mockCanvas);
  cache.set({ level: 16, col: 2, row: 0 }, mockCanvas);
  assert.equal(cache.size(), 3);

  // Access first item to refresh LRU
  cache.get({ level: 16, col: 0, row: 0 });

  // Add 4th item -> should evict col 1
  cache.set({ level: 16, col: 3, row: 0 }, mockCanvas);
  assert.equal(cache.size(), 3);
  assert.equal(cache.get({ level: 16, col: 1, row: 0 }), undefined);
  assert.notEqual(cache.get({ level: 16, col: 0, row: 0 }), undefined);
});

test('CLINICAL_WSI_METADATA calculates correct depth and visible tile boundaries', () => {
  assert.equal(calculateMaxLevel(CLINICAL_WSI_METADATA.width, CLINICAL_WSI_METADATA.height), 12);
  assert.equal(CLINICAL_WSI_METADATA.maxLevel, 12);

  // Test full-resolution view at level 12 (zoom = 1.0)
  const fullResViewport = {
    x: 1110,
    y: 1483.5,
    width: 900,
    height: 540,
    zoom: 1.0,
  };
  const l12Result = getVisibleTiles(fullResViewport, CLINICAL_WSI_METADATA);
  assert.equal(l12Result.level, 12);
  assert(l12Result.tiles.length > 0);
  l12Result.tiles.forEach((t) => {
    assert.equal(t.level, 12);
    assert(t.col >= 0 && t.col <= 8, `Level 12 col out of bounds: ${t.col}`);
    assert(t.row >= 0 && t.row <= 11, `Level 12 row out of bounds: ${t.row}`);
  });

  // Test low-resolution view at level 10 (zoom = 0.25)
  const lowResViewport = {
    x: 1110,
    y: 1483.5,
    width: 900,
    height: 540,
    zoom: 0.25,
  };
  const l10Result = getVisibleTiles(lowResViewport, CLINICAL_WSI_METADATA);
  assert.equal(l10Result.level, 10);
  assert(l10Result.tiles.length > 0);
  l10Result.tiles.forEach((t) => {
    assert.equal(t.level, 10);
    assert(t.col >= 0 && t.col <= 2, `Level 10 col out of bounds: ${t.col}`);
    assert(t.row >= 0 && t.row <= 2, `Level 10 row out of bounds: ${t.row}`);
  });
});

