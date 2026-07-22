// AiG — useResponsiveScanHeight.js
// Shared hook so the B-scan canvas (BScanViewer), its depth axis (DepthScale)
// and its detection overlay (HyperbolaOverlay) always agree on ONE pixel
// height — across Detect.jsx, DetectionLab.jsx and ResNetSpatial.jsx.
//
// v1 only scaled height off viewport WIDTH breakpoints — didn't help a
// wide-but-short laptop window at all.
//
// v2 added a cap of 50% of window.innerHeight. Confirmed deployed
// (commit 431127b) and STILL not enough on DetectionLab.jsx specifically —
// that page stacks a header, detector-select card, confidence slider, run
// button and an "untrained weights" notice ABOVE the canvas, so on a normal
// laptop window (~900-1000px tall) 50% (~450-500px) is still taller than
// the room actually left once all of that is subtracted. The result reads
// as "same size as before" even though the number did shrink slightly.
//
// v3: stop guessing a fraction of the whole window and instead subtract a
// fixed reserve for that stacked chrome, so the cap tracks the room that's
// ACTUALLY left below it, not a percentage of a window that might mostly be
// taken up by content above the canvas.
import { useEffect, useState } from 'react';

const MIN_HEIGHT = 180;
// Approximate vertical space consumed by the browser chrome + this app's
// header + card(s) above the B-scan on the tallest of the three pages
// (DetectionLab.jsx: header, detector-select card, confidence slider, run
// button, untrained-weights notice, card title). Deliberately generous so
// the canvas comfortably fits below the fold without needing page-scroll
// just to see the whole B-scan on a normal laptop window.
const RESERVED_CHROME_PX = 560;

function computeHeight(desktopHeight, width, viewportHeight) {
  let ratio = 1;
  if (width < 480)       ratio = 0.42;
  else if (width < 640)  ratio = 0.52;
  else if (width < 1024) ratio = 0.72;

  let height = Math.round(desktopHeight * ratio);
  const available = viewportHeight - RESERVED_CHROME_PX;
  height = Math.min(height, Math.max(MIN_HEIGHT, available));
  return Math.max(MIN_HEIGHT, height);
}

export default function useResponsiveScanHeight(desktopHeight = 480) {
  const [height, setHeight] = useState(() =>
    computeHeight(
      desktopHeight,
      typeof window !== 'undefined' ? window.innerWidth : 1280,
      typeof window !== 'undefined' ? window.innerHeight : 800
    )
  );

  useEffect(() => {
    const onResize = () =>
      setHeight(computeHeight(desktopHeight, window.innerWidth, window.innerHeight));
    onResize();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, [desktopHeight]);

  return height;
}
