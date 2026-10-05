// 🦖 Chrome Dino auto-play bot (pixel-vision edition)
// stop anytime: dinoBot.stop()
(() => {
  const AUTO_RESTART = false; // true = restarts by itself after a crash

  if (window.dinoBot) window.dinoBot.stop();
  const canvas = document.querySelector('.runner-canvas');
  if (!canvas) return console.warn('🦖 open chrome://dino first, then paste again');
  const ctx = canvas.getContext('2d');

  // game coords (game is 150px tall, ~600px wide)
  const BAND_TOP = 86, BAND_BOT = 127; // below clouds, above the bumpy ground
  const FRAME = 1000 / 60;
  const JUMP_A = 10, JUMP_B = -20, JUMP_MIN = 28; // jump timing
  const DUCK_A = 6, DUCK_B = 20, CLEAR_MARGIN = 4;

  const UP = 38, DOWN = 40;
  const key = (type, keyCode) =>
    document.dispatchEvent(new KeyboardEvent(type, { keyCode, bubbles: true, cancelable: true }));

  let running = true, raf = 0, speed = 6 / FRAME, track = null;
  let down = false, dropping = false, rose = true;
  let duckUntil = 0, clearAt = 0, jumpAt = 0;
  let lastSig = '', frozen = 0, frozenSince = 0;
  // where the dino's tail is (auto-detected, it can stop short of x=50 if the intro lags)
  const seen = new Array(130).fill(0);
  let tail = 51; seen[tail] = 5;

  const solid = (d, i) => d[i + 3] > 128 && d[i] < 150; // dark sprite pixels only

  function look() {
    const s = canvas.height / 150, cw = canvas.width, W = Math.floor(cw / s);
    const at = (data, w, x, y) => (Math.floor((y + 0.5) * s) * w + Math.floor((x + 0.5) * s)) * 4;

    // 1) find the dino: leftmost dark column at ground level, smoothed over recent frames
    const lw = Math.floor(130 * s);
    const left = ctx.getImageData(0, 0, lw, Math.floor(BAND_BOT * s)).data;
    for (let i = 0; i < seen.length; i++) seen[i] *= 0.97;
    find: for (let x = 0; x < 120; x++)
      for (let y = 93; y < BAND_BOT; y++)
        if (solid(left, at(left, lw, x, y))) { seen[x]++; break find; }
    for (let i = 0; i < 120; i++) if (seen[i] > seen[tail]) tail = i;

    const dinoX = tail - 1, front = tail + 43, scanX0 = tail + 61;

    // 2) dino height = lowest blob in its columns (so the moon can't fool it)
    const rowHas = (y) => {
      for (let x = dinoX; x < dinoX + 44; x++) if (solid(left, at(left, lw, x, y))) return true;
      return false;
    };
    let top = BAND_BOT - 1;
    while (top >= 0 && !rowHas(top)) top--;
    while (top > 0 && rowHas(top - 1)) top--;

    // 3) obstacles in front of the dino
    const y0 = Math.floor(BAND_TOP * s);
    const band = ctx.getImageData(0, y0, cw, Math.ceil((BAND_BOT - BAND_TOP) * s)).data;
    const objs = [];
    let cur = null, gap = 0;
    for (let x = scanX0; x < W; x++) {
      const px = Math.floor((x + 0.5) * s);
      let hi = -1;
      for (let y = BAND_TOP; y < BAND_BOT; y++) {
        const py = Math.floor((y + 0.5) * s) - y0;
        if (solid(band, (py * cw + px) * 4)) hi = y;
      }
      if (hi >= 0) {
        if (!cur) objs.push(cur = { left: x, right: x, maxY: hi });
        cur.right = x; cur.maxY = Math.max(cur.maxY, hi); gap = 0;
      } else if (cur && ++gap > 10) cur = null;
    }
    for (const o of objs) {
      o.clipped = o.left === scanX0; // already sliding under the dino
      o.type = o.maxY >= 118 ? 'jump' : o.maxY >= 96 ? 'duck' : 'ignore';
    }
    return { objs, dinoTop: top < 0 ? 999 : top, front, scanX0 };
  }

  function measure(o, now) {
    if (!o) { track = null; return speed; }
    if (track && o.left <= track.left && track.left - o.left < 80) {
      track.left = o.left;
      const dt = now - track.t0;
      if (dt > 50) {
        const v = (track.x0 - o.left) / dt;
        if (v > 0.2 && v < 1.3) { track.v = v; speed += (v - speed) * 0.1; }
      }
    } else track = { left: o.left, x0: o.left, t0: now, v: 0 };
    return track.v || speed;
  }

  const setDown = (on) => { if (on !== down) { down = on; key(on ? 'keydown' : 'keyup', DOWN); } };

  function jump(o, now, v) {
    setDown(false); dropping = false;
    key('keydown', UP); key('keyup', UP);
    jumpAt = now; rose = false;
    clearAt = now + (o.right - tail + CLEAR_MARGIN) / v; // when it's fully behind us
  }

  function loop(now) {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    const { objs, dinoTop, front, scanX0 } = look();

    // nothing moving = game over / paused -> chill
    const sig = objs.map(o => o.left + ':' + o.right).join(',');
    frozen = sig && sig === lastSig ? frozen + 1 : 0;
    lastSig = sig;
    if (frozen > 3) {
      if (frozen === 4) frozenSince = now;
      setDown(false); dropping = false; clearAt = 0; rose = true;
      if (AUTO_RESTART && now - frozenSince > 1500) { key('keydown', UP); key('keyup', UP); frozenSince = now; }
      return;
    }

    const next = objs.find(o => !o.clipped && o.type !== 'ignore');
    const v = measure(next || objs.find(o => !o.clipped), now);
    const vF = v * FRAME;

    // jump didn't take off? allow a retry
    if (!rose && dinoTop < 88) rose = true;
    if (!rose && now - jumpAt > 60) { rose = true; clearAt = 0; }

    const airborne = now < clearAt || dinoTop < 93;
    if (dropping && !airborne) dropping = false; // landed

    // mid-height bird -> duck and stay down till it passes
    let wantDuck = false;
    if (next && next.type === 'duck' && now >= clearAt &&
        next.left - front < DUCK_A * vF + DUCK_B) {
      wantDuck = true;
      duckUntil = now + (next.right - tail + 5) / v;
    }
    // obstacle cleared but still in the air -> fast-fall
    if (airborne && jumpAt && now >= clearAt) dropping = true;

    setDown(wantDuck || dropping || (down && now <= duckUntil));
    if (airborne || now <= duckUntil) return;

    // running late and a cactus is at our toes -> jump NOW
    const late = objs.find(o => o.clipped && o.type === 'jump');
    if (late) return jump(late, now, v);

    if (next && next.type === 'jump') {
      const d = next.left - front;
      const trigger = Math.max(JUMP_A * vF + JUMP_B, scanX0 - front + vF + JUMP_MIN);
      if (d <= trigger) jump(next, now, v);
    }
  }

  raf = requestAnimationFrame(loop);
  window.dinoBot = {
    stop() { running = false; cancelAnimationFrame(raf); setDown(false); console.log('🦖 bot stopped'); },
  };
  console.log('🦖 bot running, press Space to start. Stop with dinoBot.stop()');
})();
