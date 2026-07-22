// AiG — useResponsiveScanHeight.js
// Shared hook so the B-scan canvas (BScanViewer), its depth axis (DepthScale)
// and its detection overlay (HyperbolaOverlay) always agree on ONE pixel
// height — across Detect.jsx, DetectionLab.jsx and ResNetSpatial.jsx.
//
// Previously each page hardcoded a single px height (480 / 440 / 360) that
// never changed with viewport size. On a laptop that's fine, but on a phone
// (or a resized/narrow browser window) a fixed 440-480px tall canvas either
// overflows the viewport (forcing awkward vertical scrolling to see the
// bottom of the scan) or leaves the B-scan looking squashed/tiny relative to
// the surrounding UI once the width has already shrunk to fit the screen.
//
// `desktopHeight` is each page's original tuned height (kept as-is at
// desktop widths, so nothing changes there). Below that, height scales down
// with viewport width in three steps, matching Tailwind's own sm/lg
// breakpoints so the canvas, axis and overlay resize in lockstep with the
// rest of the responsive layout:
//   < 480px  (small phone)      → ~42% of desktopHeight
//   < 640px  (phone, Tailwind sm)→ ~52% of desktopHeight
//   < 1024px (tablet, Tailwind lg)→ ~72% of desktopHeight
//   >= 1024px (laptop/desktop)  → desktopHeight, unchanged
//
// A floor of 200px keeps the hyperbolas readable even on the smallest
// screens instead of collapsing into an unusable sliver.
import { useEffect, useState } from 'react';

const MIN_HEIGHT = 200;

function computeHeight(desktopHeight, width) {
  let ratio = 1;
  if (width < 480)       ratio = 0.42;
  else if (width < 640)  ratio = 0.52;
  else if (width < 1024) ratio = 0.72;
  return Math.max(MIN_HEIGHT, Math.round(desktopHeight * ratio));
}

export default function useResponsiveScanHeight(desktopHeight = 480) {
  const [height, setHeight] = useState(() =>
    computeHeight(desktopHeight, typeof window !== 'undefined' ? window.innerWidth : 1280)
  );

  useEffect(() => {
    const onResize = () => setHeight(computeHeight(desktopHeight, window.innerWidth));
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
