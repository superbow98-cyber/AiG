// AiG — useResponsiveScanHeight.js
// Shared hook so the B-scan canvas (BScanViewer), its depth axis (DepthScale)
// and its detection overlay (HyperbolaOverlay) always agree on ONE pixel
// height — across Detect.jsx, DetectionLab.jsx and ResNetSpatial.jsx.
//
// v1 of this hook only scaled height off viewport WIDTH breakpoints, so on
// a wide-but-short window (a laptop browser that isn't maximized, or a
// laptop screen at all — the reported bug) the canvas kept its full
// desktopHeight (440/480px) even though the window itself had nowhere near
// that much vertical room left after the header, detector controls and
// page chrome. Result: the B-scan visibly overflowed the bottom of the
// browser window and needed page-scrolling to see the rest of it, on a
// screen that isn't a phone at all.
//
// Fix: compute height from BOTH width breakpoints (unchanged from v1, still
// what drives phone/tablet sizing) AND a viewport-HEIGHT cap — the canvas
// is never allowed to exceed a fraction of window.innerHeight, so it always
// fits inside whatever window the person actually has open, laptop or
// phone, maximized or not.
//
// `desktopHeight` is each page's original tuned height — the ceiling used
// only when there's enough vertical room for it.
import { useEffect, useState } from 'react';

const MIN_HEIGHT = 180;
// The canvas may use at most this fraction of the window's visible height —
// leaves room for the header, detector controls, and side panels above it.
const VIEWPORT_HEIGHT_FRACTION = 0.5;

function computeHeight(desktopHeight, width, viewportHeight) {
  let ratio = 1;
  if (width < 480)       ratio = 0.42;
  else if (width < 640)  ratio = 0.52;
  else if (width < 1024) ratio = 0.72;

  let height = Math.round(desktopHeight * ratio);
  const viewportCap = Math.round(viewportHeight * VIEWPORT_HEIGHT_FRACTION);
  height = Math.min(height, viewportCap);
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
