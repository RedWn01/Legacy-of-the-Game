(() => {
  const canvas = document.getElementById('sky');
  const ctx = canvas.getContext('2d');
  const panel = document.getElementById('panel');
  const hint = document.getElementById('hint');

  let dpr = 1, W = 0, H = 0;
  const cam = { x: 0, y: 0, z: 1 };
  let clusters = [];   // {year, cx, cy, files:[{name, quote, attachments, x, y, r, phase}], attachments}
  let bgStars = [];
  let dust = [];       // milky-way haze blobs
  let meteors = [];
  let hoverStar = null;
  let focusStar = null;   // the chosen star, drawn with an extra shine

  const STAR_TINTS = ['#f2ecdc', '#dfe6ff', '#ffe3c4', '#e8f4f0'];

  // deterministic pseudo-random from a string seed
  function seeded(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return () => {
      h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
      return ((h >>> 0) % 100000) / 100000;
    };
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  }
  window.addEventListener('resize', resize);
  resize();

  function layout(data) {
    const years = data.years;
    const n = years.length || 1;
    // clusters scattered across a 2D field (golden-angle spiral + jitter)
    const aspect = Math.max(W / H, 0.6);
    const spanX = Math.max(1600, n * 300) * aspect;
    const spanY = Math.max(1200, n * 300);
    clusters = years.map((y, i) => {
      const rand = seeded('cluster:' + y.year);
      const t = n === 1 ? 0.5 : i / (n - 1);
      const ang = i * 2.39996 + rand() * 0.8;      // golden angle keeps arms apart
      const rad = Math.sqrt(t);
      const cx = Math.cos(ang) * rad * spanX * 0.5 + (rand() - 0.5) * 240;
      const cy = Math.sin(ang) * rad * spanY * 0.5 + (rand() - 0.5) * 240;
      const spread = 90 + Math.sqrt(y.files.length) * 55;
      const files = y.files.map(f => {
        const r = seeded(y.year + '/' + f.name);
        if (f.name.toLowerCase() === 'overview') {
          // the overview node anchors the heart of its cluster
          return {
            ...f,
            x: cx,
            y: cy,
            r: 3 + Math.min(f.attachments.length, 4) * 0.5,
            phase: r() * Math.PI * 2,
          };
        }
        const ang = r() * Math.PI * 2;
        // keep the middle clear for the overview node (spread >= 90 always)
        const dist = Math.pow(r(), 0.6) * spread * 0.82 + 18;
        return {
          ...f,
          x: cx + Math.cos(ang) * dist * 1.25,
          y: cy + Math.sin(ang) * dist,
          r: 2.2 + r() * 2.6 + Math.min(f.attachments.length, 4) * 0.5,
          phase: r() * Math.PI * 2,
        };
      });
      return { year: y.year, cx, cy, spread, files, attachments: y.attachments };
    });

    // static background starfield in world space, on two depth layers for parallax
    bgStars = [];
    const rand = seeded('background');
    const spanX2 = spanX * 1.3, spanY2 = spanY * 1.3;
    const mwY = x => x * 0.22 - 120;             // milky-way centerline: gentle diagonal
    for (let i = 0; i < 1500; i++) {
      const inBand = rand() < 0.45;
      const x = (rand() - 0.5) * spanX2;
      const y = inBand
        ? mwY(x) + (rand() + rand() - 1) * 260   // clustered around the band
        : (rand() - 0.5) * spanY2;
      bgStars.push({
        x, y,
        r: rand() * 1.1 + 0.2,
        a: rand() * 0.5 + 0.12,
        depth: rand() < 0.5 ? 0.55 : 0.8,        // parallax factor
        tint: STAR_TINTS[Math.floor(rand() * STAR_TINTS.length)],
        phase: rand() * Math.PI * 2,
      });
    }
    // a few bright field stars with diffraction spikes
    for (let i = 0; i < 26; i++) {
      bgStars.push({
        x: (rand() - 0.5) * spanX2,
        y: (rand() - 0.5) * spanY2,
        r: 1.6 + rand() * 1.2,
        a: 0.8,
        depth: 0.85,
        tint: STAR_TINTS[Math.floor(rand() * STAR_TINTS.length)],
        phase: rand() * Math.PI * 2,
        bright: true,
      });
    }
    // milky-way haze blobs along the band
    dust = [];
    for (let i = 0; i < 60; i++) {
      const x = (rand() - 0.5) * spanX2;
      dust.push({
        x,
        y: mwY(x) + (rand() + rand() - 1) * 200,
        r: 120 + rand() * 260,
        a: 0.02 + rand() * 0.035,
        hue: 205 + rand() * 25,
      });
    }
  }

  const toScreen = (x, y) => [(x - cam.x) * cam.z + W / 2, (y - cam.y) * cam.z + H / 2];
  const toScreenDepth = (x, y, d) => [(x - cam.x * d) * cam.z + W / 2, (y - cam.y * d) * cam.z + H / 2];
  const toWorld = (sx, sy) => [(sx - W / 2) / cam.z + cam.x, (sy - H / 2) / cam.z + cam.y];

  function draw(time) {
    if (W !== window.innerWidth || H !== window.innerHeight) resize();
    const t = time / 1000;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // deep sky gradient
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#070510');
    g.addColorStop(0.6, '#0b0820');
    g.addColorStop(1, '#141031');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // milky-way haze (deepest layer, strongest parallax lag)
    for (const d of dust) {
      const [sx, sy] = toScreenDepth(d.x, d.y, 0.45);
      const rad = d.r * cam.z;
      if (sx < -rad || sx > W + rad || sy < -rad || sy > H + rad) continue;
      const hg = ctx.createRadialGradient(sx, sy, 0, sx, sy, rad);
      hg.addColorStop(0, `hsla(${d.hue}, 55%, 72%, ${d.a})`);
      hg.addColorStop(1, 'transparent');
      ctx.fillStyle = hg;
      ctx.fillRect(sx - rad, sy - rad, rad * 2, rad * 2);
    }

    // nebula glow behind each cluster
    for (const c of clusters) {
      const [sx, sy] = toScreen(c.cx, c.cy);
      const rad = (c.spread + 160) * cam.z;
      if (sx < -rad || sx > W + rad || sy < -rad || sy > H + rad) continue;
      const ng = ctx.createRadialGradient(sx, sy, 0, sx, sy, rad);
      const hue = 205 + (seeded('hue:' + c.year)() * 5 | 0) * 6;
      ng.addColorStop(0, `hsla(${hue}, 70%, 55%, 0.13)`);
      ng.addColorStop(1, 'transparent');
      ctx.fillStyle = ng;
      ctx.fillRect(sx - rad, sy - rad, rad * 2, rad * 2);
    }

    // background stars (parallax layers)
    for (const s of bgStars) {
      const [sx, sy] = toScreenDepth(s.x, s.y, s.depth);
      if (sx < -8 || sx > W + 8 || sy < -8 || sy > H + 8) continue;
      const tw = 0.65 + 0.35 * Math.sin(t * 1.4 + s.phase);
      const r = s.r * cam.z;
      ctx.globalAlpha = s.a * tw;
      ctx.fillStyle = s.tint;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, 7);
      ctx.fill();
      if (s.bright) {
        ctx.globalAlpha = 0.3 * tw;
        ctx.strokeStyle = s.tint;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(sx - r * 5, sy); ctx.lineTo(sx + r * 5, sy);
        ctx.moveTo(sx, sy - r * 5); ctx.lineTo(sx, sy + r * 5);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // shooting stars
    if (Math.random() < 0.004 && meteors.length < 2) {
      const fromLeft = Math.random() < 0.5;
      meteors.push({
        x: Math.random() * W, y: Math.random() * H * 0.5,
        vx: (fromLeft ? 1 : -1) * (7 + Math.random() * 6),
        vy: 3 + Math.random() * 3,
        life: 1,
      });
    }
    for (let i = meteors.length - 1; i >= 0; i--) {
      const m = meteors[i];
      m.x += m.vx; m.y += m.vy; m.life -= 0.016;
      if (m.life <= 0) { meteors.splice(i, 1); continue; }
      const trail = ctx.createLinearGradient(m.x, m.y, m.x - m.vx * 12, m.y - m.vy * 12);
      trail.addColorStop(0, `rgba(255, 245, 220, ${0.85 * m.life})`);
      trail.addColorStop(1, 'transparent');
      ctx.strokeStyle = trail;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(m.x, m.y);
      ctx.lineTo(m.x - m.vx * 12, m.y - m.vy * 12);
      ctx.stroke();
    }

    for (const c of clusters) {
      // constellation lines: connect each star to its nearest neighbor,
      // collecting unique edges so every star is linked to at least one other
      ctx.strokeStyle = 'rgba(200, 205, 255, 0.35)';
      ctx.lineWidth = 2;
      const edges = new Set();
      for (let i = 0; i < c.files.length; i++) {
        let best = -1, bd = Infinity;
        for (let j = 0; j < c.files.length; j++) {
          if (i === j) continue;
          const d = (c.files[i].x - c.files[j].x) ** 2 + (c.files[i].y - c.files[j].y) ** 2;
          if (d < bd) { bd = d; best = j; }
        }
        const [a, b] = i < best ? [i, best] : [best, i];
        edges.add(`${a},${b}`);
      }
      for (const e of edges) {
        const [i, j] = e.split(',').map(Number);
        const [ax, ay] = toScreen(c.files[i].x, c.files[i].y);
        const [bx, by] = toScreen(c.files[j].x, c.files[j].y);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      }

      // stars
      for (const f of c.files) {
        const [sx, sy] = toScreen(f.x, f.y);
        if (sx < -30 || sx > W + 30 || sy < -30 || sy > H + 30) continue;
        const isHover = hoverStar === f;
        const isFocus = focusStar === f;
        const tw = 0.75 + 0.25 * Math.sin(t * 2 + f.phase);
        const r = f.r * cam.z * (isHover || isFocus ? 1.6 : 1);

        const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 6);
        glow.addColorStop(0, `rgba(255, 236, 190, ${(isFocus ? 0.75 : 0.5) * tw})`);
        glow.addColorStop(1, 'transparent');
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(sx, sy, r * 6, 0, 7); ctx.fill();

        // chosen star: a slow-breathing halo ring and wider shine
        if (isFocus) {
          const pulse = 0.5 + 0.5 * Math.sin(t * 2.2);
          const halo = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 11);
          halo.addColorStop(0, `rgba(255, 225, 160, ${0.22 + 0.12 * pulse})`);
          halo.addColorStop(1, 'transparent');
          ctx.fillStyle = halo;
          ctx.beginPath(); ctx.arc(sx, sy, r * 11, 0, 7); ctx.fill();

          ctx.strokeStyle = `rgba(255, 217, 138, ${0.25 + 0.3 * pulse})`;
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(sx, sy, r * (5 + pulse * 1.5), 0, 7); ctx.stroke();
        }

        ctx.fillStyle = isHover ? '#fff3d0' : '#f2ecdc';
        ctx.globalAlpha = tw;
        ctx.beginPath(); ctx.arc(sx, sy, r, 0, 7); ctx.fill();
        ctx.globalAlpha = 1;

        // cross sparkle
        ctx.strokeStyle = `rgba(255, 240, 200, ${0.35 * tw})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sx - r * 3, sy); ctx.lineTo(sx + r * 3, sy);
        ctx.moveTo(sx, sy - r * 3); ctx.lineTo(sx, sy + r * 3);
        ctx.stroke();

        if (isHover) {
          ctx.font = `${Math.max(13, 14 * cam.z)}px Changa, Marcellus, Amiri, serif`;
          ctx.fillStyle = 'rgba(255, 217, 138, 0.95)';
          ctx.textAlign = 'center';
          ctx.fillText(f.name, sx, sy - r * 4 - 8);
        }
      }

      // year label
      const [lx, ly] = toScreen(c.cx, c.cy + c.spread + 70);
      ctx.font = `${Math.max(16, 26 * cam.z)}px Changa, Marcellus, Amiri, serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255, 217, 138, 0.75)';
      ctx.letterSpacing = '6px';
      ctx.fillText(c.year, lx, ly);
      ctx.letterSpacing = '0px';
    }

    requestAnimationFrame(draw);
  }

  // ---------- interaction ----------
  const pointers = new Map();
  let dragging = false, moved = 0, lastPinch = 0;
  const vel = { x: 0, y: 0 };

  function starAt(sx, sy) {
    const [wx, wy] = toWorld(sx, sy);
    const hitR = 18 / cam.z;
    let best = null, bd = hitR * hitR;
    for (const c of clusters) for (const f of c.files) {
      const d = (f.x - wx) ** 2 + (f.y - wy) ** 2;
      if (d < bd) { bd = d; best = { star: f, cluster: c }; }
    }
    return best;
  }

  canvas.addEventListener('pointerdown', e => {
    try { canvas.setPointerCapture(e.pointerId); } catch {}
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    dragging = true; moved = 0;
    vel.x = vel.y = 0;
    glide = null;
    canvas.classList.add('dragging');
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      lastPinch = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });

  canvas.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) {
      const hit = starAt(e.clientX, e.clientY);
      const next = hit ? hit.star : null;
      if (next !== hoverStar) { hoverStar = next; canvas.style.cursor = next ? 'pointer' : 'grab'; }
      return;
    }
    const p = pointers.get(e.pointerId);
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    moved += Math.abs(dx) + Math.abs(dy);

    if (pointers.size === 1) {
      cam.x -= dx / cam.z; cam.y -= dy / cam.z;
      vel.x = -dx / cam.z; vel.y = -dy / cam.z;
      hint.classList.add('gone');
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (lastPinch) cam.z = Math.min(3, Math.max(0.3, cam.z * (d / lastPinch)));
      lastPinch = d;
    }
  });

  function endPointer(e) {
    if (pointers.has(e.pointerId) && pointers.size === 1 && moved < 6) {
      const hit = starAt(e.clientX, e.clientY);
      if (hit) glideToStar(hit.cluster.year, hit.star.name);
      else {
        closePanel();
        // tapping a year label glides to its cluster
        const [wx, wy] = toWorld(e.clientX, e.clientY);
        const label = clusters.find(c =>
          Math.abs(wx - c.cx) < 120 / cam.z && Math.abs(wy - (c.cy + c.spread + 70)) < 30 / cam.z);
        if (label) glideTo(label.cx, label.cy, Math.max(cam.z, 0.9));
      }
    }
    pointers.delete(e.pointerId);
    lastPinch = 0;
    if (!pointers.size) { dragging = false; canvas.classList.remove('dragging'); startCoast(); }
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  // inertia: on-demand rAF, only while the view is still gliding
  let coasting = false;
  function coast() {
    if (dragging || (Math.abs(vel.x) <= 0.05 && Math.abs(vel.y) <= 0.05)) { coasting = false; return; }
    cam.x += vel.x; cam.y += vel.y;
    vel.x *= 0.93; vel.y *= 0.93;
    requestAnimationFrame(coast);
  }
  function startCoast() {
    if (coasting || dragging || (Math.abs(vel.x) <= 0.05 && Math.abs(vel.y) <= 0.05)) return;
    coasting = true;
    requestAnimationFrame(coast);
  }

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0012);
    const [wx, wy] = toWorld(e.clientX, e.clientY);
    cam.z = Math.min(3, Math.max(0.3, cam.z * factor));
    // keep point under cursor fixed
    cam.x = wx - (e.clientX - W / 2) / cam.z;
    cam.y = wy - (e.clientY - H / 2) / cam.z;
    hint.classList.add('gone');
  }, { passive: false });

  // ---------- ambient music ----------
  // loops an audio file; started by the first user gesture (autoplay policy)
  const MUSIC_URL = 'music.mp3';
  const btnMusic = document.getElementById('btn-music');
  const audio = new Audio(MUSIC_URL);
  audio.loop = true;
  audio.preload = 'auto';
  let musicOn = true;
  let started = false;

  function startMusic() {          // must be called from a user gesture
    started = true;
    if (!musicOn) return;
    audio.play().catch(() => {});  // ignore if the file is missing
  }
  function toggleMusic() {
    musicOn = !musicOn;
    btnMusic.classList.toggle('off', !musicOn);
    if (musicOn) { if (started) audio.play().catch(() => {}); }
    else audio.pause();
  }
  btnMusic.addEventListener('click', e => { e.stopPropagation(); toggleMusic(); });
  canvas.addEventListener('pointerdown', () => { if (musicOn) startMusic(); }, { once: true });

  // ---------- ambient music end ----------

  // ---------- markdown ----------
  function renderMarkdown(md) {
    const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const inline = s => s
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/(^|\s)_(.+?)_(?=\s|$|[.,;:!?])/g, '$1<em>$2</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
    return esc(md.trim()).split(/\n{2,}/).map(block => {
      const b = block.trim();
      if (!b) return '';
      let m;
      if (/^(-{3,}|\*{3,})$/.test(b)) return '<hr>';
      if ((m = b.match(/^(#{1,3})\s+([\s\S]*)$/))) {
        const level = m[1].length + 1;
        return `<h${level}>${inline(m[2].split('\n')[0])}</h${level}>`;
      }
      if (b.startsWith('&gt;')) return `<blockquote>${inline(b.replace(/^&gt;\s?/gm, ''))}</blockquote>`;
      if (/^([-*]|\d+\.)\s/.test(b)) {
        const ordered = /^\d+\.\s/.test(b);
        const items = b.split('\n').map(l => l.replace(/^([-*]|\d+\.)\s+/, '')).map(l => `<li dir="auto">${inline(l)}</li>`).join('');
        return ordered ? `<ol>${items}</ol>` : `<ul>${items}</ul>`;
      }
      return `<p>${inline(b)}</p>`;
    }).join('');
  }

  // ---------- bidi ----------
  const RTL_CHAR = /[\u0591-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFC]/;
  const isRTL = s => RTL_CHAR.test(s);

  // ---------- panel ----------
  let currentStar = null; // {cluster, star}

  function closePanel() {
    panel.hidden = true;
    focusStar = null;
  }

  function openPanel(cluster, star) {
    currentStar = { cluster, star };
    focusStar = star;
    panel.querySelector('.panel-year').textContent = cluster.year;
    const titleEl = panel.querySelector('.panel-title');
    titleEl.textContent = star.name;
    titleEl.dir = isRTL(star.name) ? 'rtl' : 'ltr';
    const quoteEl = panel.querySelector('.panel-quote');
    quoteEl.innerHTML = renderMarkdown(star.quote);
    quoteEl.dir = isRTL(star.quote) ? 'rtl' : 'ltr';
    const attEl = panel.querySelector('.panel-attachments');
    attEl.innerHTML = '';
    if (star.attachments.length) {
      const label = document.createElement('p');
      label.className = 'att-label';
      label.textContent = 'Attachments';
      attEl.appendChild(label);
      for (const a of star.attachments) {
        if (a.type === 'image') {
          const img = document.createElement('img');
          img.src = a.url; img.alt = a.name; img.loading = 'lazy';
          attEl.appendChild(img);
        } else if (a.type === 'video') {
          const v = document.createElement('video');
          v.src = a.url; v.controls = true; v.playsInline = true;
          attEl.appendChild(v);
        } else {
          const link = document.createElement('a');
          link.className = 'pdf'; link.href = a.url; link.target = '_blank';
          link.textContent = '\u{1F4C4} ' + a.name;
          attEl.appendChild(link);
        }
      }
    }
    panel.hidden = false;
  }
  document.getElementById('panel-close').addEventListener('click', () => { closePanel(); });

  // ---------- panel resize ----------
  let panelWidth = Math.min(440, window.innerWidth);
  const panelResize = document.getElementById('panel-resize');
  function applyPanelWidth() {
    document.documentElement.style.setProperty('--panel-width', panelWidth + 'px');
  }
  applyPanelWidth();
  panelResize.addEventListener('pointerdown', e => {
    e.preventDefault();
    e.stopPropagation();
    panel.classList.add('resizing');
    panelResize.setPointerCapture(e.pointerId);
    const startX = e.clientX, startW = panelWidth;
    const move = ev => {
      panelWidth = Math.min(window.innerWidth, Math.max(260, startW + (startX - ev.clientX)));
      applyPanelWidth();
    };
    const up = () => {
      panel.classList.remove('resizing');
      panelResize.removeEventListener('pointermove', move);
      panelResize.removeEventListener('pointerup', up);
      panelResize.removeEventListener('pointercancel', up);
    };
    panelResize.addEventListener('pointermove', move);
    panelResize.addEventListener('pointerup', up);
    panelResize.addEventListener('pointercancel', up);
  });

  // ---------- camera glide ----------
  let glide = null;
  function glideTo(x, y, z) {
    glide = { fx: cam.x, fy: cam.y, fz: cam.z, tx: x, ty: y, tz: z, t0: performance.now(), dur: 1100 };
    (function step(now) {
      if (!glide) return;
      const p = Math.min(1, (now - glide.t0) / glide.dur);
      const e = 1 - Math.pow(1 - p, 3);
      cam.x = glide.fx + (glide.tx - glide.fx) * e;
      cam.y = glide.fy + (glide.ty - glide.fy) * e;
      cam.z = glide.fz + (glide.tz - glide.fz) * e;
      if (p < 1) requestAnimationFrame(step); else glide = null;
    })(performance.now());
  }
  function glideToStar(year, name, open = true) {
    const c = clusters.find(k => k.year === year);
    const f = c && c.files.find(k => k.name === name);
    if (!f) return;
    focusStar = f;      // shine starts during the glide
    const z = Math.max(cam.z, 1);
    // center the star in the space left of the quote panel
    const panelW = W > 600 ? Math.min(panelWidth, W) : 0;
    glideTo(f.x + panelW / 2 / z, f.y, z);
    if (open) setTimeout(() => openPanel(c, f), 900);
  }

  // ---------- data refresh ----------
  async function fetchSky() {
    // static build: data embedded in the page (works even from file://)
    if (window.__SKY_DATA__) return window.__SKY_DATA__;
    try {
      const r = await fetch('/api/sky');
      if (!r.ok) throw new Error(String(r.status));
      return await r.json();
    } catch {
      return (await fetch('sky.json')).json();
    }
  }

  async function refresh(focus) {
    const data = await fetchSky();
    layout(data);
    if (focus) glideToStar(focus.year, focus.name, focus.open !== false);
  }

  // ---------- search ----------
  const search = document.getElementById('search');
  const searchInput = document.getElementById('search-input');
  const searchResults = document.getElementById('search-results');
  let searchIndex = 0;

  function openSearch() { search.hidden = false; searchInput.value = ''; searchResults.innerHTML = ''; searchInput.focus(); }
  function closeSearch() { search.hidden = true; }
  document.getElementById('btn-search').addEventListener('click', openSearch);

  function searchMatches(qtext) {
    const q = qtext.toLowerCase();
    if (!q) return [];
    return clusters.flatMap(c => c.files
      .filter(f => f.name.toLowerCase().includes(q) || f.quote.toLowerCase().includes(q))
      .map(f => ({ year: c.year, name: f.name }))).slice(0, 8);
  }
  function renderSearch() {
    const matches = searchMatches(searchInput.value);
    searchIndex = Math.min(searchIndex, Math.max(0, matches.length - 1));
    searchResults.innerHTML = '';
    matches.forEach((m, i) => {
      const li = document.createElement('li');
      li.dir = 'auto';
      li.innerHTML = `<span>${m.name}</span><span class="yr">${m.year}</span>`;
      if (i === searchIndex) li.classList.add('active');
      li.addEventListener('click', () => { closeSearch(); glideToStar(m.year, m.name); });
      searchResults.appendChild(li);
    });
    return matches;
  }
  searchInput.addEventListener('input', () => { searchIndex = 0; renderSearch(); });
  searchInput.addEventListener('keydown', e => {
    const matches = searchMatches(searchInput.value);
    if (e.key === 'ArrowDown') { searchIndex = (searchIndex + 1) % Math.max(1, matches.length); renderSearch(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { searchIndex = (searchIndex - 1 + matches.length) % Math.max(1, matches.length); renderSearch(); e.preventDefault(); }
    else if (e.key === 'Enter' && matches[searchIndex]) {
      const m = matches[searchIndex];
      closeSearch();
      glideToStar(m.year, m.name);
    }
  });

  // ---------- archive ----------
  const archive = document.getElementById('archive');
  const archiveList = document.getElementById('archive-list');

  function snippet(md) {
    const line = md.split('\n').map(l => l.trim()).find(l => l && !/^#{1,3}\s/.test(l)) || '';
    return line.replace(/^>\s?/, '').replace(/[*_`>#]/g, '').slice(0, 90);
  }

  function openArchive() {
    archiveList.innerHTML = '';
    for (const c of [...clusters].sort((a, b) => b.year.localeCompare(a.year))) {
      const head = document.createElement('div');
      head.className = 'arch-year';
      head.dir = 'auto';
      head.innerHTML = `<h3>${c.year}</h3><span class="count">${c.files.length} star${c.files.length === 1 ? '' : 's'}</span>`;
      archiveList.appendChild(head);
      for (const f of [...c.files].sort((a, b) => a.name.localeCompare(b.name))) {
        const btn = document.createElement('button');
        btn.className = 'arch-star';
        btn.dir = 'auto';
        const name = document.createElement('span');
        name.className = 'st-name';
        name.textContent = f.name;
        if (f.attachments.length) {
          const att = document.createElement('span');
          att.className = 'st-att';
          att.textContent = `${f.attachments.length} kept`;
          name.appendChild(att);
        }
        const snip = document.createElement('span');
        snip.className = 'st-snippet';
        snip.textContent = snippet(f.quote);
        btn.append(name, snip);
        btn.addEventListener('click', () => { closeArchive(); glideToStar(c.year, f.name); });
        archiveList.appendChild(btn);
      }
    }
    archive.hidden = false;
  }
  function closeArchive() { archive.hidden = true; }
  document.getElementById('archive-close').addEventListener('click', closeArchive);
  document.getElementById('btn-archive').addEventListener('click', openArchive);

  // ---------- drift ----------
  document.getElementById('btn-drift').addEventListener('click', () => {
    const all = clusters.flatMap(c => c.files.map(f => ({ year: c.year, name: f.name })));
    if (!all.length) return;
    const pick = all[Math.floor(Math.random() * all.length)];
    closePanel();
    glideToStar(pick.year, pick.name);
  });

  // ---------- global keys ----------
  window.addEventListener('keydown', e => {
    const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
    if (e.key === 'Escape') {
      if (!search.hidden) closeSearch();
      else if (!archive.hidden) closeArchive();
      else closePanel();
    } else if (e.key === '/' && !typing) {
      e.preventDefault();
      openSearch();
    } else if (e.key === 'm' && !typing) {
      toggleMusic();
    } else if (e.key === 'a' && !typing && archive.hidden) {
      openArchive();
    }
  });

  function fitView() {
    if (!clusters.length) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const c of clusters) {
      minX = Math.min(minX, c.cx - c.spread); maxX = Math.max(maxX, c.cx + c.spread);
      minY = Math.min(minY, c.cy - c.spread); maxY = Math.max(maxY, c.cy + c.spread + 90);
    }
    cam.x = (minX + maxX) / 2;
    cam.y = (minY + maxY) / 2;
    // fit the whole field to the screen on both axes, with a small margin
    cam.z = Math.min(1, Math.max(0.3, Math.min(W / (maxX - minX + 160), H / (maxY - minY + 160))));
  }

  fetchSky()
    .then(data => { layout(data); fitView(); window.__sky = { cam, get clusters() { return clusters; }, toScreen };requestAnimationFrame(draw); })
    .catch(err => console.error('failed to load sky', err));
})();
