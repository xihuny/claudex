import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { animate, m as motion, useMotionValue } from "motion/react";
import { ChevronLeft, ChevronRight, X, Download } from "lucide-react";
import { cn } from "@/lib/utils";

// Full-screen image viewer, portaled to <body> so `fixed` is viewport-relative (the chat
// tree has transformed ancestors that would otherwise trap it and expose a background
// scrollbar). Dismissal is gestural first: swipe the image down (only when NOT zoomed - // pinch back to 1× first), tap the backdrop, or press Esc. A header with an explicit
// close button, the position in the set, and a save action appears only when the caller
// supplies `onSave` or a `total` - a lone image with neither keeps the chrome-free view. Mobile gets pinch-zoom (with
// rubber-band resistance past the limits and a spring back to centred 1× on release),
// drag-to-pan clamped to the picture's bounds, and double-tap to zoom in on a point.
// Background scroll while open is blocked *only* on this overlay
// (`touch-none` + a non-passive wheel blocker) - the app's own scroll containers are
// never touched.
//
// Stepping between images works like a photo-gallery app: when the caller supplies
// prevSrc/nextSrc, the neighbours are mounted on a horizontal track either side of the
// current picture, so a swipe drags the next one into view continuously and release
// finishes the slide before committing the index change. Without neighbour srcs the old
// instant swap is used.
const MAX_ZOOM = 5;
const DISMISS_PX = 110;   // swipe-down distance past which release closes the viewer
const SWIPE_PX = 60;      // horizontal distance past which release slides to the next image
const FLING_VX = 500;     // px/s - a quick flick steps even before SWIPE_PX
const GAP = 24;           // gap between slides on the track, like gallery apps
const clampZoom = (v: number) => Math.min(MAX_ZOOM, Math.max(1, v));
// Rubber-band the pinch outside [1, MAX_ZOOM]: the image keeps following the fingers with
// growing resistance instead of hitting a wall, and release springs it back - the native
// photo-viewer feel. Exponents tuned so under-zoom is stretchy but never tiny.
const rubberZoom = (v: number) =>
  v < 1 ? Math.pow(v, 0.55)
  : v > MAX_ZOOM ? MAX_ZOOM * Math.pow(v / MAX_ZOOM, 0.35)
  : v;
const DBLTAP_MS = 300;    // max gap between taps that counts as a double-tap
const DBLTAP_ZOOM = 2.5;  // scale a double-tap zooms into

