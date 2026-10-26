import { stageToImagePx, type StageState } from './stage';

export type SpecimenMode = 'synthetic' | 'clinical';

export interface OpticsRenderOptions {
  width: number;
  height: number;
  showReticle?: boolean;
  showScaleBar?: boolean;
  specimenType?: SpecimenMode;
  clinicalImage?: HTMLImageElement | null;
}

/**
 * Renders a simulated histopathology microscope field of view onto an HTML5 2D canvas context.
 * Cell positions are procedurally anchored to physical slide coordinates (x, y) so moving the
 * stage produces seamless, deterministic panning over a synthetic or real clinical biopsy specimen.
 */
export function renderMicroscopeView(
  ctx: CanvasRenderingContext2D,
  stage: StageState,
  options: OpticsRenderOptions
): void {
  const {
    width,
    height,
    showReticle = true,
    showScaleBar = true,
    specimenType = 'clinical',
    clinicalImage = null,
  } = options;
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(centerX, centerY) * 0.95;

  ctx.save();
  ctx.clearRect(0, 0, width, height);

  // 1. Draw outer black microscope casing
  ctx.fillStyle = '#05070a';
  ctx.fillRect(0, 0, width, height);

  // 2. Clip to circular optical aperture (Eyepiece field of view)
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.clip();

  // 3. Apply optical focus blur based on Z focal plane offset
  const blurAmount = Math.min(12, Math.abs(stage.z) * 0.35);
  ctx.filter = blurAmount > 0.5 ? `blur(${blurAmount.toFixed(1)}px)` : 'none';

  // 4. Glass slide background with slight warm condenser illumination
  const condenserGradient = ctx.createRadialGradient(
    centerX, centerY, radius * 0.1,
    centerX, centerY, radius
  );
  condenserGradient.addColorStop(0, '#fffbf7');
  condenserGradient.addColorStop(0.7, '#fbf4f6');
  condenserGradient.addColorStop(1, '#ebdbe3');
  ctx.fillStyle = condenserGradient;
  ctx.fillRect(0, 0, width, height);

  // 5. Render tissue biopsy (Real Photographic Slide vs Synthetic Benchmark)
  const zoomScale = stage.objective / 10;

  if (specimenType === 'clinical' && clinicalImage && clinicalImage.complete && clinicalImage.naturalWidth > 0) {
    // --- REAL CLINICAL WHOLE SLIDE PHOTOGRAPH (Aperio CMU-1 Brightfield H&E) ---
    const imgW = clinicalImage.naturalWidth;
    const imgH = clinicalImage.naturalHeight;

    // Field of view in real slide pixels inversely proportional to magnification
    // 4x: wide tissue architecture; 40x: deep zoom into cellular nuclei
    const fovWidth = (width / zoomScale) * 0.7;

    // Map physical stage coordinates in microns to real slide image pixel coordinates
    const { x: centerImgX, y: centerImgY } = stageToImagePx(stage.x, stage.y, imgW, imgH);

    ctx.save();
    ctx.translate(centerX, centerY);
    const scale = (radius * 2) / fovWidth;
    ctx.scale(scale, scale);
    ctx.drawImage(clinicalImage, -centerImgX, -centerImgY);
    ctx.restore();
  } else {
    // Render procedural tissue stroma & nuclei
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.scale(zoomScale, zoomScale);
    ctx.translate(-stage.x, -stage.y);

    const stromaGrid = 400;
    const startX = Math.floor((stage.x - width / zoomScale) / stromaGrid) * stromaGrid;
    const endX = Math.ceil((stage.x + width / zoomScale) / stromaGrid) * stromaGrid;
    const startY = Math.floor((stage.y - height / zoomScale) / stromaGrid) * stromaGrid;
    const endY = Math.ceil((stage.y + height / zoomScale) / stromaGrid) * stromaGrid;

    for (let gx = startX; gx <= endX; gx += stromaGrid) {
      for (let gy = startY; gy <= endY; gy += stromaGrid) {
        // Deterministic pseudo-random seed per grid cell
        const seed = Math.sin(gx * 12.9898 + gy * 78.233) * 43758.5453;
        const rand = seed - Math.floor(seed);

        // --- SYNTHETIC BENCHMARK H&E ---
        // Draw eosin tissue background patch
        ctx.beginPath();
        ctx.ellipse(gx + 150, gy + 150, 220 + rand * 80, 160 + rand * 60, rand * Math.PI, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(236, 172, 198, 0.45)';
        ctx.fill();

        // Draw cellular nuclei clusters (Hematoxylin deep purple/blue)
        const numCells = 12 + Math.floor(rand * 15);
        for (let c = 0; c < numCells; c++) {
          const cellAngle = (c / numCells) * Math.PI * 2;
          const cellDist = 40 + ((c * 17) % 120);
          const cellX = gx + 150 + Math.cos(cellAngle) * cellDist;
          const cellY = gy + 150 + Math.sin(cellAngle) * cellDist;
          const cellRadius = 6 + ((c * 7) % 5);

          // Nucleus
          ctx.beginPath();
          ctx.ellipse(cellX, cellY, cellRadius, cellRadius * 0.85, c * 0.5, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(74, 35, 118, 0.85)'; // Deep purple
          ctx.fill();

          // Nuclear chromatin detail visible at 20x and 40x
          if (stage.objective >= 20) {
            ctx.beginPath();
            ctx.arc(cellX - 1, cellY - 1, cellRadius * 0.35, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(40, 18, 68, 0.95)';
            ctx.fill();
          }
        }
      }
    }

    ctx.restore(); // Restore tissue coordinate transform
  }

  // 6. Optical Edge Vignetting
  ctx.filter = 'none';
  const edgeVignette = ctx.createRadialGradient(
    centerX, centerY, radius * 0.7,
    centerX, centerY, radius
  );
  edgeVignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
  edgeVignette.addColorStop(0.85, 'rgba(15, 23, 42, 0.25)');
  edgeVignette.addColorStop(1, 'rgba(5, 7, 10, 0.85)');
  ctx.fillStyle = edgeVignette;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore(); // Restore circular aperture clip

  // 7. Reticle Crosshair (Optional Pathology Eyepiece Alignment)
  if (showReticle) {
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
    ctx.lineWidth = 1;

    // Center crosshair
    ctx.beginPath();
    ctx.moveTo(centerX - 25, centerY);
    ctx.lineTo(centerX + 25, centerY);
    ctx.moveTo(centerX, centerY - 25);
    ctx.lineTo(centerX, centerY + 25);
    ctx.stroke();

    // Center targeting ring
    ctx.beginPath();
    ctx.arc(centerX, centerY, 12, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 8. Physical Micron Scale Bar
  if (showScaleBar) {
    const scaleBarMicrons = stage.objective === 40 ? 25 : stage.objective === 20 ? 50 : 100;
    const pixelsPerMicron = (zoomScale * 1);
    const barWidthPx = scaleBarMicrons * pixelsPerMicron;

    const barX = width - barWidthPx - 40;
    const barY = height - 40;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
    ctx.fillRect(barX - 10, barY - 22, barWidthPx + 20, 32);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(barX, barY, barWidthPx, 4);

    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${scaleBarMicrons} µm`, barX + barWidthPx / 2, barY - 6);
  }
}
