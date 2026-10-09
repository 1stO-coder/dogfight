/**
 * Sky Ace: Dogfight Arena - 3D Perspective Flight & Multi-Aircraft Canvas Renderer
 * Native resolution: 960x540 at 60 FPS
 *
 * Implements:
 * 1. 3D Perspective Ground Grid & dynamic horizon based on pitch & roll.
 * 2. 3D Atmospheric speed streamers & cloud particles rushing past camera.
 * 3. Multi-Fighter Jet Rendering (up to 9 enemy pilots simultaneously):
 *    - Relative 3D-to-2D projection (distance scaling, banking tilt)
 *    - Callsign nametag, color-coded hull, mini overhead HP bar
 *    - Twin afterburner thruster flames
 *    - Dynamic engine smoke trails when damaged (HP < 50)
 *    - Glowing cyan invulnerability shield bubble
 * 4. Center Gunsight Reticle & Predictive Lead Indicator.
 * 5. 360° Tactical Radar Scope displaying all players in room with heading arrows.
 * 6. Wing Cannon Tracers, Impact Sparks, and Fiery Multi-particle Explosions.
 * 7. Altimeter tape, Airspeed tape, Heading compass, and Cockpit Frame.
 */

// Shared Dispersed Battlefield Mountain Terrain (14 Natural Peaks across all quadrants)
window.DOGFIGHT_MOUNTAINS = [
  // Sector 1: North & North-East
  { name: 'MT. TITAN (N)', x: 50, y: 880, r: 230, h: 120, col: '#334155', snow: true },
  { name: 'PINNACLE POINT (NE)', x: 640, y: 680, r: 200, h: 105, col: '#3b4252', snow: true },
  { name: "EAGLE'S ROOST", x: 340, y: 320, r: 160, h: 80, col: '#2e3440', snow: false },

  // Sector 2: East & South-East
  { name: 'TWIN PEAKS (E)', x: 900, y: -50, r: 220, h: 115, col: '#334155', snow: true },
  { name: 'IRON CRAG (SE)', x: 580, y: -380, r: 190, h: 95, col: '#3b4252', snow: false },
  { name: 'SOUTHERN SPUR (SE-Far)', x: 480, y: -820, r: 190, h: 100, col: '#2e3440', snow: false },

  // Sector 3: South & South-West
  { name: 'SOUTH CRAG (S)', x: -80, y: -880, r: 230, h: 120, col: '#334155', snow: false },
  { name: 'VIPER RIDGE', x: 80, y: -420, r: 150, h: 75, col: '#2e3440', snow: false },
  { name: "DEADMAN'S BLUFF (SW)", x: -560, y: -420, r: 190, h: 98, col: '#3b4252', snow: false },
  { name: 'OBSIDIAN MASSIF (SW-Far)', x: -620, y: -780, r: 210, h: 110, col: '#334155', snow: false },

  // Sector 4: West & North-West
  { name: 'IRON CLIFF (W)', x: -900, y: 40, r: 220, h: 115, col: '#2e3440', snow: false },
  { name: "DRAGON'S CREST (NW)", x: -540, y: 440, r: 190, h: 95, col: '#3b4252', snow: false },
  { name: 'THUNDER RIDGE', x: -320, y: 280, r: 150, h: 75, col: '#2e3440', snow: false },
  { name: 'FROST PEAK (NW-Far)', x: -420, y: 840, r: 200, h: 105, col: '#334155', snow: true },
].map((m) => ({ ...m, wx: m.x, wy: m.y }));

class DogfightRenderer {
  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.width = 960;
    this.height = 540;
    this.canvas.width = this.width;
    this.canvas.height = this.height;

    // Effects
    this.shakeDuration = 0;
    this.shakeIntensity = 0;
    this.flashDuration = 0;
    this.flashColor = 'rgba(239, 68, 68, 0.4)';
    this.hitMarkerTimer = 0; // Visual hit marker feedback

    // Pulse & Radar
    this.pulsePhase = 0;
    this.radarAngle = 0;

