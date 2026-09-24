// Fondo de inicio: la noche se convierte en día según el progreso del scroll,
// y al final aparece un paisaje pixel-art (montañas, pinos, pradera y pasto) por capas.
(function () {
    const sky = document.querySelector('.sky');
    if (!sky) return;

    const clamp01 = (x) => Math.min(1, Math.max(0, x));
    const smooth = (a, b, x) => {
        const t = clamp01((x - a) / (b - a));
        return t * t * (3 - 2 * t);
    };

    // ---------- Utilidades de pixel-art ----------
    const W = 480; // resolución lógica del paisaje (se escala con image-rendering: pixelated)
    const H = 220;

    const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
    const C = (h) => hex(h);

    const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]
        .map((row) => row.map((v) => (v + 0.5) / 16));
    // Mezcla dos colores con trama ordenada (dithering), típica del pixel-art
    const dith = (x, y, t, c1, c2) => (t > BAYER[y & 3][x & 3] ? c2 : c1);

    const makeRand = (seed) => {
        let s = seed;
        return () => {
            s = (s * 16807) % 2147483647;
            return (s - 1) / 2147483646;
        };
    };

    const hash = (x, y, seed) => {
        let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) | 0;
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
    };

    const noise = (x, y, seed) => {
        const xi = Math.floor(x), yi = Math.floor(y);
        const xf = x - xi, yf = y - yi;
        const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
        const a = hash(xi, yi, seed), b = hash(xi + 1, yi, seed);
        const c = hash(xi, yi + 1, seed), d = hash(xi + 1, yi + 1, seed);
        return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };

    function createLayer(w = W, h = H) {
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        const img = ctx.createImageData(w, h);
        const d = img.data;
        return {
            canvas,
            set(x, y, c) {
                x = Math.floor(x);
                y = Math.floor(y);
                if (x < 0 || y < 0 || x >= w || y >= h) return;
                const i = (y * w + x) * 4;
                d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
            },
            done() {
                ctx.putImageData(img, 0, 0);
                return canvas;
            }
        };
    }

    // Pino por niveles: lado izquierdo iluminado, derecho en sombra
    function pine(L, cx, baseY, h, maxHalf, pal) {
        const trunkH = Math.max(2, Math.round(h * 0.09));
        const crownH = h - trunkH;
        const tiers = Math.max(3, Math.round(crownH / 10));
        const tierH = crownH / tiers;
        for (let y = 0; y < crownH; y++) {
            const tier = Math.min(tiers - 1, Math.floor(y / tierH));
            const local = (y - tier * tierH) / tierH;
            const reach = 1.5 + (maxHalf - 1.5) * ((tier + 1) / tiers);
            const half = Math.max(0, Math.round((0.15 + 0.85 * local) * reach));
            const sy = baseY - h + y;
            for (let dx = -half; dx <= half; dx++) {
                let c = dx > 0 ? pal.dark : pal.mid;
                if (dx === -half && half > 1) c = pal.light;
                if (local > 0.8 && dx > -half) c = pal.dark;
                L.set(cx + dx, sy, c);
            }
        }
        for (let y = 0; y < trunkH; y++) {
            L.set(cx, baseY - trunkH + y, pal.trunk);
            if (h > 30) L.set(cx + 1, baseY - trunkH + y, pal.trunk);
        }
    }

    // Florcita rosa; el tamaño crece con la cercanía
    function flower(L, x, y, size) {
        const pink = C('#e58bc0'), light = C('#f9d3e6'), gold = C('#f5c73a'), stem = C('#2f7a3a');
        if (size <= 1) {
            L.set(x, y, pink);
            L.set(x, y + 1, stem);
        } else if (size === 2) {
            L.set(x, y - 1, pink); L.set(x - 1, y, pink); L.set(x + 1, y, pink); L.set(x, y + 1, pink);
            L.set(x, y, gold);
            L.set(x, y + 2, stem); L.set(x, y + 3, stem);
        } else if (size === 3) {
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) L.set(x + dx, y + dy, pink);
            L.set(x - 1, y - 1, light); L.set(x, y - 1, light);
            L.set(x, y, gold);
            for (let i = 2; i < 6; i++) L.set(x, y + i, stem);
            L.set(x + 1, y + 4, stem); L.set(x + 2, y + 3, stem);
        } else {
            // flor grande de primer plano
            const r = 3;
            for (let dy = -r; dy <= r; dy++) {
                for (let dx = -r; dx <= r; dx++) {
                    if (dx * dx + dy * dy <= r * r + 1) L.set(x + dx, y + dy, dx + dy < -1 ? light : pink);
                }
            }
            L.set(x - 1, y - 1, gold); L.set(x, y - 1, gold); L.set(x - 1, y, gold); L.set(x, y, gold);
        }
    }

    // ---------- Capa 1: montañas ----------
    function drawMountains() {
        const L = createLayer();
        const peaks = [
            { cx: 70, h: 134, w: 130 },
            { cx: 215, h: 174, w: 145 },
            { cx: 345, h: 108, w: 118 },
            { cx: 452, h: 132, w: 108 }
        ];
        const haze = C('#86ccc4');
        for (let x = 0; x < W; x++) {
            let best = 0, bi = 0;
            peaks.forEach((p, i) => {
                const v = p.h * Math.pow(Math.max(0, 1 - Math.abs(x - p.cx) / p.w), 1.12);
                if (v > best) { best = v; bi = i; }
            });
            const jag = noise(x * 0.12, 0, 3) * 7 + noise(x * 0.4, 0, 4) * 3;
            const ridge = Math.round(H - best - jag);
            for (let y = ridge; y < H; y++) {
                const depth = y - ridge;
                const wobble = (noise(y * 0.09, x * 0.02, 5) - 0.5) * 16;
                const lit = x + wobble < peaks[bi].cx;
                const n = noise(x * 0.08, y * 0.17, 6);
                let c;
                if (lit) {
                    c = n > 0.62 ? C('#5cae8a') : n > 0.36 ? C('#409482') : C('#2f7b76');
                    if (depth < 2) c = C('#a3dcb0');
                } else {
                    c = n > 0.6 ? C('#2d7074') : n > 0.3 ? C('#215c66') : C('#194b59');
                    if (depth < 1) c = C('#5ea79d');
                }
                const t = clamp01((y - (H - 105)) / 80) * 0.9 + (noise(x * 0.1, y * 0.1, 21) - 0.5) * 0.16;
                L.set(x, y, dith(x, y, t, c, haze));
            }
        }
        return L.done();
    }

    // ---------- Capa 2: colinas lejanas con bosque ----------
    function drawForestHills() {
        const L = createLayer();
        const rand = makeRand(23);
        const ridge = (x) => H - 88 - (10 * Math.sin(x * 0.018 + 0.6) + 6 * Math.sin(x * 0.05 + 2) + noise(x * 0.05, 0, 8) * 4);
        const top = C('#2b7853'), bot = C('#3f9a57'), lightPatch = C('#4aa95c');
        for (let x = 0; x < W; x++) {
            const r = Math.round(ridge(x));
            for (let y = r; y < H; y++) {
                const t = clamp01((y - r) / 55);
                let c = dith(x, y, t, top, bot);
                if (noise(x * 0.06, y * 0.15, 13) > 0.66) c = lightPatch;
                if (y === r) c = C('#5cbf6c');
                L.set(x, y, c);
            }
        }
        const pal = { dark: C('#134a45'), mid: C('#1b6350'), light: C('#2a8060'), trunk: C('#123a34') };
        for (let x = 2; x < W; x += 4 + Math.floor(rand() * 6)) {
            if (noise(x * 0.035, 3, 9) < 0.5) continue;
            const h = 8 + Math.floor(rand() * 8);
            pine(L, x, Math.round(ridge(x)) + 3, h, 2 + Math.floor(h / 5), pal);
        }
        return L.done();
    }

    // ---------- Capa 3: pradera con pinos grandes y flores ----------
    function drawMeadow() {
        const L = createLayer();
        const rand = makeRand(41);
        const ridge = (x) => H - 66 - (9 * Math.sin(x * 0.011 + 0.3) + 5 * Math.sin(x * 0.031 + 1.4) + noise(x * 0.04, 1, 10) * 3);
        const c1 = C('#8ad35e'), c2 = C('#5cb14b'), c3 = C('#3f9346');
        const lighter = C('#a9dd76'), darker = C('#398a42');

        for (let x = 0; x < W; x++) {
            const r = Math.round(ridge(x));
            const span = H - r;
            for (let y = r; y < H; y++) {
                const t = (y - r) / span;
                let c = t < 0.5 ? dith(x, y, t * 2, c1, c2) : dith(x, y, (t - 0.5) * 2, c2, c3);
                const n = noise(x * 0.05, y * 0.14, 12);
                if (n > 0.68) c = lighter;
                else if (n < 0.27) c = darker;
                const s = hash(x, y, 77);
                if (s < 0.05) c = darker;
                else if (s > 0.975) c = lighter;
                L.set(x, y, c);
            }
        }

        // Pinos grandes a los lados, como en la referencia
        const pal = { dark: C('#12463f'), mid: C('#1f6a57'), light: C('#3a916f'), trunk: C('#3b2a26') };
        pine(L, 22, H - 34, 92, 14, pal);
        pine(L, 62, H - 28, 66, 10, pal);
        pine(L, 456, H - 32, 82, 13, pal);
        pine(L, 420, H - 26, 52, 8, pal);

        // Matitas de pasto
        const tuft = C('#2f7d3c');
        for (let i = 0; i < 70; i++) {
            const x = Math.floor(rand() * W);
            const r = Math.round(ridge(x));
            const y = r + 6 + Math.floor(rand() * (H - r - 8));
            L.set(x, y, tuft); L.set(x - 1, y - 1, tuft); L.set(x + 1, y - 1, tuft); L.set(x, y - 2, tuft);
        }

        // Flores: más pequeñas lejos, más grandes cerca
        for (let i = 0; i < 90; i++) {
            const x = Math.floor(rand() * W);
            const r = Math.round(ridge(x));
            const y = r + 8 + Math.floor(rand() * (H - r - 16));
            const t = (y - r) / (H - r);
            flower(L, x, y, t < 0.25 ? 1 : t < 0.6 ? 2 : 3);
        }
        return L.done();
    }

    // ---------- Capa 4: pasto oscuro de primer plano ----------
    function drawForeground() {
        const L = createLayer();
        const rand = makeRand(59);

        // Hoja con base gruesa que se afina hacia la punta: [claro, medio, oscuro]
        const blade = (x, hb, lean, cols, wBase) => {
            for (let r = 0; r < hb; r++) {
                const t = r / hb;
                const xo = Math.round(x + lean * t * t);
                const y = H - 1 - r;
                const w = t < 0.35 ? wBase : t < 0.7 ? Math.max(1, wBase - 1) : 1;
                for (let i = 0; i < w; i++) {
                    L.set(xo + i, y, i === 0 ? cols[0] : i === w - 1 ? cols[2] : cols[1]);
                }
            }
        };

        for (let x = 0; x < W; x++) {
            for (let y = H - 12; y < H; y++) L.set(x, y, hash(x, y, 5) > 0.85 ? C('#0e3b28') : C('#0a2f20'));
        }

        // Hojas del fondo (verde más claro)
        const back = [C('#45ad55'), C('#1f8040'), C('#166a34')];
        for (let x = -3; x < W + 4; x += 2 + Math.floor(rand() * 2)) {
            let hb = 12 + rand() * 22;
            if (rand() < 0.1) hb += 16;
            blade(x, Math.round(hb), (rand() - 0.5) * 12, back, 2);
        }
        // Flores altas entre las hojas
        const stem = C('#155a2e');
        for (let i = 0; i < 10; i++) {
            const x = 16 + Math.floor(rand() * (W - 32));
            const sh = 24 + Math.floor(rand() * 18);
            const lean = (rand() - 0.5) * 6;
            for (let r = 0; r < sh; r++) {
                const t = r / sh;
                const sx = Math.round(x + lean * t * t);
                L.set(sx, H - 1 - r, stem);
                L.set(sx + 1, H - 1 - r, stem);
            }
            flower(L, Math.round(x + lean), H - sh - 2, 4);
        }
        // Hojas del frente (casi negro-verdoso, más gruesas)
        const front = [C('#1f7a41'), C('#0f4a2c'), C('#0a3a24')];
        for (let x = -3; x < W + 4; x += 3 + Math.floor(rand() * 3)) {
            let hb = 8 + rand() * 24;
            if (rand() < 0.08) hb += 12;
            blade(x, Math.round(hb), (rand() - 0.5) * 14, front, 3);
        }
        return L.done();
    }

    // ---------- Sol y nubes en pixel-art ----------
    function drawSun() {
        const size = 24;
        const L = createLayer(size, size);
        const mid = (size - 1) / 2;
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const dist = Math.hypot(x - mid, y - mid);
                if (dist > 11.6) continue;
                L.set(x, y, dist < 5 ? C('#fffbe0') : dist < 8 ? C('#ffe066') : dist < 10.3 ? C('#ffc93c') : C('#ffab2e'));
            }
        }
        return L.done();
    }

    function makeCloud(w, seed) {
        const rand = makeRand(seed);
        const h = Math.round(w * 0.42);
        const base = h - 1;
        const mask = new Uint8Array(w * h);
        const n = 4 + Math.floor(rand() * 3);
        for (let i = 0; i < n; i++) {
            const r = h * (0.3 + 0.36 * Math.sin(Math.PI * (i + 0.5) / n) * (0.75 + 0.25 * rand()));
            const cx = r + (w - 2 * r) * (i / (n - 1));
            const cy = base - r * 0.62;
            for (let y = 0; y <= base; y++) {
                for (let x = 0; x < w; x++) {
                    if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r) mask[y * w + x] = 1;
                }
            }
        }
        for (let y = base - 2; y <= base; y++) {
            for (let x = Math.round(w * 0.08); x < Math.round(w * 0.92); x++) mask[y * w + x] = 1;
        }
        const L = createLayer(w, h);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (!mask[y * w + x]) continue;
                let d = 0;
                while (d < 4 && y + 1 + d < h && mask[(y + 1 + d) * w + x]) d++;
                const c = d === 0 ? '#9fd6ee' : d === 1 ? '#bfe6f6' : d === 2 ? '#dbf3fb' : '#ffffff';
                L.set(x, y, C(c));
            }
        }
        return L.done();
    }

    function buildScene() {
        const layers = {
            mountains: drawMountains,
            hills: drawForestHills,
            meadow: drawMeadow,
            foreground: drawForeground
        };
        Object.keys(layers).forEach((name) => {
            const holder = sky.querySelector('.scene-' + name);
            if (holder) holder.appendChild(layers[name]());
        });

        const sun = sky.querySelector('.sky-sun');
        if (sun) sun.appendChild(drawSun());

        const clouds = sky.querySelector('.sky-clouds');
        if (clouds) {
            [
                { top: '20%', left: '8%', w: 46, s: 4.6, seed: 3 },
                { top: '36%', left: '64%', w: 38, s: 4, seed: 9 },
                { top: '12%', left: '46%', w: 30, s: 3.4, seed: 17 },
                { top: '48%', left: '26%', w: 34, s: 3.8, seed: 29 }
            ].forEach((c) => {
                const cv = makeCloud(c.w, c.seed);
                cv.className = 'cloud-px';
                cv.style.top = c.top;
                cv.style.left = c.left;
                cv.style.width = c.w * c.s + 'px';
                clouds.appendChild(cv);
            });
        }
    }

    // ---------- Progreso del scroll → variables CSS ----------
    let ticking = false;

    function update() {
        ticking = false;
        const max = document.documentElement.scrollHeight - window.innerHeight;
        const p = max > 0 ? clamp01(window.scrollY / max) : 0;
        const vh = window.innerHeight;

        const night = 1 - smooth(0.04, 0.5, p);   // estrellas se apagan
        const dawn = 1 - smooth(0.45, 0.85, p);   // tonos de amanecer se disuelven en el día
        const clouds = smooth(0.5, 0.85, p);
        const sunY = vh + 140 - smooth(0.2, 0.85, p) * (vh * 0.78 + 140);

        // Cada capa del paisaje sube a su ritmo: primero las montañas, al final el pasto de enfrente
        const rise = (a, b) => ((1 - smooth(a, b, p)) * 105).toFixed(1) + '%';

        const s = sky.style;
        s.setProperty('--night', night.toFixed(3));
        s.setProperty('--dawn', dawn.toFixed(3));
        s.setProperty('--clouds', clouds.toFixed(3));
        s.setProperty('--sun-y', sunY.toFixed(1) + 'px');
        s.setProperty('--cloud-x', (-p * 90).toFixed(1) + 'px');
        s.setProperty('--y-mountains', rise(0.4, 0.88));
        s.setProperty('--y-hills', rise(0.47, 0.93));
        s.setProperty('--y-meadow', rise(0.53, 0.97));
        s.setProperty('--y-foreground', rise(0.58, 1));
    }

    function onScroll() {
        if (!ticking) {
            ticking = true;
            requestAnimationFrame(update);
        }
    }

    buildScene();
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
})();
