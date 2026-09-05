"use client";

// The sign-in door's signature element, fleet-wide: a full-bleed constellation of nodes that
// leans toward the pointer and links to it. Canvas 2D, no dependency at all - at up to 130 nodes
// redrawing every frame, canvas is far cheaper than mutating that many DOM nodes, and this is
// the very first screen the owner ever hits (the old ~600 KB three.js ring was removed for
// exactly that cost; see the portal file's git history).
//
// CANONICAL SOURCE: templates/relying-party/src/app/login/login-mesh.tsx, distributed verbatim
// by scripts/sync-rp-login.mjs to every roster app INCLUDING the prsa.me portal. Edit the
// TEMPLATE, not the copies. Because it lands in external repos that vendor @prsa/theme
// differently, this file may import ONLY React and may use NO Tailwind classes - the RP card is
// deliberately self-contained (inline <style>, no host CSS), so the canvas sizes itself with
// inline styles and every guard below (reduced motion included) is inlined rather than hooked.
//
// Interaction contract (the part that must never regress): the canvas is pointer-events:none
// and ALL pointer tracking listens on window. A full-bleed canvas that swallowed the sign-in
// click would lock the owner out and look perfectly fine until it happened.
//
// Reduced-motion is a REAL branch, not a CSS override: while it holds, no rAF loop runs at all
// (a single static frame is drawn per resize). It is also REACTIVE - toggling the OS setting
// mid-session starts or stops the loop via an inline matchMedia listener.
import { useEffect, useRef } from "react";

