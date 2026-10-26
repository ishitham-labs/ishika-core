import { useState, useEffect, useRef, useCallback } from 'react';

export interface UseLiveStreamOptions {
  stream?: MediaStream | null;
  onFrame?: (imageData: ImageData) => void;
}

export interface UseLiveStreamResult {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  isConnected: boolean;
  resolution: { width: number; height: number };
  captureSnapshot: () => string | null;
  captureImageData: () => ImageData | null;
}

export function useLiveStream({
  stream = null,
  onFrame: _onFrame,
}: UseLiveStreamOptions = {}): UseLiveStreamResult {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [resolution, setResolution] = useState<{ width: number; height: number }>({
    width: 1920,
    height: 1080,
  });

  // Attach MediaStream to hidden or visible video element
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) {
      setIsConnected(false);
      return;
    }

    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;

    const handleLoadedMetadata = () => {
      setResolution({
        width: video.videoWidth || 1920,
        height: video.videoHeight || 1080,
      });
      setIsConnected(true);
      video.play().catch((err: unknown) => {
        console.warn('Video autoplay prevented:', err);
      });
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata);

    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      if (video.srcObject) {
        video.srcObject = null;
      }
    };
  }, [stream]);

  // Capture current video frame to Base64 data URL
  const captureSnapshot = useCallback((): string | null => {
    const video = videoRef.current;
    if (!video || !isConnected) return null;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1920;
    canvas.height = video.videoHeight || 1080;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.95);
  }, [isConnected]);

  // Capture current video frame to raw ImageData
  const captureImageData = useCallback((): ImageData | null => {
    const video = videoRef.current;
    if (!video || !isConnected) return null;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1920;
    canvas.height = video.videoHeight || 1080;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }, [isConnected]);

  return {
    videoRef,
    canvasRef,
    isConnected,
    resolution,
    captureSnapshot,
    captureImageData,
  };
}
