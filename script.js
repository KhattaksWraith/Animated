/* ═══════════════════════════════════════════════════════
   PIXEL WATCH 3 ULTRA — SCROLL ENGINE & CANVAS RENDERER
   ═══════════════════════════════════════════════════════ */

(() => {
    'use strict';

    // ── CONFIG ──
    const TOTAL_FRAMES  = 240;
    const FRAME_PATH    = 'frames/ezgif-frame-';
    const FRAME_EXT     = '.webp';
    const SCROLL_HEIGHT_VH = 500; // matches CSS scroll-container height

    // Story beat scroll ranges (as fraction of total scroll 0–1)
    // Each beat has: enter, peak, fadeOut, exit
    // The "peak → fadeOut" window is where text stays at full opacity
    // AND the frame animation PAUSES so the reader can read.
    const BEATS = {
        hero:        { enter: -0.01, peak: 0.00, fadeOut: 0.08, exit: 0.12 },
        engineering: { enter: 0.14,  peak: 0.19, fadeOut: 0.30, exit: 0.36 },
        sensors:     { enter: 0.38,  peak: 0.43, fadeOut: 0.54, exit: 0.60 },
        performance: { enter: 0.62,  peak: 0.67, fadeOut: 0.76, exit: 0.82 },
        cta:         { enter: 0.84,  peak: 0.90, fadeOut: 1.01, exit: 1.02 },
    };

    // Pause zones: scroll ranges where the frame animation holds still.
    // Format: { start, end, frame } — frame is the fraction (0–1) of
    //   animation progress that should be held during this zone.
    // The animation plays in the gaps BETWEEN pause zones.
    //
    // Timeline (scroll 0–1):
    //   0.00–0.10  → PAUSE at frame 0 (hero — watch assembled)
    //   0.10–0.35  → ANIMATE exploding
    //   0.19–0.30  → PAUSE (engineering text peak)
    //   0.35–0.56  → ANIMATE exploding more
    //   0.43–0.54  → PAUSE (sensors text peak)
    //   0.56–0.78  → ANIMATE peak explosion
    //   0.67–0.76  → PAUSE (performance text peak)
    //   0.78–1.00  → ANIMATE reassembly
    //   0.90–1.00  → PAUSE at frame 0 (CTA — watch assembled)
    //
    // We define pause zones — during these, animation holds a fixed frame.
    // Between pauses, animation interpolates smoothly.

    const PAUSE_ZONES = [
        { start: 0.00, end: 0.10, animPos: 0.0 },   // hero: hold assembled
        { start: 0.19, end: 0.30, animPos: 0.22 },   // engineering: hold partly exploded
        { start: 0.43, end: 0.54, animPos: 0.50 },   // sensors: hold mid-exploded
        { start: 0.67, end: 0.76, animPos: 0.72 },   // performance: hold near-peak
        { start: 0.90, end: 1.00, animPos: 1.0 },    // cta: hold assembled (reversed)
    ];

    // Build a piecewise mapping: scroll → animationProgress (0–1)
    // Animation only advances in the gaps between pause zones.
    function scrollToAnimProgress(scroll) {
        // Check if we're inside a pause zone
        for (const z of PAUSE_ZONES) {
            if (scroll >= z.start && scroll <= z.end) {
                return z.animPos;
            }
        }

        // We're in a gap between pause zones — interpolate
        // Find which gap we're in
        let prevEnd = 0, prevAnim = 0;
        for (const z of PAUSE_ZONES) {
            if (scroll < z.start) {
                // We're in the gap between prevEnd and z.start
                const gapScroll = z.start - prevEnd;
                const gapAnim = z.animPos - prevAnim;
                const t = (scroll - prevEnd) / gapScroll;
                return prevAnim + t * gapAnim;
            }
            prevEnd = z.end;
            prevAnim = z.animPos;
        }

        // Past last pause zone
        return prevAnim;
    }

    // ── ELEMENTS ──
    const canvas      = document.getElementById('watchCanvas');
    const ctx         = canvas.getContext('2d');
    const container   = document.getElementById('scroll-container');
    const navbar      = document.getElementById('navbar');
    const loader      = document.getElementById('loader');
    const loaderBar   = document.getElementById('loaderBar');
    const loaderPct   = document.getElementById('loaderPercent');

    const beatElements = {
        hero:        document.getElementById('beat-hero'),
        engineering: document.getElementById('beat-engineering'),
        sensors:     document.getElementById('beat-sensors'),
        performance: document.getElementById('beat-performance'),
        cta:         document.getElementById('beat-cta'),
    };

    // ── STATE ──
    const frames = new Array(TOTAL_FRAMES);
    let loadedCount   = 0;
    let currentFrame  = -1;
    let scrollProgress = 0;
    let isReady       = false;
    let canvasOffsetX = 0;      // horizontal shift for CTA phase

    // ── FRAME FILENAME ──
    function frameSrc(index) {
        // index is 1-based
        const num = String(index).padStart(3, '0');
        return `${FRAME_PATH}${num}${FRAME_EXT}`;
    }

    // ── PRELOAD ALL FRAMES ──
    function preloadFrames() {
        return new Promise((resolve) => {
            let loaded = 0;

            for (let i = 1; i <= TOTAL_FRAMES; i++) {
                const img = new Image();
                img.src = frameSrc(i);

                img.onload = img.onerror = () => {
                    loaded++;
                    loadedCount = loaded;
                    const pct = Math.round((loaded / TOTAL_FRAMES) * 100);
                    loaderBar.style.width = pct + '%';
                    loaderPct.textContent = pct + '%';

                    if (loaded === TOTAL_FRAMES) {
                        resolve();
                    }
                };

                frames[i - 1] = img;
            }
        });
    }

    // ── CANVAS SIZING ──
    function resizeCanvas() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width  = window.innerWidth * dpr;
        canvas.height = window.innerHeight * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        // Redraw current frame on resize
        if (isReady && currentFrame >= 0) {
            drawFrame(currentFrame);
        }
    }

    // ── DRAW A FRAME ──
    function drawFrame(index, xOffset) {
        xOffset = xOffset || 0;
        const img = frames[index];
        if (!img || !img.complete || img.naturalWidth === 0) return;

        const cw = window.innerWidth;
        const ch = window.innerHeight;
        const iw = img.naturalWidth;
        const ih = img.naturalHeight;

        // Fill canvas with matching background so shifting doesn't leave gaps
        ctx.fillStyle = '#0c0c0e';
        ctx.fillRect(0, 0, cw, ch);

        // Cover-fit the image in the viewport
        const scale = Math.max(cw / iw, ch / ih);
        const dw = iw * scale;
        const dh = ih * scale;
        const dx = (cw - dw) / 2 + xOffset;
        const dy = (ch - dh) / 2;

        ctx.drawImage(img, dx, dy, dw, dh);
    }

    // ── COMPUTE SCROLL PROGRESS ──
    function getScrollProgress() {
        const rect = container.getBoundingClientRect();
        const scrollable = container.offsetHeight - window.innerHeight;
        if (scrollable <= 0) return 0;
        const raw = -rect.top / scrollable;
        return Math.max(0, Math.min(1, raw));
    }

    // ── MAP ANIMATION PROGRESS → FRAME INDEX ──
    function animProgressToFrame(animProg) {
        // animProg 0.0 → 0.5: frames 0 → 239 (explode)
        // animProg 0.5 → 1.0: frames 239 → 0 (reassemble)
        let frameIndex;
        if (animProg <= 0.5) {
            frameIndex = Math.floor((animProg / 0.5) * (TOTAL_FRAMES - 1));
        } else {
            frameIndex = Math.floor(((1.0 - animProg) / 0.5) * (TOTAL_FRAMES - 1));
        }
        return Math.max(0, Math.min(TOTAL_FRAMES - 1, frameIndex));
    }

    // ── BEAT OPACITY CALCULATION ──
    function beatOpacity(progress, beat) {
        if (progress < beat.enter || progress > beat.exit) return 0;
        if (progress >= beat.peak && progress <= beat.fadeOut) return 1;
        if (progress < beat.peak) {
            // Guard against enter == peak (hero starts at full opacity)
            const range = beat.peak - beat.enter;
            if (range <= 0) return 1;
            return (progress - beat.enter) / range;
        }
        // progress > beat.fadeOut
        return 1 - (progress - beat.fadeOut) / (beat.exit - beat.fadeOut);
    }

    // ── COMPUTE CANVAS X-OFFSET (CTA phase pushes watch right) ──
    function getCanvasOffset(progress) {
        const CTA_START = 0.84;
        const CTA_FULL  = 0.92;
        if (progress <= CTA_START) return 0;
        const t = Math.min((progress - CTA_START) / (CTA_FULL - CTA_START), 1);
        // Ease-out cubic for smooth slide
        const eased = 1 - Math.pow(1 - t, 3);
        // Shift watch to the right by up to 18% of viewport width
        return eased * window.innerWidth * 0.18;
    }

    // ── UPDATE LOOP ──
    function update() {
        scrollProgress = getScrollProgress();

        // Canvas offset
        const newOffset = getCanvasOffset(scrollProgress);

        // Map scroll to animation progress (with pause zones)
        const animProg = scrollToAnimProgress(scrollProgress);

        // Frame
        const targetFrame = animProgressToFrame(animProg);
        if (targetFrame !== currentFrame || newOffset !== canvasOffsetX) {
            currentFrame = targetFrame;
            canvasOffsetX = newOffset;
            drawFrame(currentFrame, canvasOffsetX);
        }

        // Beats
        for (const [key, beat] of Object.entries(BEATS)) {
            const el = beatElements[key];
            const opacity = beatOpacity(scrollProgress, beat);
            const translate = (1 - opacity) * 18;      // subtle slide up
            el.style.opacity = opacity;
            el.style.transform = `translateY(${translate}px)`;
        }

        // Navbar
        if (window.scrollY > 60) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }

        requestAnimationFrame(update);
    }

    // ── INIT ──
    async function init() {
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);

        await preloadFrames();

        // Hide loader
        loader.classList.add('hidden');
        isReady = true;

        // Draw first frame
        currentFrame = 0;
        drawFrame(0);

        // Start animation loop
        requestAnimationFrame(update);
    }

    // Wait for DOM then launch
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