export function LoginMesh() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Each door matches its own brand where the app's --accent token reaches the login route,
    // and platform green everywhere else. Parsed to an "r, g, b" triplet so every stroke/fill
    // below can interpolate its own alpha. Anything unparseable falls back - var() has no error
    // state and neither should this.
    let accent = "0, 171, 97";
    try {
      const raw = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
      const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw)?.[1];
      if (hex) {
        const full = hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex;
        accent = `${parseInt(full.slice(0, 2), 16)}, ${parseInt(full.slice(2, 4), 16)}, ${parseInt(full.slice(4, 6), 16)}`;
      }
    } catch {
      /* keep the platform green */
    }

    const LINK_DIST = 155; // px between nodes that draws an edge
    const LINK_ALPHA = 0.38; // max edge alpha - the single biggest "bolder" lever
    const NODE_R = 2.1; // node radius, reads at arm's length on a phone
    const POINTER_RADIUS = 220; // px within which the pointer pulls and links
    const POINTER_FORCE = 0.02; // per-frame acceleration toward the pointer at zero distance
    const SETTLE_SPEED = 0.12; // above this, excited nodes decay back to ambient drift
    const MAX_SPEED = 1.4; // hard cap so a held pointer can never slingshot a node
    const FRAME_MS = 1000 / 40; // FPS cap - full rAF rate buys nothing visible here

    let width = 0;
    let height = 0;
    let dpr = 1;
    const nodes: { x: number; y: number; vx: number; vy: number }[] = [];
    const pointer = { x: -9999, y: -9999, active: false };

    // Node count scales with area but is capped - background ambience, not a data viz - and is
    // halved on narrow (phone) viewports, where the density budget is battery, not pixels.
    function targetCount() {
      const base = Math.max(40, Math.min(130, Math.round((width * height) / 9000)));
      return width < 640 ? Math.round(base / 2) : base;
    }

    function makeNode() {
      return {
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.12,
        vy: (Math.random() - 0.5) * 0.12,
      };
    }

    function resize() {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
      // PRESERVE nodes across resize. Mobile URL-bar show/hide changes dvh and fires the
      // ResizeObserver constantly; at this link alpha a full random re-scatter reads as a
      // glitch, not ambience. Clamp survivors into the new bounds, top up or trim to target.
      const count = targetCount();
      for (const n of nodes) {
        if (n.x > width) n.x = width;
        if (n.y > height) n.y = height;
      }
      while (nodes.length < count) nodes.push(makeNode());
      if (nodes.length > count) nodes.length = count;
      // Redraw on every real resize, not only from the animation loop. Load-bearing for the
      // reduced-motion path (found live, via a real byte-level canvas comparison): the FIRST
      // `resize()` call below runs synchronously in the same tick the canvas mounts, before the
      // browser has computed real layout, so `getBoundingClientRect()` can still report 0x0 -
      // zero nodes placed in a zero-size canvas. The animated path self-heals next frame (the
      // rAF loop redraws regardless), but the reduced-motion path draws exactly ONCE per resize,
      // so without this call a reduced-motion visitor saw a genuinely empty mesh. The
      // ResizeObserver's later, real callback re-runs `resize()` with correct dimensions;
      // calling `draw()` here means that correction actually reaches the screen.
      draw();
    }

    function draw() {
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);

      // Edges first (under the nodes). Distance-thresholded - the classic constellation look,
      // cheap at this node count (< 130^2 / 2 comparisons per frame, capped at 40fps).
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < LINK_DIST) {
            let alpha = (1 - dist / LINK_DIST) * LINK_ALPHA;
            let lw = 1;
            // Links near the pointer brighten and thicken - the web visibly reacts around the
            // hand, which is what makes the pull read as interaction rather than coincidence.
            if (pointer.active) {
              const mx = (a.x + b.x) / 2 - pointer.x;
              const my = (a.y + b.y) / 2 - pointer.y;
              const md = Math.sqrt(mx * mx + my * my);
              if (md < POINTER_RADIUS) {
                const p = 1 - md / POINTER_RADIUS;
                alpha *= 1 + p * 0.8;
                lw += p * 0.6;
              }
            }
            ctx.strokeStyle = `rgba(${accent}, ${alpha})`;
            ctx.lineWidth = lw;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
        // A link from each in-range node to the pointer itself - the hand becomes a node.
        if (pointer.active) {
          const dx = a.x - pointer.x;
          const dy = a.y - pointer.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < POINTER_RADIUS) {
            const alpha = (1 - dist / POINTER_RADIUS) * 0.45;
            ctx.strokeStyle = `rgba(${accent}, ${alpha})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(pointer.x, pointer.y);
            ctx.stroke();
          }
        }
      }

      for (const n of nodes) {
        ctx.fillStyle = `rgba(${accent}, 0.85)`;
        ctx.beginPath();
        ctx.arc(n.x, n.y, NODE_R, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    let raf = 0;
    let last = 0;
    function step(ts: number) {
      raf = requestAnimationFrame(step);
      // FPS cap by delta time: schedule every frame, draw at most every FRAME_MS. Resetting
      // `last` on visibility resume keeps the first frame after a tab switch from computing a
      // giant delta.
      if (ts - last < FRAME_MS) return;
      last = ts;
      for (const n of nodes) {
        // The pull: within radius, accelerate toward the pointer, stronger when closer. This -
        // not the drawn lines - is what makes the mesh genuinely interactive: nodes physically
        // lean toward the hand and keep their momentum when it moves on.
        if (pointer.active) {
          const dx = pointer.x - n.x;
          const dy = pointer.y - n.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > 0.001 && dist < POINTER_RADIUS) {
            const f = (1 - dist / POINTER_RADIUS) * POINTER_FORCE;
            n.vx += (dx / dist) * f;
            n.vy += (dy / dist) * f;
          }
        }
        // Excited nodes settle back to ambient drift; a hard cap keeps a held pointer from
        // slingshotting anything across the page.
        const sp = Math.sqrt(n.vx * n.vx + n.vy * n.vy);
        if (sp > MAX_SPEED) {
          n.vx *= MAX_SPEED / sp;
          n.vy *= MAX_SPEED / sp;
        } else if (sp > SETTLE_SPEED) {
          n.vx *= 0.97;
          n.vy *= 0.97;
        }
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < 0 || n.x > width) n.vx *= -1;
        if (n.y < 0 || n.y > height) n.vy *= -1;
      }
      draw();
    }

    // Reduced motion, inlined and REACTIVE (no @prsa/theme import allowed in this file - see
    // the module doc comment). While it holds, stopLoop() keeps the canvas fully static.
    const rmq =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;
    let reduceMotion = !!rmq?.matches;

    function startLoop() {
      if (!raf && !reduceMotion && document.visibilityState !== "hidden") {
        last = 0;
        raf = requestAnimationFrame(step);
      }
    }
    function stopLoop() {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    }
    const onRmChange = () => {
      reduceMotion = !!rmq?.matches;
      if (reduceMotion) {
        stopLoop();
        draw();
      } else {
        startLoop();
      }
    };
    rmq?.addEventListener?.("change", onRmChange);

    // A backgrounded tab stops drawing entirely - rAF throttling alone still burns battery on
    // some mobile browsers, and there is nothing to see.
    const onVisibility = () => {
      if (document.visibilityState === "hidden") stopLoop();
      else startLoop();
    };
    document.addEventListener("visibilitychange", onVisibility);

    // Pointer tracking on WINDOW, never the canvas (which is pointer-events:none). pointermove
    // covers mouse hover AND the touch drag (it fires while a finger is down); pointerdown makes
    // a bare tap register immediately; up/cancel release touch so no phantom force lingers,
    // while a mouse stays active until it leaves the page entirely.
    const setPointer = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = e.clientX - rect.left;
      pointer.y = e.clientY - rect.top;
      pointer.active = true;
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") pointer.active = false;
    };
    const onPageLeave = () => {
      pointer.active = false;
    };
    window.addEventListener("pointerdown", setPointer);
    window.addEventListener("pointermove", setPointer);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    document.documentElement.addEventListener("pointerleave", onPageLeave);

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    startLoop();

    return () => {
      ro.disconnect();
      stopLoop();
      rmq?.removeEventListener?.("change", onRmChange);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointerdown", setPointer);
      window.removeEventListener("pointermove", setPointer);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.documentElement.removeEventListener("pointerleave", onPageLeave);
    };
  }, []);

  // Inline styles ONLY (no Tailwind - external hosts never scan this file), and
  // pointer-events:none belt-and-suspenders with the wrappers that mount it.
  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{ display: "block", width: "100%", height: "100%", pointerEvents: "none" }}
    />
  );
}
