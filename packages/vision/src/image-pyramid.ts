export enum ZoomLevel {
  x4 = 4,
  x10 = 10,
  x20 = 20,
  x40 = 40,
}

export interface ImagePatch {
  x: number;
  y: number;
  width?: number;
  height?: number;
  data: ImageData;
}

export class ImagePyramid {
  private layers: Map<ZoomLevel, ImagePatch[]>;

  constructor() {
    this.layers = new Map();
    this.layers.set(ZoomLevel.x4, []);
    this.layers.set(ZoomLevel.x10, []);
    this.layers.set(ZoomLevel.x20, []);
    this.layers.set(ZoomLevel.x40, []);
  }

  addPatch(level: ZoomLevel, patch: ImagePatch) {
    const layer = this.layers.get(level);
    if (layer) {
      layer.push(patch);
    }
  }

  getPatches(level: ZoomLevel): ImagePatch[] {
    return this.layers.get(level) || [];
  }

  clear() {
    this.layers.set(ZoomLevel.x4, []);
    this.layers.set(ZoomLevel.x10, []);
    this.layers.set(ZoomLevel.x20, []);
    this.layers.set(ZoomLevel.x40, []);
  }
}