    // Particles
    this.speedParticles = [];
    this.initSpeedParticles(60);
    this.smokeParticles = [];
    this.explosions = [];
    this.tracers = [];
  }

  initSpeedParticles(count = 60) {
    this.speedParticles = [];
    for (let i = 0; i < count; i++) {
      this.speedParticles.push({
        x: (Math.random() - 0.5) * 1600,
        y: (Math.random() - 0.5) * 1000,
        z: 80 + Math.random() * 1200,
        len: 15 + Math.random() * 25
      });
    }
  }

  triggerShake(durationMs, intensity = 5) {
    this.shakeDuration = durationMs;
    this.shakeIntensity = intensity;
  }

  triggerFlash(durationMs, color = 'rgba(239, 68, 68, 0.45)') {
    this.flashDuration = durationMs;
    this.flashColor = color;
  }

  triggerHitMarker(durationMs = 160) {
    this.hitMarkerTimer = durationMs;
  }

  addTracer(targetX = 480, targetY = 270) {
    // Twin cannon tracers from wings
    this.tracers.push({
      startX: 260,
      startY: 535,
      targetX: targetX,
      targetY: targetY,
      progress: 0,
      speed: 8.5
    });
    this.tracers.push({
      startX: 700,
      startY: 535,
      targetX: targetX,
      targetY: targetY,
      progress: 0,
      speed: 8.5
    });
  }

  addExplosion(x, y, scale = 1.0) {
    const pCount = Math.round(28 * scale);
    for (let i = 0; i < pCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = (50 + Math.random() * 260) * scale;
      this.explosions.push({
        x: x,
        y: y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        life: 1.0,
        decay: 1.2 + Math.random() * 1.4,
        size: (3 + Math.random() * 7) * scale,
        color: Math.random() > 0.35 ? '#ffb02e' : (Math.random() > 0.5 ? '#ef4444' : '#ffffff')
      });
    }
  }

  addSmoke(x, y, color = '#64748b') {
    this.smokeParticles.push({
      x: x + (Math.random() - 0.5) * 8,
      y: y + (Math.random() - 0.5) * 8,
      vx: (Math.random() - 0.5) * 20,
      vy: 15 + Math.random() * 30,
      size: 4 + Math.random() * 5,
      maxSize: 18 + Math.random() * 12,
      life: 1.0,
      decay: 0.8 + Math.random() * 0.6,
      color: color
    });
  }

  render(state, dt) {
    const ctx = this.ctx;
    const now = performance.now();
    this.pulsePhase += dt * 4;

    ctx.save();

    // 0.5. Hit Marker Timer
    if (this.hitMarkerTimer > 0) {
      this.hitMarkerTimer -= dt * 1000;
    }

    // 1. Screen Shake
    if (this.shakeDuration > 0) {
      this.shakeDuration -= dt * 1000;
      const ox = (Math.random() - 0.5) * this.shakeIntensity * 2;
      const oy = (Math.random() - 0.5) * this.shakeIntensity * 2;
      ctx.translate(ox, oy);
    }

    // 2. Clear canvas
    ctx.fillStyle = '#061320';
    ctx.fillRect(0, 0, this.width, this.height);

    // 3. 3D Moving Continuous Horizon (Full 360° Loop)
    this.drawHorizon(ctx, state.pitch, state.roll);

    // 4. Fixed 3D World Terrain (Fixed World Ground Grid, Airbase Runway, 14 Mountains, Beacons)
    if (state.myPlane) {
      this.draw3DWorldTerrain(ctx, state.myPlane, state.pitch, state.roll, now);
    }

    // 6. Multi-Aircraft 3D Rendering (all other pilots in the room)
    if (state.otherPlayers && state.otherPlayers.length > 0) {
      this.drawOtherAircraft(ctx, state.otherPlayers, state.myPlane, state.pitch, state.roll, now);
    }

    // 6.2. Off-Screen Tactical Target Indicators (Guides pilot towards bogeys outside FOV)
    if (state.otherPlayers && state.otherPlayers.length > 0 && state.myPlane) {
      this.drawOffScreenTargetIndicators(ctx, state.otherPlayers, state.myPlane);
    }

    // 6.5. 3D Collectible Items in Airspace (Medkit, Damage Boost, Shield)
    if (state.items && state.items.length > 0) {
      this.draw3DItems(ctx, state.items, state.myPlane, state.pitch, state.roll, now);
    }

    // 7. Cannon Tracers & Smoke & Explosions
    this.drawTracers(ctx, dt);
    this.drawSmokeParticles(ctx, dt);
    this.drawExplosions(ctx, dt);

    // 8. Fixed Center Reticle & Lead Gunsight
    this.drawCockpitReticle(ctx, state.lockedTarget, state.leadPoint, now, state.pitch);

    // 9. Flight Instruments (Airspeed Tape, Altimeter Tape, Compass Ribbon)
    this.drawAirspeedTape(ctx, state.speed || 95, state.throttle || 1.0);
    this.drawAltimeterTape(ctx, state.altitude || 50, now);
    this.drawCompassRibbon(ctx, state.heading || 0);

    // 10. Tactical 360° Radar Scope (with Combat Boundary & Landmarks & Items)
    this.drawTacticalRadar(ctx, state.myPlane, state.otherPlayers, state.items, now);

    // 11. Cockpit Frame Bezel & 1st-Person Fighter Jet View
    this.drawCockpitFrame(ctx, state.myPlane, state.pitch, state.roll, now, state.isFiring);

    // 11.5. Combat Airspace Boundary Alert HUD
    if (state.boundaryState && state.boundaryState !== 'safe') {
      this.drawBoundaryAlertHUD(ctx, state.distFromCenter, state.boundaryState, state.boundaryTimeRem, now);
    }

    // 11.6. Terrain Proximity Warning System (GPWS)
    if (state.terrainWarning) {
      this.drawTerrainWarningHUD(ctx, state.terrainDist, now);
    }

    // 12. Screen Damage Flash
    if (this.flashDuration > 0) {
      this.flashDuration -= dt * 1000;
      ctx.fillStyle = this.flashColor;
      ctx.fillRect(0, 0, this.width, this.height);
    }

    // 13. Low HP Red Vignette Warning
    if (state.hp < 35 && !state.isDead) {
      const pulseAlpha = 0.25 + Math.sin(now * 0.008) * 0.18;
      const vigGrad = ctx.createRadialGradient(480, 270, 200, 480, 270, 520);
      vigGrad.addColorStop(0, 'rgba(239, 68, 68, 0)');
      vigGrad.addColorStop(1, `rgba(239, 68, 68, ${pulseAlpha})`);
      ctx.fillStyle = vigGrad;
      ctx.fillRect(0, 0, this.width, this.height);
    }

    ctx.restore();
  }

  project3D(wx, wy, wz, myPlane, pitch, roll) {
    if (!myPlane) return null;
    const hRad = (myPlane.heading * Math.PI) / 180;
    const pRad = (((pitch || 0) % 360) * Math.PI) / 180;
    const rRad = ((roll || 0) * Math.PI) / 180;

    const sinH = Math.sin(hRad), cosH = Math.cos(hRad);
    const sinP = Math.sin(pRad), cosP = Math.cos(pRad);
    const sinR = Math.sin(rRad), cosR = Math.cos(rRad);

    const Fx = sinH * cosP, Fy = cosH * cosP, Fz = sinP;
    const Rx = cosH * cosR + sinH * sinP * sinR;
    const Ry = -sinH * cosR + cosH * sinP * sinR;
    const Rz = -cosP * sinR;
    const Ux = -cosH * sinR + sinH * sinP * cosR;
    const Uy = sinH * sinR + cosH * sinP * cosR;
    const Uz = cosP * cosR;

    const dx = wx - myPlane.x;
    const dy = wy - myPlane.y;
    const dz = (wz - myPlane.alt) * 8.0;

    const relZ = dx * Fx + dy * Fy + dz * Fz;
    if (relZ <= 8) return null; // Behind camera

    const relX = dx * Rx + dy * Ry + dz * Rz;
    const relY = dx * Ux + dy * Uy + dz * Uz;

    const k = 620 / Math.max(16, relZ);
    return {
      x: 480 + relX * k,
      y: 270 - relY * k,
      z: relZ,
      dist: Math.hypot(dx, dy)
    };
  }

  drawHorizon(ctx, pitch, roll) {
    ctx.save();
    const cx = this.width / 2;
    const cy = this.height / 2;

    const normPitch = (((pitch || 0) % 360) + 360) % 360;
    const rollRad = ((roll || 0) * Math.PI) / 180;

    const isInverted = normPitch > 90 && normPitch < 270;
    let pitchOffset;
    if (normPitch <= 90) {
      pitchOffset = normPitch * 5.0;
    } else if (normPitch <= 270) {
      pitchOffset = (180 - normPitch) * 5.0;
    } else {
      pitchOffset = (normPitch - 360) * 5.0;
    }

    ctx.translate(cx, cy + pitchOffset);
    if (isInverted) {
      ctx.rotate(Math.PI - rollRad);
    } else {
      ctx.rotate(-rollRad);
    }

    const extent = 2000;

    // Sky dome
    const skyGrad = ctx.createLinearGradient(0, -extent, 0, 0);
    skyGrad.addColorStop(0, '#071829');
    skyGrad.addColorStop(0.85, '#1e3a5f');
    skyGrad.addColorStop(1, '#3b6f9e');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(-extent, -extent, extent * 2, extent);

    // Ground terrain dome
    const groundGrad = ctx.createLinearGradient(0, 0, 0, extent);
    groundGrad.addColorStop(0, '#102a1e');
    groundGrad.addColorStop(0.25, '#0c2016');
    groundGrad.addColorStop(1, '#050f0a');
    ctx.fillStyle = groundGrad;
    ctx.fillRect(-extent, 0, extent * 2, extent);

    // Horizon line
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2.0;
    ctx.shadowColor = 'rgba(56, 189, 248, 0.8)';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(-extent, 0);
    ctx.lineTo(extent, 0);
    ctx.stroke();

    ctx.restore();
  }

  draw3DWorldTerrain(ctx, myPlane, pitch, roll, now) {
    if (!myPlane) return;

    // 1. Fixed 3D Ground Grid (Positioned at exact world coordinates)
    ctx.save();
    ctx.strokeStyle = 'rgba(52, 211, 153, 0.22)';
    ctx.lineWidth = 1.2;

    const step = 150;
    const span = 900;
    const startX = Math.floor((myPlane.x - span) / step) * step;
    const endX = Math.ceil((myPlane.x + span) / step) * step;
    const startY = Math.floor((myPlane.y - span) / step) * step;
    const endY = Math.ceil((myPlane.y + span) / step) * step;

    // Draw longitudinal grid lines (segmented for proper front clipping)
    for (let gx = startX; gx <= endX; gx += step) {
      for (let gy = startY; gy < endY; gy += 300) {
        const p1 = this.project3D(gx, gy, 0, myPlane, pitch, roll);
        const p2 = this.project3D(gx, gy + 300, 0, myPlane, pitch, roll);
        if (p1 && p2 && p1.z < 1200 && p2.z < 1200) {
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
        }
      }
    }

    // Draw lateral grid lines (segmented for proper front clipping)
    for (let gy = startY; gy <= endY; gy += step) {
      for (let gx = startX; gx < endX; gx += 300) {
        const p1 = this.project3D(gx, gy, 0, myPlane, pitch, roll);
        const p2 = this.project3D(gx + 300, gy, 0, myPlane, pitch, roll);
        if (p1 && p2 && p1.z < 1200 && p2.z < 1200) {
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
        }
      }
    }
    ctx.restore();

    // 2. Central Airbase Runway (wx: 0, wy: 0, length: 520, width: 64)
    const rwL = 260;
    const rwW = 32;
    const pNW = this.project3D(-rwW, rwL, 0, myPlane, pitch, roll);
    const pNE = this.project3D(rwW, rwL, 0, myPlane, pitch, roll);
    const pSE = this.project3D(rwW, -rwL, 0, myPlane, pitch, roll);
    const pSW = this.project3D(-rwW, -rwL, 0, myPlane, pitch, roll);

    if (pNW && pNE && pSE && pSW) {
      ctx.fillStyle = '#1e293b';
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(pNW.x, pNW.y);
      ctx.lineTo(pNE.x, pNE.y);
      ctx.lineTo(pSE.x, pSE.y);
      ctx.lineTo(pSW.x, pSW.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Centerline dashed stripes
      ctx.strokeStyle = '#f8fafc';
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      for (let yOff = -220; yOff <= 220; yOff += 55) {
        const p1 = this.project3D(0, yOff - 16, 0, myPlane, pitch, roll);
        const p2 = this.project3D(0, yOff + 16, 0, myPlane, pitch, roll);
        if (p1 && p2) {
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
        }
      }
      ctx.stroke();

      // Runway threshold lights
      const lights = [
        { wx: -rwW, wy: rwL, col: '#10b981' },
        { wx: rwW, wy: rwL, col: '#10b981' },
        { wx: -rwW, wy: -rwL, col: '#ef4444' },
        { wx: rwW, wy: -rwL, col: '#ef4444' },
        { wx: -rwW, wy: 0, col: '#f59e0b' },
        { wx: rwW, wy: 0, col: '#f59e0b' },
      ];
      for (let l of lights) {
        const pl = this.project3D(l.wx, l.wy, 0, myPlane, pitch, roll);
        if (pl) {
          ctx.fillStyle = l.col;
          ctx.beginPath();
          ctx.arc(pl.x, pl.y, Math.max(2, 60 / (pl.z * 0.1)), 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Airbase label
      const pCenter = this.project3D(0, 0, 0, myPlane, pitch, roll);
      if (pCenter && pCenter.z < 850) {
        ctx.fillStyle = '#38bdf8';
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('AIRBASE [0,0]', pCenter.x, pCenter.y - 12);
      }
    }

    // 3. 14 3D Dispersed Mountain Peaks (Sorted back-to-front)
    const mountains = [...window.DOGFIGHT_MOUNTAINS];
    mountains.sort((a, b) => {
      const da = Math.hypot(a.wx - myPlane.x, a.wy - myPlane.y);
      const db = Math.hypot(b.wx - myPlane.x, b.wy - myPlane.y);
      return db - da;
    });

    for (let m of mountains) {
      const pPeak = this.project3D(m.wx, m.wy, m.h, myPlane, pitch, roll);
      const pL = this.project3D(m.wx - m.r * 0.9, m.wy, 0, myPlane, pitch, roll);
      const pR = this.project3D(m.wx + m.r * 0.9, m.wy, 0, myPlane, pitch, roll);
      const pB = this.project3D(m.wx, m.wy - m.r * 0.5, 0, myPlane, pitch, roll);

      if (pPeak && pL && pR && pB) {
        // Shaded left slope
        ctx.fillStyle = m.col;
        ctx.beginPath();
        ctx.moveTo(pPeak.x, pPeak.y);
        ctx.lineTo(pL.x, pL.y);
        ctx.lineTo(pB.x, pB.y);
        ctx.closePath();
        ctx.fill();

        // Illuminated right slope
        ctx.fillStyle = '#475569';
        ctx.beginPath();
        ctx.moveTo(pPeak.x, pPeak.y);
        ctx.lineTo(pB.x, pB.y);
        ctx.lineTo(pR.x, pR.y);
        ctx.closePath();
        ctx.fill();

        // Ridge lines
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(pPeak.x, pPeak.y);
        ctx.lineTo(pB.x, pB.y);
        ctx.stroke();

        // Snow Cap
        if (m.snow) {
          const pSnow = this.project3D(m.wx, m.wy, m.h * 0.72, myPlane, pitch, roll);
          const pSnowL = this.project3D(m.wx - m.r * 0.28, m.wy, m.h * 0.65, myPlane, pitch, roll);
          const pSnowR = this.project3D(m.wx + m.r * 0.28, m.wy, m.h * 0.65, myPlane, pitch, roll);
          if (pSnow && pSnowL && pSnowR) {
            ctx.fillStyle = '#f8fafc';
            ctx.beginPath();
            ctx.moveTo(pPeak.x, pPeak.y);
            ctx.lineTo(pSnowL.x, pSnowL.y);
            ctx.lineTo(pSnow.x, pSnow.y + 4);
            ctx.lineTo(pSnowR.x, pSnowR.y);
            ctx.closePath();
            ctx.fill();
          }
        }

        // Peak name & elevation tag
        if (pPeak.z < 1200) {
          ctx.fillStyle = '#cbd5e1';
          ctx.font = 'bold 10px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(`▲ ${m.name} [${m.h}m]`, pPeak.x, pPeak.y - 8);
        }
      }
    }

    // 4. 4 Sector Waypoint Beacons (Holographic Laser Beams)
    const beacons = [
      { name: 'WP-ALPHA', wx: 620, wy: 620, col: '#38bdf8' },
      { name: 'WP-BRAVO', wx: 620, wy: -620, col: '#10b981' },
      { name: 'WP-CHARLIE', wx: -620, wy: -620, col: '#f59e0b' },
      { name: 'WP-DELTA', wx: -620, wy: 620, col: '#a855f7' },
    ];

    for (let b of beacons) {
      const pBase = this.project3D(b.wx, b.wy, 0, myPlane, pitch, roll);
      const pTop = this.project3D(b.wx, b.wy, 320, myPlane, pitch, roll);
      if (pBase && pTop) {
        ctx.strokeStyle = b.col;
        ctx.lineWidth = 2.5;
        ctx.shadowColor = b.col;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.moveTo(pBase.x, pBase.y);
        ctx.lineTo(pTop.x, pTop.y);
        ctx.stroke();
        ctx.shadowBlur = 0;

        ctx.strokeStyle = b.col;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(pBase.x, pBase.y, Math.max(3, 420 / pBase.z), 0, Math.PI * 2);
        ctx.stroke();

        const dist = Math.hypot(b.wx - myPlane.x, b.wy - myPlane.y);
        ctx.fillStyle = b.col;
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`◇ ${b.name} (${Math.round(dist)}m)`, pBase.x, pBase.y - 14);
      }
    }

    // 5. Combat Airspace Boundary Pylons (Ring at R = 1200m)
    const curDist = Math.hypot(myPlane.x, myPlane.y);
    const nearBoundary = curDist > 850;

    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const px = Math.cos(a) * 1200;
      const py = Math.sin(a) * 1200;
      const pBase = this.project3D(px, py, 0, myPlane, pitch, roll);
      const pTop = this.project3D(px, py, 260, myPlane, pitch, roll);

      if (pBase && pTop) {
        ctx.strokeStyle = nearBoundary ? '#ef4444' : 'rgba(239, 68, 68, 0.4)';
        ctx.lineWidth = 2.0;
        ctx.shadowColor = '#ef4444';
        ctx.shadowBlur = nearBoundary ? 8 : 0;
        ctx.beginPath();
        ctx.moveTo(pBase.x, pBase.y);
        ctx.lineTo(pTop.x, pTop.y);
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
    }

    // Holographic laser perimeter fence when approaching boundary
    if (nearBoundary) {
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.45)';
      ctx.lineWidth = 1.8;
      for (let i = 0; i < 16; i++) {
        const a1 = (i / 16) * Math.PI * 2;
        const a2 = ((i + 1) / 16) * Math.PI * 2;
        const p1 = this.project3D(Math.cos(a1) * 1200, Math.sin(a1) * 1200, 0, myPlane, pitch, roll);
        const p2 = this.project3D(Math.cos(a2) * 1200, Math.sin(a2) * 1200, 0, myPlane, pitch, roll);
        if (p1 && p2) {
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
        }
      }
    }
  }

  drawOffScreenTargetIndicators(ctx, otherPlayers, myPlane) {
    if (!otherPlayers || !otherPlayers.length || !myPlane) return;

    for (let p of otherPlayers) {
      if (p.isDead) continue;

      // Check if target is off-screen or behind camera
      const isOffScreen = !p.inFront || (p.screenX < 35 || p.screenX > this.width - 35 || p.screenY < 35 || p.screenY > this.height - 35);
      if (!isOffScreen) continue;

      const dx = p.x - myPlane.x;
      const dy = p.y - myPlane.y;
      const dist = Math.round(p.dist || Math.hypot(dx, dy));

      // Relative horizontal bearing
      const myHRad = (myPlane.heading * Math.PI) / 180;
      const targetBearing = Math.atan2(dx, dy);
      let relH = targetBearing - myHRad;
      while (relH > Math.PI) relH -= Math.PI * 2;
      while (relH < -Math.PI) relH -= Math.PI * 2;

      // Relative elevation
      const dAlt = (p.alt || 50) - (myPlane.alt || 50);
      const pitchRad = ((myPlane.pitch || 0) * Math.PI) / 180;

      // Screen angle: 0 = right, PI/2 = down, PI = left, -PI/2 = up
      const screenAngle = Math.atan2(
        -(dAlt * 6.0 - Math.sin(pitchRad) * dist * 3.5),
        Math.sin(relH) * 500
      );

      const cx = 480;
      const cy = 270;
      const marginX = 45;
      const marginY = 45;
      const maxW = (this.width / 2) - marginX;
      const maxH = (this.height / 2) - marginY;

      const cosA = Math.cos(screenAngle);
      const sinA = Math.sin(screenAngle);
      const scaleX = Math.abs(cosA) > 0.001 ? maxW / Math.abs(cosA) : 9999;
      const scaleY = Math.abs(sinA) > 0.001 ? maxH / Math.abs(sinA) : 9999;
      const scale = Math.min(scaleX, scaleY);

      const edgeX = cx + cosA * scale;
      const edgeY = cy + sinA * scale;

      ctx.save();
      ctx.translate(edgeX, edgeY);

      const isLocked = p.isLocked;
      const col = isLocked ? '#ef4444' : (p.color || '#38bdf8');

      // Tactical glowing chevron pointer
      ctx.rotate(screenAngle);
      ctx.fillStyle = col;
      ctx.shadowColor = col;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(12, 0);
      ctx.lineTo(-7, -9);
      ctx.lineTo(-2, 0);
      ctx.lineTo(-7, 9);
      ctx.closePath();
      ctx.fill();

      // Nametag & Distance label
      ctx.rotate(-screenAngle);
      ctx.fillStyle = col;
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      const labelY = (screenAngle > -Math.PI / 2 && screenAngle < Math.PI / 2) ? 18 : -14;
      ctx.fillText(`${p.callsign} [${dist}m]`, 0, labelY);

      ctx.restore();
    }
  }

  drawSpeedStreamers(ctx, pitch, roll, speed, dt) {
    ctx.save();
    const cx = this.width / 2;
    const cy = this.height / 2;
    const pitchOffset = pitch * 4.5;
    const rollRad = (roll * Math.PI) / 180;
    const speedScale = (speed / 95) * 650;

    ctx.translate(cx, cy + pitchOffset);
    ctx.rotate(-rollRad);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1.5;

    for (let p of this.speedParticles) {
      p.z -= speedScale * dt;
      if (p.z <= 25) {
        p.z = 1100 + Math.random() * 200;
        p.x = (Math.random() - 0.5) * 1600;
        p.y = (Math.random() - 0.5) * 1000;
      }

      const k = 420 / p.z;
      const sx = p.x * k;
      const sy = p.y * k;
      const len = p.len * k * 2.5;

      const alpha = Math.min(0.65, (1200 - p.z) / 900);
      ctx.strokeStyle = `rgba(224, 242, 254, ${alpha})`;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx * 1.08, sy * 1.08);
      ctx.stroke();
    }

    ctx.restore();
  }

  drawOtherAircraft(ctx, otherPlayers, myPlane, pitch, roll, now) {
    if (!myPlane) return;
    const hRad = (myPlane.heading * Math.PI) / 180;
    const pRad = ((pitch || 0) * Math.PI) / 180;
    const rRad = ((roll || 0) * Math.PI) / 180;

    const sinH = Math.sin(hRad), cosH = Math.cos(hRad);
    const sinP = Math.sin(pRad), cosP = Math.cos(pRad);
    const sinR = Math.sin(rRad), cosR = Math.cos(rRad);

    const Fx = sinH * cosP, Fy = cosH * cosP, Fz = sinP;
    const Rx = cosH * cosR + sinH * sinP * sinR;
    const Ry = -sinH * cosR + cosH * sinP * sinR;
    const Rz = -cosP * sinR;
    const Ux = -cosH * sinR + sinH * sinP * cosR;
    const Uy = sinH * sinR + cosH * sinP * cosR;
    const Uz = cosP * cosR;

    for (let p of otherPlayers) {
      if (p.isDead) {
        p.inFront = false;
        continue;
      }

      // Delta vector in world coords
      const dx = p.x - myPlane.x;
      const dy = p.y - myPlane.y;
      const dz = (p.alt - myPlane.alt) * 8.0;

      // 3D body reference frame
      const relZ = dx * Fx + dy * Fy + dz * Fz; // Forward (+ = ahead)
      const relX = dx * Rx + dy * Ry + dz * Rz; // Lateral (+ = right)
      const relY = dx * Ux + dy * Uy + dz * Uz; // Vertical (+ = up)

      const dist = Math.hypot(dx, dy);
      p.dist = dist;

      // Only draw if in front of player (relZ > 10)
      if (relZ <= 10) {
        p.inFront = false;
        continue;
      }

      // Perspective projection
      const k = 620 / Math.max(20, relZ);
      const sx = 480 + relX * k;
      const sy = 270 - relY * k;

      // Save screen coords on player object for hit testing & HUD
      p.screenX = sx;
      p.screenY = sy;
      p.dist = dist;
      p.inFront = true;

      // Off-screen clamp check
      if (sx < -80 || sx > this.width + 80 || sy < -80 || sy > this.height + 80) {
        continue;
      }

      ctx.save();

      // Case A: Distant target (dist > 450m) -> Tactical Diamond Bracket
      if (dist > 450) {
        const inGunRange = dist < 500;
        ctx.strokeStyle = inGunRange ? '#10b981' : (p.color || '#38bdf8');
        ctx.lineWidth = 1.8;
        ctx.shadowColor = ctx.strokeStyle;
        ctx.shadowBlur = 6;

        // Diamond box
        const dSize = 13;
        ctx.beginPath();
        ctx.moveTo(sx, sy - dSize);
        ctx.lineTo(sx + dSize, sy);
        ctx.lineTo(sx, sy + dSize);
        ctx.lineTo(sx - dSize, sy);
        ctx.closePath();
        ctx.stroke();

        // Callsign & Range tag
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`[LV.${p.level || 1}] ${p.callsign}`, sx, sy - 18);

        ctx.fillStyle = inGunRange ? '#10b981' : '#64748b';
        ctx.font = '10px monospace';
        ctx.fillText(inGunRange ? `${Math.round(dist)}m [IN RANGE]` : `${Math.round(dist)}m`, sx, sy + 25);

        ctx.restore();
        continue;
      }

      // Case B: Close Range Fighter Jet (dist <= 450m) -> 3D Jet Silhouette
      const scaleFactor = Math.min(2.0, Math.max(0.65, 420 / Math.max(45, dist)));
      ctx.translate(sx, sy);
      ctx.scale(scaleFactor, scaleFactor);

      // Tilt according to remote plane's roll & pitch
      const remoteRollRad = ((p.roll || 0) * Math.PI) / 180;
      ctx.rotate(remoteRollRad * 0.7);
      if (p.pitch !== undefined) {
        const pCos = Math.cos(((p.pitch || 0) * Math.PI) / 180);
        ctx.scale(1.0, pCos < -0.1 ? -1.0 : 1.0);
      }

      // 1. Invulnerability / Armor Shield Bubble
      const hasAnyShield = p.hasSpawnProtection || (p.shieldHp && p.shieldHp > 0) || p.hasShield;
      if (hasAnyShield) {
        const shieldPulse = 1.0 + Math.sin(now * 0.015) * 0.12;
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2.5;
        ctx.shadowColor = '#38bdf8';
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(0, 0, 42 * shieldPulse, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = 'rgba(56, 189, 248, 0.15)';
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // 2. Afterburner Thruster Flame
      const flameLen = 14 + Math.sin(now * 0.06) * 6;
      ctx.fillStyle = '#f97316';
      ctx.beginPath();
      ctx.moveTo(-6, 20);
      ctx.lineTo(0, 20 + flameLen);
      ctx.lineTo(6, 20);
      ctx.closePath();
      ctx.fill();

      // Twin burner cores
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(-4, 20, 2.5, 0, Math.PI * 2);
      ctx.arc(4, 20, 2.5, 0, Math.PI * 2);
      ctx.fill();

      // 3. 3D Fighter Jet Silhouette
      const jetColor = p.color || '#38bdf8';
      ctx.fillStyle = '#0f172a';
      ctx.strokeStyle = p.isLocked ? '#ef4444' : jetColor;
      ctx.lineWidth = 2.2;
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = 8;

      ctx.beginPath();
      ctx.moveTo(0, -28);       // Nose
      ctx.lineTo(10, -6);       // Fuselage right
      ctx.lineTo(36, 10);       // Right wing tip
      ctx.lineTo(32, 16);       // Wing trailing edge
      ctx.lineTo(12, 12);       // Inboard wing
      ctx.lineTo(14, 22);       // Right tail fin
      ctx.lineTo(4, 20);        // Right engine nozzle
      ctx.lineTo(0, 22);        // Center fuselage
      ctx.lineTo(-4, 20);       // Left engine nozzle
      ctx.lineTo(-14, 22);      // Left tail fin
      ctx.lineTo(-12, 12);      // Inboard wing
      ctx.lineTo(-32, 16);      // Wing trailing edge
      ctx.lineTo(-36, 10);      // Left wing tip
      ctx.lineTo(-10, -6);      // Fuselage left
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Cockpit canopy glass
      ctx.fillStyle = 'rgba(56, 189, 248, 0.65)';
      ctx.beginPath();
      ctx.ellipse(0, -10, 4.5, 10, 0, 0, Math.PI * 2);
      ctx.fill();

      // Emit smoke trail if damaged (HP < 50)
      if (p.hp < 50 && Math.random() > 0.4) {
        this.addSmoke(sx, sy + 18, p.hp < 25 ? '#1e293b' : '#64748b');
      }

      // Overhead Callsign & HP Bar (counter-rotate so text remains level)
      ctx.rotate(-remoteRollRad * 0.7);

      // Callsign with Level and Armor
      const armorBadge = (p.shieldHp && p.shieldHp > 0) ? ` 🛡️+${p.shieldHp}` : '';
      ctx.fillStyle = (p.level >= 4) ? '#f59e0b' : '#ffffff';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`[LV.${p.level || 1}] ${p.callsign}${armorBadge}`, 0, -38);

      // Mini HP Bar
      const barW = 44;
      const barH = 5;
      const hpPct = Math.max(0, p.hp / (p.maxHp || 100));
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.fillRect(-barW / 2, -34, barW, barH);
      ctx.fillStyle = hpPct > 0.5 ? '#10b981' : (hpPct > 0.25 ? '#f59e0b' : '#ef4444');
      ctx.fillRect(-barW / 2, -34, barW * hpPct, barH);
      // Temporary Armor Overlay Bar (+20 HP)
      if (p.shieldHp && p.shieldHp > 0) {
        const armorPct = Math.min(1.0, p.shieldHp / 20);
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(-barW / 2, -37, barW * armorPct, 2.5);
      }
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1;
      ctx.strokeRect(-barW / 2, -34, barW, barH);

      // Energy Shield Bubble (Spawn protection or active armor)
      if (hasAnyShield) {
        ctx.strokeStyle = '#38bdf8';
        ctx.fillStyle = 'rgba(56, 189, 248, 0.18)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, 36, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      // Damage Boost Energy Sparks
      if (p.hasDamageBoost) {
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, 26 + Math.sin(now * 0.015) * 3, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Distance tag
      ctx.fillStyle = '#38bdf8';
      ctx.font = '10px monospace';
      ctx.fillText(`${Math.round(dist)}m`, 0, 38);

      ctx.restore();
    }
  }

  drawCockpitReticle(ctx, lockedTarget, leadPoint, now, pitch) {
    const cx = 480;
    const cy = 270;
    ctx.save();

    // 0. Radar Acquisition Zone Ring (180px zone)
    ctx.strokeStyle = isLocked ? 'rgba(239, 68, 68, 0.45)' : 'rgba(56, 189, 248, 0.25)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.arc(cx, cy, 180, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // 1. Center Boresight Crosshair (Dogfight Gunsight)
    const isLocked = !!lockedTarget;
    ctx.strokeStyle = isLocked ? '#ef4444' : '#38bdf8';
    ctx.lineWidth = 1.8;
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = 6;

    // Center dot
    ctx.fillStyle = isLocked ? '#ef4444' : '#ffffff';
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fill();

    // Inner reticle circle
    ctx.beginPath();
    ctx.arc(cx, cy, 26, 0, Math.PI * 2);
    ctx.stroke();

    // Four tick marks
    ctx.beginPath();
    ctx.moveTo(cx - 36, cy); ctx.lineTo(cx - 28, cy);
    ctx.moveTo(cx + 28, cy); ctx.lineTo(cx + 36, cy);
    ctx.moveTo(cx, cy - 36); ctx.lineTo(cx, cy - 28);
    ctx.moveTo(cx, cy + 28); ctx.lineTo(cx, cy + 36);
    ctx.stroke();

    // 1.5. Dynamic Hit Marker (Red 'X' ticks when shot lands on enemy)
    if (this.hitMarkerTimer > 0) {
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2.6;
      ctx.shadowColor = '#ef4444';
      ctx.shadowBlur = 10;
      const sz = 13;
      ctx.beginPath();
      ctx.moveTo(cx - sz, cy - sz); ctx.lineTo(cx - 5, cy - 5);
      ctx.moveTo(cx + sz, cy - sz); ctx.lineTo(cx + 5, cy - 5);
      ctx.moveTo(cx - sz, cy + sz); ctx.lineTo(cx - 5, cy + 5);
      ctx.moveTo(cx + sz, cy + sz); ctx.lineTo(cx + 5, cy + 5);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // 2. Lock-on Box & Indicator (Active when enemy is within <= 450m)
    if (lockedTarget && lockedTarget.screenX !== undefined) {
      const tx = lockedTarget.screenX;
      const ty = lockedTarget.screenY;
      const pulseSize = 36 + Math.sin(now * 0.02) * 4;

      // Connecting lead vector line from boresight to target
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(tx, ty);
      ctx.stroke();

      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2.2;
      ctx.shadowColor = '#ef4444';
      ctx.shadowBlur = 10;

      // Lock corners [ ]
      const cLen = 10;
      ctx.beginPath();
      // Top-Left
      ctx.moveTo(tx - pulseSize, ty - pulseSize + cLen);
      ctx.lineTo(tx - pulseSize, ty - pulseSize);
      ctx.lineTo(tx - pulseSize + cLen, ty - pulseSize);
      // Top-Right
      ctx.moveTo(tx + pulseSize - cLen, ty - pulseSize);
      ctx.lineTo(tx + pulseSize, ty - pulseSize);
      ctx.lineTo(tx + pulseSize, ty - pulseSize + cLen);
      // Bottom-Right
      ctx.moveTo(tx + pulseSize, ty + pulseSize - cLen);
      ctx.lineTo(tx + pulseSize, ty + pulseSize);
      ctx.lineTo(tx + pulseSize - cLen, ty + pulseSize);
      // Bottom-Left
      ctx.moveTo(tx - pulseSize + cLen, ty + pulseSize);
      ctx.lineTo(tx - pulseSize, ty + pulseSize);
      ctx.lineTo(tx - pulseSize, ty + pulseSize - cLen);
      ctx.stroke();

      // LOCK Text with Target Distance and Auto-Aim Badge
      ctx.fillStyle = '#ef4444';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      const targetDistStr = lockedTarget.dist ? `${Math.round(lockedTarget.dist)}m` : 'LOCK';
      ctx.fillText(`LOCKED • ${lockedTarget.callsign} [${targetDistStr}]`, tx, ty - pulseSize - 8);
      ctx.font = 'bold 9px monospace';
      ctx.fillText(`AUTO-AIM ENGAGED (100% HIT)`, tx, ty + pulseSize + 16);
    }

    // 3. Lead Reticle (predictive aim assist)
    if (leadPoint) {
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(leadPoint.x, leadPoint.y, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#10b981';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('LEAD', leadPoint.x, leadPoint.y + 18);
    }

    // Range Label: Lock at <= 450m, Guns hit < 500m
    ctx.fillStyle = isLocked ? '#ef4444' : 'rgba(56, 189, 248, 0.75)';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(isLocked ? 'TARGET ACQUIRED • AUTO-AIM ACTIVE (LOCK ≤450M)' : 'RADAR LOCK ≤450M • AUTO-LEAD READY', cx, cy + 42);

    // Pitch Attitude Readout (displays loop angle / inverted status)
    const normPitch = (((pitch || 0) % 360) + 360) % 360;
    let pitchText = `${Math.round(normPitch)}°`;
    if (normPitch > 75 && normPitch < 105) {
      pitchText = '90° ⬆ ZENITH';
      ctx.fillStyle = '#f59e0b';
    } else if (normPitch >= 165 && normPitch <= 195) {
      pitchText = '180° 🔄 INVERTED (ตีลังกา)';
      ctx.fillStyle = '#38bdf8';
    } else if (normPitch > 255 && normPitch < 285) {
      pitchText = '270° ⬇ NADIR (DIVE)';
      ctx.fillStyle = '#ef4444';
    } else {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
    }
    ctx.font = 'bold 10px monospace';
    ctx.fillText(pitchText, cx, cy - 34);

    ctx.restore();
  }

  drawTracers(ctx, dt) {
    ctx.save();
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.progress += t.speed * dt;

      if (t.progress >= 1.0) {
        this.tracers.splice(i, 1);
        continue;
      }

      const curX = t.startX + (t.targetX - t.startX) * t.progress;
      const curY = t.startY + (t.targetY - t.startY) * t.progress;
      const tailX = t.startX + (t.targetX - t.startX) * Math.max(0, t.progress - 0.15);
      const tailY = t.startY + (t.targetY - t.startY) * Math.max(0, t.progress - 0.15);

      ctx.strokeStyle = '#fef08a';
      ctx.lineWidth = 3.5;
      ctx.shadowColor = '#f59e0b';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(curX, curY);
      ctx.stroke();

      // Bright bullet head
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(curX, curY, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawSmokeParticles(ctx, dt) {
    ctx.save();
    for (let i = this.smokeParticles.length - 1; i >= 0; i--) {
      const s = this.smokeParticles[i];
      s.life -= s.decay * dt;
      if (s.life <= 0) {
        this.smokeParticles.splice(i, 1);
        continue;
      }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.size += (s.maxSize - s.size) * 3 * dt;

      ctx.fillStyle = s.color;
      ctx.globalAlpha = s.life * 0.6;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawExplosions(ctx, dt) {
    ctx.save();
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const p = this.explosions[i];
      p.life -= p.decay * dt;
      if (p.life <= 0) {
        this.explosions.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      ctx.fillStyle = p.color;
      ctx.globalAlpha = p.life;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawTacticalRadar(ctx, myPlane, otherPlayers, items, now) {
    if (!myPlane) return;
    ctx.save();

    const rx = 855;
    const ry = 435;
    const radius = 75;
    const maxRadarRange = 1200; // meters (Matches Combat Arena Radius!)
    const myHRad = (myPlane.heading * Math.PI) / 180;
    const curDist = Math.hypot(myPlane.x, myPlane.y);
    const nearEdge = curDist > 950;

    // Scope background
    ctx.fillStyle = 'rgba(7, 24, 38, 0.9)';
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(rx, ry, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 1. Combat Airspace Boundary Ring (Dashed Red at R = 1200m)
    ctx.strokeStyle = nearEdge ? (Math.sin(now * 0.01) > 0 ? '#ef4444' : '#f59e0b') : 'rgba(239, 68, 68, 0.7)';
    ctx.lineWidth = nearEdge ? 2.2 : 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.arc(rx, ry, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // 2. Range 600m inner ring
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(rx, ry, radius * 0.5, 0, Math.PI * 2);
    ctx.stroke();

    // Crosshairs
    ctx.beginPath();
    ctx.moveTo(rx - radius, ry); ctx.lineTo(rx + radius, ry);
    ctx.moveTo(rx, ry - radius); ctx.lineTo(rx, ry + radius);
    ctx.stroke();

    // Sweeping beam
    this.radarAngle = (this.radarAngle + 0.04) % (Math.PI * 2);
    const sweepGrad = ctx.createRadialGradient(rx, ry, 0, rx, ry, radius);
    sweepGrad.addColorStop(0, 'rgba(56, 189, 248, 0.35)');
    sweepGrad.addColorStop(1, 'rgba(56, 189, 248, 0)');
    ctx.fillStyle = sweepGrad;
    ctx.beginPath();
    ctx.moveTo(rx, ry);
    ctx.arc(rx, ry, radius, this.radarAngle - 0.45, this.radarAngle);
    ctx.closePath();
    ctx.fill();

    // Helper: Map world point to radar coordinates
    const toRadar = (wx, wy) => {
      const dx = wx - myPlane.x;
      const dy = wy - myPlane.y;
      const dist = Math.hypot(dx, dy);
      const relAng = Math.atan2(dx, dy) - myHRad;
      const rDist = Math.min(radius - 4, (dist / maxRadarRange) * radius);
      return { x: rx + Math.sin(relAng) * rDist, y: ry - Math.cos(relAng) * rDist, inRange: dist <= maxRadarRange };
    };

    // 3. Central Airbase Runway Icon at (0, 0)
    const pAir = toRadar(0, 0);
    if (pAir.inRange) {
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(pAir.x - 1.5, pAir.y - 7, 3, 14); // Runway stripe
      ctx.fillStyle = '#10b981';
      ctx.fillRect(pAir.x - 4, pAir.y - 1, 8, 2);
    }

    // 4. Mountains on Radar (▲)
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 8px monospace';
    ctx.textAlign = 'center';
    for (let m of window.DOGFIGHT_MOUNTAINS) {
      const pm = toRadar(m.x, m.y);
      if (pm.inRange) {
        ctx.fillText('▲', pm.x, pm.y + 3);
      }
    }

    // 5. Waypoints on Radar (A, B, C, D)
    const radarWp = [
      { x: 620, y: 620, label: 'A', col: '#38bdf8' },
      { x: 620, y: -620, label: 'B', col: '#10b981' },
      { x: -620, y: -620, label: 'C', col: '#f59e0b' },
      { x: -620, y: 620, label: 'D', col: '#a855f7' }
    ];
    for (let wp of radarWp) {
      const pw = toRadar(wp.x, wp.y);
      if (pw.inRange) {
        ctx.fillStyle = wp.col;
        ctx.fillText(wp.label, pw.x, pw.y + 3);
      }
    }

    // 5.5. Tactical Collectible Items on Radar (✚ Medkit, ⚡ Damage Boost, 🛡 Shield)
    if (items && Array.isArray(items)) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let it of items) {
        const pit = toRadar(it.x, it.y);
        if (pit.inRange) {
          if (it.type === 'medkit') {
            ctx.fillStyle = '#10b981';
            ctx.font = 'bold 11px monospace';
            ctx.fillText('✚', pit.x, pit.y);
          } else if (it.type === 'damage_boost') {
            ctx.fillStyle = '#f59e0b';
            ctx.font = 'bold 12px monospace';
            ctx.fillText('⚡', pit.x, pit.y);
          } else if (it.type === 'shield') {
            ctx.fillStyle = '#38bdf8';
            ctx.font = 'bold 11px monospace';
            ctx.fillText('🛡', pit.x, pit.y);
          }
        }
      }
      ctx.textBaseline = 'alphabetic';
    }

    // 6. Center dot: Own Aircraft (White arrowhead)
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(rx, ry - 6);
    ctx.lineTo(rx + 4, ry + 4);
    ctx.lineTo(rx - 4, ry + 4);
    ctx.closePath();
    ctx.fill();

    // 7. Draw all active remote pilots
    if (otherPlayers) {
      for (let p of otherPlayers) {
        if (p.isDead) continue;
        const pp = toRadar(p.x, p.y);

        // Player Blip
        ctx.fillStyle = p.isLocked ? '#ef4444' : (p.color || '#38bdf8');
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(pp.x, pp.y, 3.5, 0, Math.PI * 2);
        ctx.fill();

        // Direction pointer
        const pRelHeading = ((p.heading - myPlane.heading) * Math.PI) / 180;
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(pp.x, pp.y);
        ctx.lineTo(pp.x + Math.sin(pRelHeading) * 7, pp.y - Math.cos(pRelHeading) * 7);
        ctx.stroke();

        // Pulsing lock ring for locked target
        if (p.isLocked) {
          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(pp.x, pp.y, 7 + Math.sin(now * 0.02) * 2, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Enemy Altitude Readout Tag on Radar (ความสูงศัตรู)
        const pAlt = Math.round(p.alt || 50);
        const myAlt = Math.round(myPlane.alt || 50);
        const dAlt = pAlt - myAlt;
        const altArrow = dAlt > 2 ? '▲' : (dAlt < -2 ? '▼' : '=');
        ctx.fillStyle = p.isLocked ? '#ef4444' : '#e0f2fe';
        ctx.font = 'bold 8px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${pAlt}m ${altArrow}`, pp.x, pp.y - 7);
      }
    }

    // Label & Distance readout
    ctx.fillStyle = nearEdge ? '#ef4444' : '#38bdf8';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`ARENA 1200m • CTR:${Math.round(curDist)}m`, rx, ry + radius + 13);

    ctx.restore();
  }

  drawBoundaryAlertHUD(ctx, distFromCenter, boundaryState, boundaryTimeRem, now) {
    ctx.save();
    const cx = 480;

    if (boundaryState === 'danger') {
      // Red Flashing Danger Box
      const pulse = Math.sin(now * 0.012) > 0;
      ctx.fillStyle = pulse ? 'rgba(239, 68, 68, 0.88)' : 'rgba(153, 27, 27, 0.88)';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.fillRect(cx - 240, 75, 480, 48);
      ctx.strokeRect(cx - 240, 75, 480, 48);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 15px monospace';
      ctx.textAlign = 'center';
      const secText = (boundaryTimeRem || 5).toFixed(1);
      ctx.fillText(`🚨 OUT OF BOUNDS! RETURN TO ARENA IN ${secText}s`, cx, 98);
      ctx.font = '11px monospace';
      ctx.fillText('AUTOPILOT BANKING TOWARDS BATTLEFIELD CENTER', cx, 114);
    } else if (boundaryState === 'caution') {
      // Amber Caution Banner
      const remDist = Math.max(0, Math.round(1200 - distFromCenter));
      ctx.fillStyle = 'rgba(245, 158, 11, 0.85)';
      ctx.strokeStyle = '#fef3c7';
      ctx.lineWidth = 1.5;
      ctx.fillRect(cx - 180, 75, 360, 36);
      ctx.strokeRect(cx - 180, 75, 360, 36);

      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`⚠️ CAUTION: BOUNDARY EDGE IN ${remDist}m`, cx, 98);
    }

    ctx.restore();
  }

  drawAirspeedTape(ctx, speed, throttle) {
    ctx.save();
    const bx = 30;
    const by = 135;
    const bw = 65;
    const bh = 270;

    // Tape box
    ctx.fillStyle = 'rgba(7, 24, 38, 0.75)';
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeRect(bx, by, bw, bh);

    // Speed readout center banner
    ctx.fillStyle = '#0f172a';
    ctx.strokeStyle = '#38bdf8';
    ctx.fillRect(bx - 5, 252, bw + 10, 36);
    ctx.strokeRect(bx - 5, 252, bw + 10, 36);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(Math.round(speed), bx + bw / 2, 276);

    ctx.fillStyle = '#38bdf8';
    ctx.font = '9px monospace';
    ctx.fillText('KTS', bx + bw / 2, 242);

    // Throttle % Power
    const pct = Math.round((throttle / 1.45) * 100);
    ctx.fillStyle = throttle > 1.2 ? '#f97316' : '#10b981';
    ctx.font = 'bold 10px monospace';
    ctx.fillText(`THR ${pct}%`, bx + bw / 2, 395);

    ctx.restore();
  }

  drawAltimeterTape(ctx, altitude, now) {
    ctx.save();
    const bx = 865;
    const by = 135;
    const bw = 65;
    const bh = 270;

    ctx.fillStyle = 'rgba(7, 24, 38, 0.75)';
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeRect(bx, by, bw, bh);

    // Readout banner
    ctx.fillStyle = '#0f172a';
    ctx.strokeStyle = '#38bdf8';
    ctx.fillRect(bx - 5, 252, bw + 10, 36);
    ctx.strokeRect(bx - 5, 252, bw + 10, 36);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(Math.round(altitude * 100), bx + bw / 2, 276);

    ctx.fillStyle = '#38bdf8';
    ctx.font = '9px monospace';
    ctx.fillText('ALT FT', bx + bw / 2, 242);

    ctx.restore();
  }

  drawCompassRibbon(ctx, heading) {
    ctx.save();
    const cx = 480;
    const cy = 25;
    const rw = 260;
    const rh = 28;

    ctx.fillStyle = 'rgba(7, 24, 38, 0.8)';
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.fillRect(cx - rw / 2, cy, rw, rh);
    ctx.strokeRect(cx - rw / 2, cy, rw, rh);

    // Center index arrow
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.moveTo(cx, cy + rh + 6);
    ctx.lineTo(cx - 5, cy + rh);
    ctx.lineTo(cx + 5, cy + rh);
    ctx.closePath();
    ctx.fill();

    // Heading readout
    const hdgDeg = Math.round((heading + 360) % 360);
    const hdgPad = String(hdgDeg).padStart(3, '0');
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${hdgPad}°`, cx, cy + 19);

    ctx.restore();
  }

  draw3DItems(ctx, items, myPlane, pitch, roll, now) {
    if (!items || !items.length || !myPlane) return;

    const hRad = (myPlane.heading * Math.PI) / 180;
    const pRad = ((pitch || 0) * Math.PI) / 180;
    const rRad = ((roll || 0) * Math.PI) / 180;

    const sinH = Math.sin(hRad), cosH = Math.cos(hRad);
    const sinP = Math.sin(pRad), cosP = Math.cos(pRad);
    const sinR = Math.sin(rRad), cosR = Math.cos(rRad);

    const Fx = sinH * cosP, Fy = cosH * cosP, Fz = sinP;
    const Rx = cosH * cosR + sinH * sinP * sinR;
    const Ry = -sinH * cosR + cosH * sinP * sinR;
    const Rz = -cosP * sinR;
    const Ux = -cosH * sinR + sinH * sinP * cosR;
    const Uy = sinH * sinR + cosH * sinP * cosR;
    const Uz = cosP * cosR;

    for (let it of items) {
      const dx = it.x - myPlane.x;
      const dy = it.y - myPlane.y;
      const dz = (it.alt - myPlane.alt) * 8.0;

      const relZ = dx * Fx + dy * Fy + dz * Fz;
      const relX = dx * Rx + dy * Ry + dz * Rz;
      const relY = dx * Ux + dy * Uy + dz * Uz;

      const dist = Math.hypot(dx, dy);
      if (relZ <= 10) continue; // Behind player

      const k = 620 / Math.max(20, relZ);
      const sx = 480 + relX * k;
      const sy = 270 - relY * k;

      if (sx < -60 || sx > this.width + 60 || sy < -60 || sy > this.height + 60) continue;

      ctx.save();
      const scale = Math.min(2.2, Math.max(0.55, 300 / Math.max(30, dist)));
      const pulse = 1.0 + Math.sin(now * 0.006 + it.x) * 0.15;
      const rot = (now * 0.002) % (Math.PI * 2);

      let colMain = '#10b981';
      let colGlow = 'rgba(16, 185, 129, 0.35)';
      let icon = '✚';
      let title = 'MEDKIT +50HP';

      if (it.type === 'damage_boost') {
        colMain = '#f59e0b';
        colGlow = 'rgba(245, 158, 11, 0.35)';
        icon = '⚡';
        title = 'DAMAGE BOOST 2x';
      } else if (it.type === 'shield') {
        colMain = '#38bdf8';
        colGlow = 'rgba(56, 189, 248, 0.35)';
        icon = '🛡️';
        title = 'ENERGY SHIELD';
      }

      // Vertical beacon beam
      const grad = ctx.createLinearGradient(sx, sy - 90 * scale, sx, sy + 30 * scale);
      grad.addColorStop(0, 'rgba(255, 255, 255, 0)');
      grad.addColorStop(0.5, colGlow);
      grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(sx - 3 * scale, sy - 90 * scale, 6 * scale, 120 * scale);

      // Rotating holographic ring
      ctx.strokeStyle = colMain;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(sx, sy, 18 * scale * pulse, 6 * scale * pulse, rot, 0, Math.PI * 2);
      ctx.stroke();

      // Supply crate / energy container box
      ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
      ctx.strokeStyle = colMain;
      ctx.lineWidth = 2;
      ctx.shadowColor = colMain;
      ctx.shadowBlur = 10;
      const boxSize = 14 * scale * pulse;
      ctx.fillRect(sx - boxSize / 2, sy - boxSize / 2, boxSize, boxSize);
      ctx.strokeRect(sx - boxSize / 2, sy - boxSize / 2, boxSize, boxSize);

      // Icon inside box
      ctx.shadowBlur = 0;
      ctx.fillStyle = colMain;
      ctx.font = `bold ${Math.round(11 * scale)}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(icon, sx, sy);

      // Overhead Tag & Distance
      ctx.font = 'bold 10px monospace';
      ctx.fillStyle = colMain;
      ctx.fillText(`[${title}]`, sx, sy - 20 * scale);
      ctx.fillStyle = '#ffffff';
      ctx.font = '9px monospace';
      ctx.fillText(`${Math.round(dist)}m`, sx, sy + 22 * scale);

      ctx.restore();
    }
  }

  drawTerrainWarningHUD(ctx, terrainDist, now) {
    ctx.save();
    const isFlashing = Math.sin(now * 0.015) > 0;
    ctx.fillStyle = isFlashing ? 'rgba(239, 68, 68, 0.85)' : 'rgba(185, 28, 28, 0.85)';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;

    const w = 400;
    const h = 50;
    const x = 480 - w / 2;
    const y = 350;

    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#000000';
    ctx.shadowBlur = 6;
    ctx.fillText('⚠️ PULL UP! TERRAIN AHEAD!', 480, y + 23);

    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = '#fef08a';
    ctx.fillText(`CLEARANCE CRITICAL • DISTANCE: ${Math.round(terrainDist || 0)}m`, 480, y + 41);

    ctx.restore();
  }

  drawCockpitFrame(ctx, myPlane, pitch, roll, now, isFiring) {
    ctx.save();

    const cx = 480;
    const skinColor = (myPlane && myPlane.color) ? myPlane.color : '#38bdf8';
    const rollTilt = (roll || 0) * -0.0025; // G-force cockpit inertia lag
    const pRad = (((pitch || 0) % 360) * Math.PI) / 180;
    const pitchShift = Math.sin(pRad) * 20; // Smooth cyclic inertia shift during 360 loop

    // 1. Sleek 1st-Person Fighter Jet Nose Cone (Extending forward from bottom center)
    ctx.save();
    ctx.translate(cx, 540);
    ctx.rotate(rollTilt);
    ctx.translate(-cx, -540);

    const apexX = cx;
    const apexY = 445 + pitchShift; // Nose radome tip

    // Radome body polygon
    ctx.beginPath();
    ctx.moveTo(apexX, apexY); // Tip of nose cone
    ctx.quadraticCurveTo(cx - 50, 480 + pitchShift, cx - 110, 540); // Left chine
    ctx.lineTo(cx + 110, 540); // Base across cockpit sill
    ctx.quadraticCurveTo(cx + 50, 480 + pitchShift, apexX, apexY); // Right chine
    ctx.closePath();

    // Metallic jet gradient livery
    const noseGrad = ctx.createLinearGradient(cx - 110, 0, cx + 110, 0);
    noseGrad.addColorStop(0, '#0f172a');
    noseGrad.addColorStop(0.2, '#1e293b');
    noseGrad.addColorStop(0.45, skinColor);
    noseGrad.addColorStop(0.55, '#ffffff'); // Light reflection ridge
    noseGrad.addColorStop(0.7, skinColor);
    noseGrad.addColorStop(1, '#0f172a');
    ctx.fillStyle = noseGrad;
    ctx.fill();

    // Darker radome composite cap at tip
    ctx.beginPath();
    ctx.moveTo(apexX, apexY);
    ctx.lineTo(cx - 22, apexY + 32);
    ctx.lineTo(cx + 22, apexY + 32);
    ctx.closePath();
    ctx.fillStyle = '#0f172a';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Pitot tube needle protruding from apex
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(apexX, apexY);
    ctx.lineTo(apexX, apexY - 14);
    ctx.stroke();

    // Nose centerline & panel grooves
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(apexX, apexY + 32);
    ctx.lineTo(cx, 540);
    ctx.stroke();

    // Twin 20mm M61 Vulcan Gun Port Fairings (Left & Right)
    const gunY = 490 + pitchShift;
    [-46, 46].forEach((gx) => {
      ctx.fillStyle = '#09101d';
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(cx + gx, gunY, 5, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Muzzle flash when firing!
      if (isFiring) {
        ctx.fillStyle = '#fbbf24';
        ctx.shadowColor = '#f59e0b';
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.moveTo(cx + gx, gunY - 18);
        ctx.lineTo(cx + gx - 7, gunY - 3);
        ctx.lineTo(cx + gx, gunY);
        ctx.lineTo(cx + gx + 7, gunY - 3);
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    });

    ctx.restore();

    // 2. Cockpit Glare Shield & Instrument Coaming (Bottom Sill)
    ctx.fillStyle = '#060d17';
    ctx.beginPath();
    ctx.moveTo(0, 540);
    ctx.lineTo(0, 505);
    ctx.quadraticCurveTo(cx, 480, 960, 505);
    ctx.lineTo(960, 540);
    ctx.closePath();
    ctx.fill();

    // Top sill bevel highlight
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 505);
    ctx.quadraticCurveTo(cx, 480, 960, 505);
    ctx.stroke();

    // HUD Glass Projector Base
    ctx.fillStyle = '#0a1424';
    ctx.fillRect(cx - 90, 482, 180, 14);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.5)';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(cx - 90, 482, 180, 14);

    // Green projector lens glow
    ctx.fillStyle = 'rgba(16, 185, 129, 0.35)';
    ctx.fillRect(cx - 70, 485, 140, 8);

    // 3. Canopy Frame (A-Pillars & Arched Windshield Bow)
    const pillarGrad = ctx.createLinearGradient(0, 0, 60, 0);
    pillarGrad.addColorStop(0, '#040911');
    pillarGrad.addColorStop(0.5, '#0f172a');
    pillarGrad.addColorStop(1, '#1e293b');

    // Left A-Pillar Strut
    ctx.fillStyle = pillarGrad;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(55, 0);
    ctx.lineTo(40, 505);
    ctx.lineTo(0, 540);
    ctx.closePath();
    ctx.fill();

    // Right A-Pillar Strut
    ctx.fillStyle = pillarGrad;
    ctx.beginPath();
    ctx.moveTo(960, 0);
    ctx.lineTo(905, 0);
    ctx.lineTo(920, 505);
    ctx.lineTo(960, 540);
    ctx.closePath();
    ctx.fill();

    // Top Canopy Arch Header
    ctx.fillStyle = '#060d17';
    ctx.fillRect(0, 0, 960, 14);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 14);
    ctx.lineTo(960, 14);
    ctx.stroke();

    // Left & Right Rearview Mirrors (Top Gun Fighter Jet signature!)
    [ { x: 135, y: 14 }, { x: 825, y: 14 } ].forEach((m) => {
      ctx.fillStyle = '#09101d';
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 1.5;
      ctx.fillRect(m.x - 22, m.y, 44, 20);
      ctx.strokeRect(m.x - 22, m.y, 44, 20);
      // Sky/earth mirror reflection
      ctx.fillStyle = 'rgba(56, 189, 248, 0.25)';
      ctx.fillRect(m.x - 20, m.y + 2, 40, 9);
      ctx.fillStyle = 'rgba(30, 41, 59, 0.4)';
      ctx.fillRect(m.x - 20, m.y + 11, 40, 7);
    });

    // 4. Subtle Outer Bezel
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.7)';
    ctx.lineWidth = 5;
    ctx.strokeRect(0, 0, this.width, this.height);

    ctx.restore();
  }
}

window.DogfightRenderer = DogfightRenderer;
