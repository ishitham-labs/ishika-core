export interface TileCoordinate {
  level: number;
  col: number;
  row: number;
}

export interface ViewportRect {
  x: number;      // Center X in slide base coordinates (0 to width)
  y: number;      // Center Y in slide base coordinates (0 to height)
  width: number;  // Viewport width in pixels
  height: number; // Viewport height in pixels
  zoom: number;   // Zoom factor (e.g. 1.0 = 100%, 0.1 = 10%)
}

export interface PyramidMetadata {
  width: number;    // Full gigapixel width (e.g. 50,000 px)
  height: number;   // Full gigapixel height (e.g. 35,000 px)
  tileSize: number; // Standard tile size, usually 256 px
  maxLevel: number; // Highest pyramid level (e.g. 16)
}

export const DEFAULT_WSI_METADATA: PyramidMetadata = {
  width: 40960,
  height: 24576,
  tileSize: 256,
  maxLevel: 16,
};

export const CLINICAL_WSI_METADATA: PyramidMetadata = {
  width: 2220,
  height: 2967,
  tileSize: 256,
  maxLevel: 12,
};

/**
 * Calculates the maximum pyramid level for given dimensions and tile size.
 */
export function calculateMaxLevel(width: number, height: number): number {
  const maxDim = Math.max(width, height);
  return Math.ceil(Math.log2(maxDim));
}

/**
 * Calculates dimensions of an image pyramid level L.
 */
export function getLevelDimensions(level: number, maxLevel: number, baseWidth: number, baseHeight: number) {
  const scale = Math.pow(2, level - maxLevel);
  return {
    width: Math.max(1, Math.ceil(baseWidth * scale)),
    height: Math.max(1, Math.ceil(baseHeight * scale)),
    scale,
  };
}

/**
 * Determines which pyramid level to sample given the current viewport zoom.
 */
export function selectBestPyramidLevel(zoom: number, maxLevel: number): number {
  // Zoom 1.0 corresponds to maxLevel (native 40x cellular resolution)
  const targetLevel = maxLevel + Math.log2(Math.max(0.001, zoom));
  return Math.max(0, Math.min(maxLevel, Math.round(targetLevel)));
}

/**
 * Calculates which tile coordinates (col, row) intersect the visible viewport.
 */
export function getVisibleTiles(
  viewport: ViewportRect,
  metadata: PyramidMetadata
): { level: number; tiles: TileCoordinate[] } {
  const level = selectBestPyramidLevel(viewport.zoom, metadata.maxLevel);
  const { width: levelWidth, height: levelHeight, scale } = getLevelDimensions(
    level,
    metadata.maxLevel,
    metadata.width,
    metadata.height
  );

  // Viewport bounding box in level coordinates
  const levelCenterX = viewport.x * scale;
  const levelCenterY = viewport.y * scale;
  const levelViewW = viewport.width / (viewport.zoom / scale);
  const levelViewH = viewport.height / (viewport.zoom / scale);

  const minX = Math.max(0, levelCenterX - levelViewW / 2);
  const maxX = Math.min(levelWidth, levelCenterX + levelViewW / 2);
  const minY = Math.max(0, levelCenterY - levelViewH / 2);
  const maxY = Math.min(levelHeight, levelCenterY + levelViewH / 2);

  const minCol = Math.floor(minX / metadata.tileSize);
  const maxCol = Math.min(Math.ceil(levelWidth / metadata.tileSize) - 1, Math.floor(maxX / metadata.tileSize));
  const minRow = Math.floor(minY / metadata.tileSize);
  const maxRow = Math.min(Math.ceil(levelHeight / metadata.tileSize) - 1, Math.floor(maxY / metadata.tileSize));

  const tiles: TileCoordinate[] = [];
  for (let c = minCol; c <= maxCol; c++) {
    for (let r = minRow; r <= maxRow; r++) {
      tiles.push({ level, col: c, row: r });
    }
  }

  return { level, tiles };
}

/**
 * In-memory LRU tile cache to prevent memory leaks during deep zoom.
 */
export class TileCache<T = HTMLCanvasElement | HTMLImageElement> {
  private cache = new Map<string, T>();
  private maxItems: number;

  constructor(maxItems: number = 150) {
    this.maxItems = maxItems;
  }

  private getKey(coord: TileCoordinate): string {
    return `${coord.level}_${coord.col}_${coord.row}`;
  }

  get(coord: TileCoordinate): T | undefined {
    const key = this.getKey(coord);
    const item = this.cache.get(key);
    if (item) {
      // Refresh LRU order
      this.cache.delete(key);
      this.cache.set(key, item);
    }
    return item;
  }

  set(coord: TileCoordinate, canvas: T): void {
    const key = this.getKey(coord);
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxItems) {
      // Evict oldest item
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(key, canvas);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

/**
 * Synthesizes a high-fidelity histology biopsy tile for the demo with zero network latency.
 * Generates synthetic benchmark tissue with cellular nuclei and eosin stroma.
 */
export function synthesizeHistologyTile(
  coord: TileCoordinate,
  tileSize: number = 256
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = tileSize;
  canvas.height = tileSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const { level, col, row } = coord;
  // Procedural spatial seed
  const seed = Math.sin(col * 37.1 + row * 83.7 + level * 13.9) * 43758.5453;
  const rand = seed - Math.floor(seed);

  // --- SYNTHETIC BENCHMARK H&E ---
  ctx.fillStyle = '#fcf8fa';
  ctx.fillRect(0, 0, tileSize, tileSize);

  // Draw eosin stroma tissue strands
  ctx.fillStyle = 'rgba(235, 160, 190, 0.45)';
  for (let i = 0; i < 4; i++) {
    const ox = ((col * 13 + i * 67) % tileSize);
    const oy = ((row * 17 + i * 59) % tileSize);
    ctx.beginPath();
    ctx.ellipse(ox, oy, 80 + rand * 40, 50 + rand * 30, (i + rand) * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  // Draw hematoxylin cell nuclei
  const cellCount = Math.floor(18 + rand * 24);
  ctx.fillStyle = 'rgba(78, 38, 122, 0.82)';

  for (let c = 0; c < cellCount; c++) {
    const cx = ((col * 31 + c * 43) % tileSize);
    const cy = ((row * 47 + c * 37) % tileSize);
    const rad = level >= 14 ? (4 + (c % 3)) : Math.max(1.5, (level / 16) * 3);

    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fill();
  }

  // Debug tile boundary mark (very subtle)
  ctx.strokeStyle = 'rgba(203, 213, 225, 0.2)';
  ctx.strokeRect(0, 0, tileSize, tileSize);

  return canvas;
}
