import { useRef, useEffect, useState } from 'react';
import {
  CLINICAL_SLIDE_DIMENSIONS,
  stageToImagePx,
  imagePxToStage,
  type StageState,
} from '@ishika/simulator';

export interface MinimapProps {
  currentStage: StageState;
  onNavigate?: (x: number, y: number) => void;
  width?: number;
  height?: number;
  specimenType?: 'synthetic' | 'clinical';
}

function getSpecimenRect(
  width: number,
  height: number,
  specimenType: 'synthetic' | 'clinical',
  img: HTMLImageElement | null
) {
  const specimenAreaX = 45;
  const specimenAreaY = 4;
  const specimenAreaW = width - 45 - 4;
  const specimenAreaH = height - 8;

  if (specimenType === 'clinical') {
    const aspect =
      img && img.complete && img.naturalHeight > 0
        ? img.naturalWidth / img.naturalHeight
        : CLINICAL_SLIDE_DIMENSIONS.width / CLINICAL_SLIDE_DIMENSIONS.height;
    const targetH = specimenAreaH * 0.86;
    const targetW = targetH * aspect;
    const drawX = specimenAreaX + (specimenAreaW - targetW) / 2;
    const drawY = specimenAreaY + (specimenAreaH - targetH) / 2;
    return { x: drawX, y: drawY, w: targetW, h: targetH };
  }

  return { x: specimenAreaX, y: specimenAreaY, w: specimenAreaW, h: specimenAreaH };
}

export function Minimap({
  currentStage,
  onNavigate,
  width = 240,
  height = 120,
  specimenType = 'clinical',
}: MinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const clinicalImgRef = useRef<HTMLImageElement | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);

  // Preload authentic clinical whole slide photograph for macro minimap
  useEffect(() => {
    const img = new Image();
    img.src = './specimens/clinical_slide.webp';
    img.onload = () => {
      clinicalImgRef.current = img;
      setImageLoaded(true);
    };
    img.onerror = () => {
      const fallback = new Image();
      fallback.src = '/specimens/clinical_slide.webp';
      fallback.onload = () => {
        clinicalImgRef.current = fallback;
        setImageLoaded(true);
      };
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    // 1. Glass Slide Base (Frosted white/glass border)
    ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.strokeRect(1, 1, width - 2, height - 2);

    // Label area on left (Standard slide frosted glass end)
    ctx.fillStyle = 'rgba(51, 65, 85, 0.4)';
    ctx.fillRect(2, 2, 40, height - 4);
    ctx.fillStyle = specimenType === 'clinical' ? '#ec4899' : '#64748b';
    ctx.font = '8px monospace';
    ctx.save();
    ctx.translate(22, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText(specimenType === 'clinical' ? 'APERIO-CMU1' : 'BENCH-01', 0, 3);
    ctx.restore();

    // 2. Tissue Specimen Region (Center-Right)
    const specimenAreaX = 45;
    const specimenAreaW = width - 45 - 4;
    const specimenAreaH = height - 8;
    const activeRect = getSpecimenRect(width, height, specimenType, clinicalImgRef.current);

    if (specimenType === 'clinical' && clinicalImgRef.current && clinicalImgRef.current.complete) {
      // Draw authentic Aperio whole slide tissue photograph
      const img = clinicalImgRef.current;

      ctx.save();
      // Clip within specimen glass slide area
      ctx.beginPath();
      ctx.rect(specimenAreaX + 2, 4, specimenAreaW - 4, specimenAreaH);
      ctx.clip();

      // Translucent slide glass background
      ctx.fillStyle = '#fdf8fa';
      ctx.fillRect(specimenAreaX + 2, 4, specimenAreaW - 4, specimenAreaH);

      // Render genuine Aperio whole-slide photograph
      ctx.drawImage(img, activeRect.x, activeRect.y, activeRect.w, activeRect.h);
      ctx.restore();
    } else {
      // Draw procedural synthetic tissue ellipses
      const tissueCenterX = 45 + (width - 45) / 2;
      const tissueCenterY = height / 2;

      ctx.fillStyle = 'rgba(236, 172, 198, 0.5)';
      ctx.beginPath();
      ctx.ellipse(tissueCenterX, tissueCenterY, 65, 35, 0, 0, Math.PI * 2);
      ctx.fill();

      // Secondary tissue fragment
      ctx.beginPath();
      ctx.ellipse(tissueCenterX + 25, tissueCenterY - 15, 25, 18, 0.4, 0, Math.PI * 2);
      ctx.fill();
    }

    // 3. Current Microscope Viewport Indicator (Red / Blue Target Rectangle)
    const { x: relX, y: relY } = stageToImagePx(
      currentStage.x,
      currentStage.y,
      activeRect.w,
      activeRect.h
    );
    const centerMapX = activeRect.x + relX;
    const centerMapY = activeRect.y + relY;

    // Viewport box dimensions in minimap coordinates based on objective
    const viewW = Math.max(12, (40 / currentStage.objective) * 16);
    const viewH = Math.max(8, (40 / currentStage.objective) * 10);

    const vpX = centerMapX - viewW / 2;
    const vpY = centerMapY - viewH / 2;

    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(vpX, vpY, viewW, viewH);

    // Center focal dot
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.arc(centerMapX, centerMapY, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }, [currentStage, width, height, specimenType, imageLoaded]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onNavigate || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = width / Math.max(1, rect.width);
    const scaleY = height / Math.max(1, rect.height);
    const clickX = (e.clientX - rect.left) * scaleX;
    const clickY = (e.clientY - rect.top) * scaleY;

    // Only allow navigation in specimen area (right of label)
    if (clickX < 45) return;

    const activeRect = getSpecimenRect(width, height, specimenType, clinicalImgRef.current);
    const { x: targetX, y: targetY } = imagePxToStage(
      clickX - activeRect.x,
      clickY - activeRect.y,
      activeRect.w,
      activeRect.h
    );

    onNavigate(targetX, targetY);
  };

  return (
    <div style={{ position: 'relative', display: 'inline-block', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 4px 12px rgba(0,0,0,0.5)', maxWidth: '100%' }}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        onClick={handleClick}
        style={{ display: 'block', cursor: 'pointer', maxWidth: '100%', height: 'auto', aspectRatio: `${width} / ${height}` }}
        title="Whole Slide Minimap - Click to jump stage position"
      />
      <div style={{
        position: 'absolute',
        top: '4px',
        right: '6px',
        fontSize: '10px',
        fontFamily: 'monospace',
        color: '#94a3b8',
        pointerEvents: 'none'
      }}>
        MACRO MAP
      </div>
    </div>
  );
}
