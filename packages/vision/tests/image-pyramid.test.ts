import test from 'node:test';
import assert from 'node:assert/strict';
import { ImagePyramid, ZoomLevel, ImagePatch } from '../src/image-pyramid';

test('ImagePyramid initializes empty layers for standard microscope objectives', () => {
  const pyramid = new ImagePyramid();
  assert.equal(pyramid.getPatches(ZoomLevel.x4).length, 0);
  assert.equal(pyramid.getPatches(ZoomLevel.x10).length, 0);
  assert.equal(pyramid.getPatches(ZoomLevel.x20).length, 0);
  assert.equal(pyramid.getPatches(ZoomLevel.x40).length, 0);
});

test('ImagePyramid adds and retrieves patches at specific zoom levels', () => {
  const pyramid = new ImagePyramid();
  const mockPatch: ImagePatch = {
    x: 100,
    y: 200,
    width: 256,
    height: 256,
    data: {} as ImageData,
  };

  pyramid.addPatch(ZoomLevel.x10, mockPatch);
  const patches = pyramid.getPatches(ZoomLevel.x10);

  assert.equal(patches.length, 1);
  assert.equal(patches[0].x, 100);
  assert.equal(patches[0].y, 200);
  assert.equal(pyramid.getPatches(ZoomLevel.x40).length, 0);
});

test('ImagePyramid clear removes all stored patches', () => {
  const pyramid = new ImagePyramid();
  pyramid.addPatch(ZoomLevel.x40, { x: 0, y: 0, data: {} as ImageData });
  assert.equal(pyramid.getPatches(ZoomLevel.x40).length, 1);

  pyramid.clear();
  assert.equal(pyramid.getPatches(ZoomLevel.x40).length, 0);
});
