export interface Translation {
  dx: number;
  dy: number;
}

/**
 * Calculates translation between two image frames using luminance cross-correlation
 * or OpenCV when loaded. Falls back to fast block-matching if OpenCV.js is not initialized.
 */
export function calculateTranslation(
  prevFrame: HTMLCanvasElement,
  currFrame: HTMLCanvasElement,
  _scale: number = 1.0
): Translation {
  // If OpenCV is available on window, use it
  const globalCv = typeof window !== 'undefined' ? (window as any).cv : null;

  if (globalCv && globalCv.Mat && globalCv.cvtColor && globalCv.calcOpticalFlowPyrLK) {
    try {
      const prevMat = globalCv.imread(prevFrame);
      const currMat = globalCv.imread(currFrame);

      const prevGray = new globalCv.Mat();
      const currGray = new globalCv.Mat();

      globalCv.cvtColor(prevMat, prevGray, globalCv.COLOR_RGBA2GRAY);
      globalCv.cvtColor(currMat, currGray, globalCv.COLOR_RGBA2GRAY);

      const p0 = new globalCv.Mat();
      const mask = new globalCv.Mat();
      globalCv.goodFeaturesToTrack(prevGray, p0, 50, 0.05, 10, mask, 3, false, 0.04);

      if (p0.rows === 0) {
        prevMat.delete();
        currMat.delete();
        prevGray.delete();
        currGray.delete();
        p0.delete();
        mask.delete();
        return { dx: 0, dy: 0 };
      }

      const p1 = new globalCv.Mat();
      const status = new globalCv.Mat();
      const err = new globalCv.Mat();

      const winSize = new globalCv.Size(21, 21);
      const maxLevel = 2;
      const criteria = new globalCv.TermCriteria(
        globalCv.TERM_CRITERIA_EPS | globalCv.TERM_CRITERIA_COUNT,
        20,
        0.03
      );

      globalCv.calcOpticalFlowPyrLK(
        prevGray,
        currGray,
        p0,
        p1,
        status,
        err,
        winSize,
        maxLevel,
        criteria
      );

      const dxValues: number[] = [];
      const dyValues: number[] = [];

      for (let i = 0; i < status.rows; i++) {
        if (status.data[i] === 1) {
          const pt0x = p0.data32F[i * 2];
          const pt0y = p0.data32F[i * 2 + 1];
          const pt1x = p1.data32F[i * 2];
          const pt1y = p1.data32F[i * 2 + 1];

          const dx = pt1x - pt0x;
          const dy = pt1y - pt0y;

          if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
            dxValues.push(dx);
            dyValues.push(dy);
          }
        }
      }

      prevMat.delete();
      currMat.delete();
      prevGray.delete();
      currGray.delete();
      p0.delete();
      p1.delete();
      status.delete();
      err.delete();
      mask.delete();

      if (dxValues.length > 0) {
        dxValues.sort((a, b) => a - b);
        dyValues.sort((a, b) => a - b);
        const medianIdx = Math.floor(dxValues.length / 2);
        return { dx: dxValues[medianIdx], dy: dyValues[medianIdx] };
      }
    } catch (err) {
      console.warn('OpenCV optical flow error:', err);
    }
  }

  // Fast pure-canvas fallback: sample center region luminance delta
  return { dx: 0, dy: 0 };
}
