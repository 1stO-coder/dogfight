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

    // 3. 3D Moving Horizon & Perspective Ground Grid
    this.drawHorizon(ctx, state.pitch, state.roll, state.distance || 0, state.speed || 95, dt);

    // 4. 3D Atmospheric Speed Streamers
    this.drawSpeedStreamers(ctx, state.pitch, state.roll, state.speed || 95, dt);

    // 5. Static HUD Reference Grid
    this.drawBackgroundGrid(ctx);

    // 6. Multi-Aircraft 3D Rendering (all other pilots in the room)
    if (state.otherPlayers && state.otherPlayers.length > 0) {
      this.drawOtherAircraft(ctx, state.otherPlayers, state.myPlane, state.pitch, state.roll, now);
    }

    // 7. Cannon Tracers & Smoke & Explosions
    this.drawTracers(ctx, dt);
    this.drawSmokeParticles(ctx, dt);
    this.drawExplosions(ctx, dt);

    // 8. Fixed Center Reticle & Lead Gunsight
    this.drawCockpitReticle(ctx, state.lockedTarget, state.leadPoint, now);

    // 9. Flight Instruments (Airspeed Tape, Altimeter Tape, Compass Ribbon)
    this.drawAirspeedTape(ctx, state.speed || 95, state.throttle || 1.0);
    this.drawAltimeterTape(ctx, state.altitude || 50, now);
    this.drawCompassRibbon(ctx, state.heading || 0);

    // 10. Tactical 360° Radar Scope
    this.drawTacticalRadar(ctx, state.myPlane, state.otherPlayers, now);

    // 11. Cockpit Frame Bezel
    this.drawCockpitFrame(ctx);

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

  drawBackgroundGrid(ctx) {
    ctx.save();
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.08)';
    ctx.lineWidth = 1;

    for (let x = 0; x <= this.width; x += 80) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.height);
      ctx.stroke();
    }
    for (let y = 0; y <= this.height; y += 60) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.width, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawHorizon(ctx, pitch, roll, distance, speed, dt) {
    ctx.save();
    const cx = this.width / 2;
    const cy = this.height / 2;
    const pitchOffset = pitch * 4.5;
    const rollRad = (roll * Math.PI) / 180;

    ctx.translate(cx, cy + pitchOffset);
    ctx.rotate(-rollRad);

    const extent = 1800;

    // Sky
    const skyGrad = ctx.createLinearGradient(0, -extent, 0, 0);
    skyGrad.addColorStop(0, '#071829');
    skyGrad.addColorStop(0.85, '#1e3a5f');
    skyGrad.addColorStop(1, '#3b6f9e');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(-extent, -extent, extent * 2, extent);

    // Ground
    const groundGrad = ctx.createLinearGradient(0, 0, 0, extent);
    groundGrad.addColorStop(0, '#102a1e');
    groundGrad.addColorStop(0.2, '#0c2016');
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
    ctx.shadowBlur = 0;

    // Ground Perspective Grid Lines
    ctx.strokeStyle = 'rgba(52, 211, 153, 0.22)';
    ctx.lineWidth = 1.2;

    const streamOffset = (distance * 0.6) % 90;
    for (let d = 20; d < 600; d += 60) {
      const lineY = Math.pow((d + streamOffset) / 600, 2) * 450;
      if (lineY > 2 && lineY < extent) {
        ctx.beginPath();
        ctx.moveTo(-extent, lineY);
        ctx.lineTo(extent, lineY);
        ctx.stroke();
      }
    }

    // Longitudinal vanishing lines
    for (let angle = -70; angle <= 70; angle += 14) {
      const rad = (angle * Math.PI) / 180;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.tan(rad) * extent, extent);
      ctx.stroke();
    }

    ctx.restore();
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
    const myHRad = (myPlane.heading * Math.PI) / 180;
    const sinH = Math.sin(myHRad);
    const cosH = Math.cos(myHRad);
    const pitchOffset = pitch * 4.5;

    for (let p of otherPlayers) {
      if (p.isDead) continue;

      // Delta vector in world coords
      const dx = p.x - myPlane.x;
      const dy = p.y - myPlane.y;
      const dAlt = (p.alt - myPlane.alt) * 8.0;

      // Rotate into aircraft body reference frame
      const relZ = dx * sinH + dy * cosH; // Forward (+ = ahead, - = behind)
      const relX = dx * cosH - dy * sinH; // Lateral (+ = right, - = left)
      const relY = dAlt;                  // Vertical (+ = above, - = below)

      const dist = Math.hypot(dx, dy);

      // Only draw if in front of player (relZ > 12)
      if (relZ <= 12) continue;

      // Perspective projection
      const fx = 620;
      const fy = 620;
      const sx = 480 + (relX / Math.max(25, relZ)) * fx;
      const sy = 270 - (relY / Math.max(25, relZ)) * fy + pitchOffset;

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
        const isLocked = p.isLocked;
        ctx.strokeStyle = isLocked ? '#ef4444' : (p.color || '#38bdf8');
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
        ctx.fillText(p.callsign, sx, sy - 18);

        ctx.fillStyle = '#38bdf8';
        ctx.font = '10px monospace';
        ctx.fillText(`${Math.round(dist)}m`, sx, sy + 25);

        ctx.restore();
        continue;
      }

      // Case B: Close Range Fighter Jet (dist <= 450m) -> 3D Jet Silhouette
      const scaleFactor = Math.min(2.0, Math.max(0.65, 420 / Math.max(45, dist)));
      ctx.translate(sx, sy);
      ctx.scale(scaleFactor, scaleFactor);

      // Tilt according to remote plane's roll
      const remoteRollRad = ((p.roll || 0) * Math.PI) / 180;
      ctx.rotate(remoteRollRad * 0.7);

      // 1. Invulnerability Shield Bubble
      if (p.hasShield) {
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

      // Callsign
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(p.callsign, 0, -38);

      // Mini HP Bar
      const barW = 44;
      const barH = 5;
      const hpPct = Math.max(0, p.hp / 100);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.fillRect(-barW / 2, -34, barW, barH);
      ctx.fillStyle = hpPct > 0.5 ? '#10b981' : (hpPct > 0.25 ? '#f59e0b' : '#ef4444');
      ctx.fillRect(-barW / 2, -34, barW * hpPct, barH);
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1;
      ctx.strokeRect(-barW / 2, -34, barW, barH);

      // Distance tag
      ctx.fillStyle = '#38bdf8';
      ctx.font = '10px monospace';
      ctx.fillText(`${Math.round(dist)}m`, 0, 38);

      ctx.restore();
    }
  }

  drawCockpitReticle(ctx, lockedTarget, leadPoint, now) {
    const cx = 480;
    const cy = 270;
    ctx.save();

    // 1. Center Boresight Crosshair
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

    // 2. Lock-on Box & Indicator
    if (lockedTarget && lockedTarget.screenX !== undefined) {
      const tx = lockedTarget.screenX;
      const ty = lockedTarget.screenY;
      const pulseSize = 36 + Math.sin(now * 0.02) * 4;

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

      // LOCK 100% Text
      ctx.fillStyle = '#ef4444';
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`LOCKED • ${lockedTarget.callsign}`, tx, ty - pulseSize - 8);
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

  drawTacticalRadar(ctx, myPlane, otherPlayers, now) {
    if (!myPlane) return;
    ctx.save();

    const rx = 855;
    const ry = 435;
    const radius = 75;

    // Scope background
    ctx.fillStyle = 'rgba(7, 24, 38, 0.88)';
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(rx, ry, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Range rings (500m & 1000m)
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(rx, ry, radius * 0.4, 0, Math.PI * 2);
    ctx.arc(rx, ry, radius * 0.75, 0, Math.PI * 2);
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

    // Center dot: Own Aircraft (White triangle pointing straight UP)
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(rx, ry - 6);
    ctx.lineTo(rx + 4, ry + 4);
    ctx.lineTo(rx - 4, ry + 4);
    ctx.closePath();
    ctx.fill();

    // Draw all active remote pilots
    const maxRadarRange = 1200; // meters
    const myHRad = (myPlane.heading * Math.PI) / 180;

    if (otherPlayers) {
      for (let p of otherPlayers) {
        if (p.isDead) continue;
        const dx = p.x - myPlane.x;
        const dy = p.y - myPlane.y;
        const dist = Math.hypot(dx, dy);

        // Body relative angle: 0 = straight ahead
        const worldAngle = Math.atan2(dx, dy);
        const relAngle = worldAngle - myHRad;

        const radarDist = Math.min(radius - 5, (dist / maxRadarRange) * radius);
        const bx = rx + Math.sin(relAngle) * radarDist;
        const by = ry - Math.cos(relAngle) * radarDist;

        // Player Blip
        ctx.fillStyle = p.isLocked ? '#ef4444' : (p.color || '#38bdf8');
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(bx, by, 3.5, 0, Math.PI * 2);
        ctx.fill();

        // Direction pointer
        const pRelHeading = ((p.heading - myPlane.heading) * Math.PI) / 180;
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + Math.sin(pRelHeading) * 7, by - Math.cos(pRelHeading) * 7);
        ctx.stroke();
      }
    }

    // Label
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('TACTICAL 360°', rx, ry + radius + 12);

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

  drawCockpitFrame(ctx) {
    ctx.save();
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.6)';
    ctx.lineWidth = 6;
    ctx.strokeRect(0, 0, this.width, this.height);
    ctx.restore();
  }
}

window.DogfightRenderer = DogfightRenderer;