export function Lightbox({ src, poster, onClose, footer, onPrev, onNext, prevSrc, nextSrc, index, total, onSave }: {
  src: string | null; onClose: () => void; footer?: React.ReactNode;
  // A low-res stand-in for `src` that the caller already has on screen (a thumbnail).
  // Optional: without it the viewer behaves as before, holding the previous picture - or
  // nothing at all, on first open - until the full-size file has decoded.
  poster?: string | null;
  onPrev?: () => void; onNext?: () => void;
  prevSrc?: string | null; nextSrc?: string | null;
  // Optional header: position in the set ("3 / 12") and a save action in the top-right.
  // Omitted by callers that show a single image with nothing to count (the chat's
  // attachment zoom), which then get the bare gesture-only viewer.
  index?: number; total?: number; onSave?: () => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [t, setTState] = useState({ scale: 1, x: 0, y: 0 });
  const tRef = useRef(t);
  const setT = useCallback((v: { scale: number; x: number; y: number }) => { tRef.current = v; setTState(v); }, []);
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const start = useRef<{ dist: number; scale: number; mx: number; my: number; x: number; y: number; sx: number; qx: number; qy: number; cx: number; cy: number } | null>(null);
  const moved = useRef(false);
  const dismissing = useRef(false);
  const stepping = useRef(false);    // slide-to-neighbour animation in flight
  const committed = useRef(false);   // next src change comes from a finished slide
  const axis = useRef<"h" | "v" | null>(null);
  const settleAnim = useRef<{ stop: () => void } | null>(null);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);

  // Swipe-to-dismiss drives the wrapper offset + backdrop opacity as motion values, so the
  // close / snap-back animations run smoothly without React re-renders.
  const dismissY = useMotionValue(0);
  const bgOpacity = useMotionValue(0);
  const swipeX = useMotionValue(0);

  // Hold the current picture on screen until the next one has actually decoded. Swapping
  // the <img> src directly leaves a blank frame while the new file loads, which read as the
  // whole viewer flickering out and back in between images.
  const [shown, setShown] = useState<string | null>(src);
  useEffect(() => {
    if (!src) { setShown(null); return; }
    if (src === shown) return;
    const img = new Image();
    img.src = src;
    if (img.complete) { setShown(src); return; }
    let alive = true;
    const done = () => { if (alive) setShown(src); };
    img.onload = done;
    img.onerror = done;
    return () => { alive = false; };
  }, [src, shown]);

  // Reset the zoom/pan for whichever picture is showing, and play the open animation ONLY
  // when going from closed to open. Replaying it on every src change was what made the
  // backdrop fade out and back in when stepping between images.
  const wasOpen = useRef(false);
  useLayoutEffect(() => {
    if (!src) { wasOpen.current = false; return; }
    settleAnim.current?.stop();
    settleAnim.current = null;
    setT({ scale: 1, x: 0, y: 0 });
    pointers.current.clear();
    start.current = null;
    moved.current = false;
    axis.current = null;
    swipeX.set(0);
    // A committed slide already had the new picture on screen (it was the visible
    // neighbour); swap `shown` synchronously so the track re-centres on the exact same
    // frame with no decode-wait and no flicker.
    if (committed.current) { committed.current = false; setShown(src); }
    if (wasOpen.current) return;      // already open - just a different picture
    wasOpen.current = true;
    dismissing.current = false;
    dismissY.set(24);
    bgOpacity.set(0);
    const a = animate(dismissY, 0, { duration: 0.24, ease: [0.22, 1, 0.36, 1] });
    const b = animate(bgOpacity, 1, { duration: 0.16 });
    return () => { a.stop(); b.stop(); };
  }, [src, setT, dismissY, bgOpacity, swipeX]);

  // Play the exit (slide down + fade), then tell the parent to unmount.
  const close = useCallback(() => {
    if (dismissing.current) return;
    dismissing.current = true;
    animate(bgOpacity, 0, { duration: 0.18 });
    animate(dismissY, dismissY.get() + 320, { duration: 0.22, onComplete: onClose });
  }, [onClose, dismissY, bgOpacity]);

  // Slide the track one picture over (dir 1 = next, -1 = prev), then commit the index
  // change. The neighbour is already mounted and centred at the moment the animation ends,
  // so the commit + track reset in the layout effect above lands on an identical frame.
  const step = useCallback((dir: 1 | -1) => {
    const cb = dir === 1 ? onNext : onPrev;
    if (!cb || stepping.current || dismissing.current) return;
    const neighbour = dir === 1 ? nextSrc : prevSrc;
    if (!neighbour) {                   // caller gave no neighbour src - instant swap
      cb();
      animate(swipeX, 0, { type: "spring", stiffness: 420, damping: 38 });
      return;
    }
    stepping.current = true;
    const w = (overlayRef.current?.clientWidth ?? window.innerWidth) + GAP;
    animate(swipeX, -dir * w, {
      type: "spring", stiffness: 400, damping: 40,
      onComplete: () => { stepping.current = false; committed.current = true; cb(); },
    });
  }, [onNext, onPrev, nextSrc, prevSrc, swipeX]);

  useEffect(() => {
    if (!src) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [src, close, step]);

  // Block wheel-scroll of the page behind the viewer. Non-passive so preventDefault sticks;
  // attached to the overlay element only, removed when it closes.
  useEffect(() => {
    const el = overlayRef.current;
    if (!src || !el) return;
    const block = (e: Event) => e.preventDefault();
    el.addEventListener("wheel", block, { passive: false });
    return () => el.removeEventListener("wheel", block);
  }, [src]);

  // Keep a zoomed image's edges pinned to the screen edges: for a given scale, the pan may
  // wander only far enough that no gap opens between picture and viewport (per axis; a
  // dimension smaller than the screen stays centred). Uses the untransformed layout size,
  // since the CSS translate is applied before the scale.
  const clampPan = (v: { scale: number; x: number; y: number }) => {
    const el = imgRef.current, ov = overlayRef.current;
    if (!el || !ov) return v;
    const maxX = Math.max(0, (el.offsetWidth * v.scale - ov.clientWidth) / 2);
    const maxY = Math.max(0, (el.offsetHeight * v.scale - ov.clientHeight) / 2);
    return { ...v, x: Math.min(maxX, Math.max(-maxX, v.x)), y: Math.min(maxY, Math.max(-maxY, v.y)) };
  };

  // Spring the zoom/pan to a target - the release animation that makes the rubber-banded
  // pinch and out-of-bounds pan snap home instead of just stopping dead.
  const settleTo = (to: { scale: number; x: number; y: number }) => {
    settleAnim.current?.stop();
    const from = { ...tRef.current };
    if (from.scale === to.scale && from.x === to.x && from.y === to.y) return;
    settleAnim.current = animate(0, 1, {
      type: "spring", stiffness: 380, damping: 34,
      onUpdate: (p) => setT({
        scale: from.scale + (to.scale - from.scale) * p,
        x: from.x + (to.x - from.x) * p,
        y: from.y + (to.y - from.y) * p,
      }),
    });
  };

  // Where a released pinch/pan should come to rest: under 1× re-centres at 1×, over-zoom
  // clamps to MAX_ZOOM, and a legal zoom just pulls the pan back inside the bounds.
  const settle = () => {
    const cur = tRef.current;
    if (cur.scale <= 1) settleTo({ scale: 1, x: 0, y: 0 });
    else settleTo(clampPan({ ...cur, scale: clampZoom(cur.scale) }));
  };

  // Snapshot the gesture origin from the pointers currently down.
  const beginGesture = () => {
    const pts = [...pointers.current.values()];
    if (!pts.length) { start.current = null; return; }
    const cur = tRef.current;
    const ov = overlayRef.current;
    const cx = (ov?.clientWidth ?? window.innerWidth) / 2, cy = (ov?.clientHeight ?? window.innerHeight) / 2;
    if (pts.length >= 2) {
      const [a, b] = pts;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      // The image point under the pinch midpoint, in the picture's own (unscaled) space:
      // screen = centre + pan + point·scale, inverted. The pinch keeps THIS point pinned
      // under the fingers, which is what makes zoom feel anchored to the touch.
      start.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y), scale: cur.scale, mx, my, x: cur.x, y: cur.y, sx: swipeX.get(),
        qx: (mx - cx - cur.x) / cur.scale, qy: (my - cy - cur.y) / cur.scale, cx, cy,
      };
    } else {
      start.current = { dist: 0, scale: cur.scale, mx: pts[0].x, my: pts[0].y, x: cur.x, y: cur.y, sx: swipeX.get(), qx: 0, qy: 0, cx, cy };
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" || dismissing.current || stepping.current) return;   // gestures are mobile-only
    swipeX.stop();     // grab mid-snap-back: pick the track/zoom up where it is
    dismissY.stop();
    settleAnim.current?.stop();
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = false;
    beginGesture();
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || dismissing.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = start.current;
    if (!g) return;
    const pts = [...pointers.current.values()];
    if (pts.length >= 2) {                        // two fingers → pinch-zoom (+ move)
      const [a, b] = pts;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      // Solve the pan so the anchored image point stays under the (possibly moving)
      // midpoint at the new scale - zoom follows the fingers, and two-finger drag pans.
      const s = rubberZoom(g.scale * (d / (g.dist || 1)));
      setT({ scale: s, x: mx - g.cx - g.qx * s, y: my - g.cy - g.qy * s });
      moved.current = true;
    } else if (tRef.current.scale !== 1) {        // zoomed (or rubber-banded) → one finger pans
      const p = pts[0];
      setT({ scale: tRef.current.scale, x: g.x + (p.x - g.mx), y: g.y + (p.y - g.my) });
      moved.current = true;
    } else {
      // Not zoomed: one finger either slides the track between pictures (horizontal) or
      // dismisses (vertical). Lock the axis on the first decisive movement so a slightly
      // diagonal swipe doesn't do both at once.
      const p = pts[0];
      const dx = p.x - g.mx, dy = p.y - g.my;
      if (!axis.current && Math.hypot(dx, dy) > 10) {
        axis.current = Math.abs(dx) > Math.abs(dy) && (onPrev || onNext) ? "h" : "v";
      }
      if (axis.current === "h") {
        const raw = g.sx + dx;
        // Resist at the ends of the set so it's obvious there's nothing further.
        const blocked = (raw > 0 && !onPrev) || (raw < 0 && !onNext);
        swipeX.set(blocked ? raw * 0.25 : raw);
        moved.current = true;
      } else if (axis.current === "v") {
        const down = Math.max(0, dy);
        dismissY.set(down);
        bgOpacity.set(Math.max(0, 1 - down / 320));
        if (down > 6) moved.current = true;
      }
    }
  };
  const endPointer = (e: React.PointerEvent) => {
    if (!pointers.current.delete(e.pointerId) || dismissing.current) return;
    if (pointers.current.size >= 1) { beginGesture(); return; }   // fingers still down
    start.current = null;
    // Double-tap on the picture toggles zoom, like native viewers: back to centred 1× when
    // zoomed, otherwise zoom in around the tapped point (translate precedes the
    // centre-origin scale, so x = (centre − tap)·(s − 1) keeps that point stationary).
    if (!moved.current && (e.target as HTMLElement).tagName === "IMG") {
      const now = performance.now();
      const prev = lastTap.current;
      lastTap.current = { t: now, x: e.clientX, y: e.clientY };
      if (prev && now - prev.t < DBLTAP_MS && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < 40) {
        lastTap.current = null;
        axis.current = null;
        if (tRef.current.scale > 1) settleTo({ scale: 1, x: 0, y: 0 });
        else {
          const ov = overlayRef.current;
          const cx = (ov?.clientWidth ?? window.innerWidth) / 2, cy = (ov?.clientHeight ?? window.innerHeight) / 2;
          settleTo(clampPan({ scale: DBLTAP_ZOOM, x: (cx - e.clientX) * (DBLTAP_ZOOM - 1), y: (cy - e.clientY) * (DBLTAP_ZOOM - 1) }));
        }
        return;
      }
    }
    // Any zoom away from exactly 1× - including the rubber-banded under-zoom - springs to
    // its resting state on release: centred 1× from below, bounds-clamped pan from above.
    // Pan residue from a pinch that happened to end at 1× settles home the same way.
    const cur = tRef.current;
    if (cur.scale !== 1 || (!axis.current && (cur.x !== 0 || cur.y !== 0))) {
      axis.current = null;
      settle();
      return;
    }
    if (axis.current === "h") {
      const dx = swipeX.get();
      const vx = swipeX.getVelocity();
      axis.current = null;
      // Past the distance threshold - or a quick flick - the slide animation carries on
      // from wherever the finger let go, so the neighbour glides the rest of the way in.
      if ((dx <= -SWIPE_PX || (dx < 0 && vx < -FLING_VX)) && onNext) step(1);
      else if ((dx >= SWIPE_PX || (dx > 0 && vx > FLING_VX)) && onPrev) step(-1);
      else animate(swipeX, 0, { type: "spring", stiffness: 420, damping: 38 });
      return;
    }
    axis.current = null;
    if (dismissY.get() > DISMISS_PX) { close(); return; }        // past threshold → dismiss
    animate(dismissY, 0, { type: "spring", stiffness: 400, damping: 34 });   // else snap back
    animate(bgOpacity, 1, { duration: 0.15 });
  };

  // A plain tap on the backdrop closes - but only when not zoomed (pinch back first).
  const onBackdropClick = () => { if (!moved.current && tRef.current.scale <= 1) close(); };

  // A tap in a side zone steps the set - but only a genuine tap, not the release of a pan
  // or pinch, and not while zoomed in (where the sides are part of the picture).
  const zoneTap = (dir: 1 | -1) => (e: React.MouseEvent) => {
    e.stopPropagation();
    if (moved.current || tRef.current.scale > 1) return;
    step(dir);
  };

  if (!src) return null;
  // Show the thumbnail the moment the viewer opens and upgrade in place when the original
  // has decoded. Opening a picture used to mean staring at a black screen for the length of
  // a 1.4-2.7 MB download, because `shown` is only set once the full file has loaded and on
  // first open there is no previous picture to hold. The stand-in is already in the SW cache
  // - it is the tile that was just tapped - so it paints on the first frame.
  const display = shown === src ? src : (poster || shown || src);
  // The header exists when there's something for it to carry - a save action or a
  // position in a set. A lone image with neither keeps the original chrome-free viewer.
  const hasHeader = !!onSave || (typeof total === "number" && total > 1);
  // Each slide is a full-viewport cell; the neighbours sit one cell (plus a gap) either
  // side so translateX(±(100% + GAP)) lines them up exactly one screen away.
  const slideCls = "absolute inset-0 grid place-items-center p-0 md:p-3";
  // Mobile is a native-gallery treatment: edge-to-edge on solid black, no card chrome.
  // The slide is `inset-0` so max-w/h-full resolve against a definite full-screen box -   // the old auto-height-wrapper clipping problem doesn't apply here. Desktop keeps the
  // floating-card look, with viewport-unit caps leaving room for arrows and the footer.
  const imgCls = "max-w-full max-h-full md:max-w-[92vw] md:max-h-[88vh] md:rounded-xl md:shadow-2xl object-contain select-none";
  return createPortal(
    <div
      ref={overlayRef}
      onClick={onBackdropClick}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      className="fixed inset-0 z-[100] overflow-hidden touch-none"
    >
      {/* Solid black on mobile (native photo-viewer feel); translucent blur on desktop. */}
      <motion.div style={{ opacity: bgOpacity }} className="absolute inset-0 bg-black md:bg-black/90" />
      <motion.div style={{ y: dismissY, x: swipeX, opacity: bgOpacity }} className="absolute inset-0">
        {prevSrc && (
          <div className={slideCls} style={{ transform: `translateX(calc(-100% - ${GAP}px))` }}>
            <img src={prevSrc} alt="" draggable={false} className={imgCls} />
          </div>
        )}
        <div className={slideCls}>
          <img
            ref={imgRef}
            src={display}
            alt=""
            draggable={false}
            onClick={(e) => e.stopPropagation()}
            style={{ transform: `translate3d(${t.x}px, ${t.y}px, 0) scale(${t.scale})` }}
            className={cn(imgCls, "will-change-transform")}
          />
        </div>
        {nextSrc && (
          <div className={slideCls} style={{ transform: `translateX(calc(100% + ${GAP}px))` }}>
            <img src={nextSrc} alt="" draggable={false} className={imgCls} />
          </div>
        )}
      </motion.div>
      {/* Header. Sits above the picture rather than over its middle, and fades with the
          backdrop so a swipe-to-dismiss takes it along. Buttons stop propagation so a tap
          on one isn't also read as the backdrop tap that closes the viewer; the bar
          itself does NOT stop pointer events, so pinch and pan still work if a finger
          lands on it. */}
      {(hasHeader) && (
        <motion.div
          style={{ opacity: bgOpacity }}
          className="absolute inset-x-0 top-0 z-20 flex items-center gap-2 p-2 pt-[max(0.5rem,env(safe-area-inset-top))] bg-gradient-to-b from-black/60 to-transparent"
        >
          <button
            onClick={(e) => { e.stopPropagation(); close(); }}
            aria-label="Close"
            className="grid place-items-center w-11 h-11 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors"
          ><X size={22} /></button>

          <div className="flex-1 text-center">
            {typeof index === "number" && typeof total === "number" && total > 1 && (
              <span className="text-[12px] text-white/60 tabular-nums">{index + 1} / {total}</span>
            )}
          </div>

          {onSave ? (
            <button
              onClick={(e) => { e.stopPropagation(); onSave(); }}
              aria-label="Save image"
              title="Save image"
              className="grid place-items-center w-11 h-11 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors"
            ><Download size={21} /></button>
          ) : (
            <span className="w-11" />   // keeps the counter optically centred
          )}
        </motion.div>
      )}

      {/* Whole-edge hit zones rather than small buttons - a 44px target at the screen edge
          is a poor aim on desktop and worse on a phone. Pointer events are deliberately NOT
          stopped here: they bubble to the overlay so pinch and pan still work when a finger
          lands in a zone. Only the click is intercepted. Arrow keys and swipe do the same. */}
      {(onPrev || onNext) && (
        <>
          <div
            onClick={zoneTap(-1)}
            // aria-label, not title: a native tooltip popping up every time the cursor
            // crosses a zone that covers a quarter of the screen is pure noise.
            aria-label="Previous image"
            role="button"
            className={cn(
              // Hidden on mobile: swiping is the navigation there, and floating arrows over
              // an edge-to-edge photo read as web-lightbox, not gallery.
              "group absolute left-0 top-0 bottom-0 w-[28%] z-10 hidden md:flex items-center justify-start md:pl-5",
              onPrev ? "cursor-pointer" : "pointer-events-none",
            )}
          >
            {onPrev && (
              <span className="grid place-items-center w-11 h-11 rounded-full bg-black/60 text-white/85 transition-all opacity-60 group-hover:opacity-100 group-hover:bg-black/75">
                <ChevronLeft size={22} />
              </span>
            )}
          </div>
          <div
            onClick={zoneTap(1)}
            aria-label="Next image"
            role="button"
            className={cn(
              "group absolute right-0 top-0 bottom-0 w-[28%] z-10 hidden md:flex items-center justify-end md:pr-5",
              onNext ? "cursor-pointer" : "pointer-events-none",
            )}
          >
            {onNext && (
              <span className="grid place-items-center w-11 h-11 rounded-full bg-black/60 text-white/85 transition-all opacity-60 group-hover:opacity-100 group-hover:bg-black/75">
                <ChevronRight size={22} />
              </span>
            )}
          </div>
        </>
      )}
      {/* Optional overlay action (e.g. Save to Photos). Stops propagation so tapping it
          doesn't register as the backdrop tap that dismisses the viewer. */}
      {footer && (
        <div className="absolute inset-x-0 bottom-6 z-20 flex justify-center pointer-events-none [&>*]:pointer-events-auto" onClick={(e) => e.stopPropagation()}>
          {footer}
        </div>
      )}
    </div>,
    document.body,
  );
}
