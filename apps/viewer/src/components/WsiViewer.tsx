import { useRef, useEffect, useState, useCallback } from 'react';
import { stageToImagePx, imagePxToStage } from '@ishika/simulator';
import type { PointerAnnotation } from './InteractiveOverlay';
import {
  DEFAULT_WSI_METADATA,
  CLINICAL_WSI_METADATA,
  getVisibleTiles,
  synthesizeHistologyTile,
  TileCache,
  ViewportRect,
} from '../lib/tileEngine';

export interface WsiViewerProps {
  width?: number;
  height?: number;
  stageX?: number; // µm
  stageY?: number; // µm
  specimenType?: 'synthetic' | 'clinical';
  pointers?: PointerAnnotation[];
  onPointerClick?: (stageX: number, stageY: number) => void;
  onStageChange?: (x: number, y: number) => void;
  captureTrigger?: number;
  onSnapshot?: (dataUrl: string) => void;
}

export function WsiViewer({
  width = 860,
  height = 540,
  stageX = 0,
  stageY = 0,
  specimenType = 'clinical',
  pointers = [],
  onPointerClick,
  onStageChange,
  captureTrigger = 0,
  onSnapshot,
}: WsiViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cacheRef = useRef<TileCache<CanvasImageSource>>(new TileCache(200));
  const isDraggingRef = useRef<boolean>(false);
  const dragMovedRef = useRef<boolean>(false);
  const downPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const lastMousePosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const pendingTilesRef = useRef<Set<string>>(new Set());
  const onSnapshotRef = useRef<typeof onSnapshot>(onSnapshot);
  onSnapshotRef.current = onSnapshot;

  const clinicalImgRef = useRef<HTMLImageElement | null>(null);

  const [zoom, setZoom] = useState<number>(0.25);
  const [activeLevel, setActiveLevel] = useState<number>(14);
  const [renderedTilesCount, setRenderedTilesCount] = useState<number>(0);
  const [loadedTilesCount, setLoadedTilesCount] = useState<number>(0);
  const [imageLoaded, setImageLoaded] = useState<boolean>(false);
  const [tileRevision, setTileRevision] = useState<number>(0);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  const metadata = specimenType === 'clinical' ? CLINICAL_WSI_METADATA : DEFAULT_WSI_METADATA;

  // Preload authentic clinical whole slide image overview
  useEffect(() => {
    let active = true;
    const img = new Image();
    img.src = './specimens/clinical_slide.webp';
    img.onload = () => {
      if (!active) return;
      clinicalImgRef.current = img;
      setImageLoaded(true);
    };
    img.onerror = () => {
      const fallback = new Image();
      fallback.src = '/specimens/clinical_slide.webp';
      fallback.onload = () => {
        if (!active) return;
        clinicalImgRef.current = fallback;
        setImageLoaded(true);
      };
    };
    return () => {
      active = false;
    };
  }, []);

  // Convert stage µm coordinates to slide pixel coordinates (0..width, 0..height)
  const {
    x: baseSlideX,
    y: baseSlideY,
    pxPerMicronX,
    pxPerMicronY,
  } = stageToImagePx(stageX, stageY, metadata.width, metadata.height);

  const renderFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const viewport: ViewportRect = {
      x: baseSlideX,
      y: baseSlideY,
      width,
      height,
      zoom,
    };

    const { level, tiles } = getVisibleTiles(viewport, metadata);
    setActiveLevel(level);
    setRenderedTilesCount(tiles.length);

    // Clear viewport background
    ctx.fillStyle = '#0a0f1d';
    ctx.fillRect(0, 0, width, height);

    // Calculate scale and level dimensions
    const scale = Math.pow(2, level - metadata.maxLevel);
    const viewScale = zoom / scale;

    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.scale(viewScale, viewScale);
    ctx.translate(-baseSlideX * scale, -baseSlideY * scale);

    // Glass slide base illumination
    ctx.fillStyle = '#fdf8fa';
    ctx.fillRect(0, 0, metadata.width * scale, metadata.height * scale);

    let loadedCount = 0;

    if (specimenType === 'clinical') {
      // 1. Draw base whole-slide photograph as continuous backdrop
      if (clinicalImgRef.current && clinicalImgRef.current.complete) {
        ctx.drawImage(
          clinicalImgRef.current,
          0,
          0,
          metadata.width * scale,
          metadata.height * scale
        );
      }

      // 2. Render razor-sharp DZI pyramidal tiles (levels 10, 11, 12)
      if (level >= 10) {
        const tileLevel = Math.min(12, level);
        tiles.forEach((coord) => {
          const tileCoord = { level: tileLevel, col: coord.col, row: coord.row };
          const cachedTile = cacheRef.current.get(tileCoord);

          const destX = coord.col * metadata.tileSize;
          const destY = coord.row * metadata.tileSize;

          if (cachedTile) {
            loadedCount++;
            ctx.drawImage(cachedTile, destX, destY, metadata.tileSize, metadata.tileSize);
          } else {
            const tileKey = `${tileLevel}_${coord.col}_${coord.row}`;
            if (!pendingTilesRef.current.has(tileKey)) {
              pendingTilesRef.current.add(tileKey);
              const tileImg = new Image();
              tileImg.src = `./specimens/clinical_tiles/${tileLevel}/${coord.col}_${coord.row}.webp`;
              tileImg.onload = () => {
                cacheRef.current.set(tileCoord, tileImg);
                pendingTilesRef.current.delete(tileKey);
                setTileRevision((rev) => rev + 1);
              };
              tileImg.onerror = () => {
                pendingTilesRef.current.delete(tileKey);
              };
            }
          }

          // Subtle DZI tile boundary HUD
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.15)';
          ctx.lineWidth = 1;
          ctx.strokeRect(destX, destY, metadata.tileSize, metadata.tileSize);
        });
      } else if (clinicalImgRef.current && clinicalImgRef.current.complete) {
        loadedCount = tiles.length;
      }
    } else {
      // Render synthetic procedural tiles
      tiles.forEach((coord) => {
        let tileCanvas = cacheRef.current.get(coord);
        if (!tileCanvas) {
          tileCanvas = synthesizeHistologyTile(coord, metadata.tileSize);
          cacheRef.current.set(coord, tileCanvas);
        }
        loadedCount++;

        const destX = coord.col * metadata.tileSize;
        const destY = coord.row * metadata.tileSize;
        ctx.drawImage(tileCanvas, destX, destY);
      });
    }

    setLoadedTilesCount(loadedCount);
    ctx.restore();

    // Draw stage-anchored Pathologist Pins in WSI screen space
    if (pointers.length > 0) {
      ctx.save();
      pointers.forEach((p) => {
        const { x: annSlideX, y: annSlideY } = stageToImagePx(
          p.stageX,
          p.stageY,
          metadata.width,
          metadata.height
        );
        const px = width / 2 + (annSlideX - baseSlideX) * zoom;
        const py = height / 2 + (annSlideY - baseSlideY) * zoom;

        if (px < -30 || px > width + 30 || py < -30 || py > height + 30) return;

        ctx.beginPath();
        ctx.arc(px, py, 14, 0, Math.PI * 2);
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(px, py, 4, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();

        if (p.label) {
          ctx.font = '11px system-ui, sans-serif';
          ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
          const textWidth = ctx.measureText(p.label).width;
          ctx.fillRect(px + 10, py - 18, textWidth + 8, 18);

          ctx.fillStyle = '#ffffff';
          ctx.fillText(p.label, px + 14, py - 5);
        }
      });
      ctx.restore();
    }
  }, [baseSlideX, baseSlideY, width, height, zoom, specimenType, metadata, imageLoaded, pointers]);

  // Clear tile cache only when switching specimen modes
  useEffect(() => {
    cacheRef.current.clear();
    pendingTilesRef.current.clear();
  }, [specimenType]);

  // Redraw canvas whenever viewport parameters or loaded tiles update
  useEffect(() => {
    renderFrame();
  }, [renderFrame, tileRevision]);

  // Support manual "Capture Biopsy" button trigger when WSI tab is active
  useEffect(() => {
    if (captureTrigger > 0 && canvasRef.current && onSnapshotRef.current) {
      const dataUrl = canvasRef.current.toDataURL('image/jpeg', 0.95);
      onSnapshotRef.current(dataUrl);
    }
  }, [captureTrigger]);

  // Support Spacebar snapshot capture when WSI tab is active
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) {
        return;
      }
      if (e.key === ' ' && canvasRef.current && onSnapshotRef.current) {
        e.preventDefault();
        const dataUrl = canvasRef.current.toDataURL('image/jpeg', 0.95);
        onSnapshotRef.current(dataUrl);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Mouse wheel zoom handler
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 0.85;
    setZoom((prev) => Math.max(0.02, Math.min(2.5, prev * factor)));
  };

  // Drag-to-pan and click-to-pin handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    isDraggingRef.current = true;
    dragMovedRef.current = false;
    downPosRef.current = { x: e.clientX, y: e.clientY };
    lastMousePosRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingRef.current) return;

    const totalDist = Math.hypot(
      e.clientX - downPosRef.current.x,
      e.clientY - downPosRef.current.y
    );
    if (totalDist > 4) {
      dragMovedRef.current = true;
      if (!isDragging) setIsDragging(true);
    }

    const rect = canvasRef.current?.getBoundingClientRect();
    const scaleX = rect ? width / Math.max(1, rect.width) : 1;
    const scaleY = rect ? height / Math.max(1, rect.height) : 1;
    const dx = (e.clientX - lastMousePosRef.current.x) * scaleX;
    const dy = (e.clientY - lastMousePosRef.current.y) * scaleY;
    lastMousePosRef.current = { x: e.clientX, y: e.clientY };

    // Update parent stage position in µm using exact axis-specific px-to-micron ratio
    if (dragMovedRef.current && onStageChange) {
      const stepMicronsX = (1 / zoom) * (1 / pxPerMicronX);
      const stepMicronsY = (1 / zoom) * (1 / pxPerMicronY);
      onStageChange(stageX - dx * stepMicronsX, stageY - dy * stepMicronsY);
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    setIsDragging(false);

    if (!dragMovedRef.current && onPointerClick && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const clickX = ((e.clientX - rect.left) / Math.max(1, rect.width)) * width;
      const clickY = ((e.clientY - rect.top) / Math.max(1, rect.height)) * height;

      const clickSlideX = baseSlideX + (clickX - width / 2) / zoom;
      const clickSlideY = baseSlideY + (clickY - height / 2) / zoom;

      const { x: targetStageX, y: targetStageY } = imagePxToStage(
        clickSlideX,
        clickSlideY,
        metadata.width,
        metadata.height
      );
      onPointerClick(targetStageX, targetStageY);
    }
  };

  const handleMouseLeave = () => {
    isDraggingRef.current = false;
    setIsDragging(false);
  };

  return (
    <div style={{
      position: 'relative',
      width: '100%',
      height: '100%',
      maxWidth: `${width}px`,
      aspectRatio: `${width} / ${height}`,
      borderRadius: '12px',
      overflow: 'hidden',
      border: '1px solid #1e293b',
      margin: '0 auto',
      display: 'block',
    }}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        style={{ width: '100%', height: '100%', display: 'block', cursor: isDragging ? 'grabbing' : 'grab' }}
      />

      {/* WSI Pyramidal Telemetry HUD */}
      <div style={{
        position: 'absolute',
        top: '12px',
        left: '12px',
        background: 'rgba(15, 23, 42, 0.88)',
        backdropFilter: 'blur(8px)',
        border: '1px solid rgba(51, 65, 85, 0.8)',
        borderRadius: '8px',
        padding: '6px 10px',
        fontSize: 'clamp(9px, 1.8vw, 11px)',
        fontFamily: 'monospace',
        color: '#f8fafc',
        pointerEvents: 'none',
        maxWidth: 'calc(100% - 24px)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#38bdf8', flexShrink: 0 }} />
          <span>
            <strong>
              {specimenType === 'clinical'
                ? 'PYRAMIDAL WSI (Aperio CMU-1 · 2220×2967 DZI):'
                : 'GIGAPIXEL WSI (40960×24576 Procedural):'}
            </strong>{' '}
            Level {activeLevel}/{metadata.maxLevel} | {loadedTilesCount}/{renderedTilesCount} tiles loaded | Zoom: {(zoom * 100).toFixed(0)}%
          </span>
        </div>
      </div>
    </div>
  );
}

