/**
 * Sky Ace: Dogfight Arena - Main Client Game Engine
 * Coordinates flight physics, multi-target combat, respawns, HUD, and network sync.
 */
class DogfightGame {
  constructor() {
    this.canvas = document.getElementById('flight-canvas');
    this.renderer = new DogfightRenderer(this.canvas);
    this.joystick = window.DogfightJoystick;
    this.audio = window.DogfightAudio;
    this.network = window.DogfightNetwork;

    // Local Player State
    this.player = {
      id: null,
      callsign: 'Maverick',
      color: '#38bdf8',
      x: 0,
      y: 0,
      alt: 50,
      heading: 0,
      pitch: 0,
      roll: 0,
      speed: 95,
      hp: 100,
      maxHp: 100,
      isDead: false,
      hasShield: true,
      shieldUntil: performance.now() + 3000,
      kills: 0,
      deaths: 0,
      score: 0,
    };

    // Remote Players Dictionary: id -> playerObject
    this.otherPlayers = {};
    this.lockedTarget = null;
    this.leadPoint = null;

    // Combat & Timing
    this.lastFireTime = 0;
    this.fireRateMs = 110; // Rapid twin cannon fire
    this.targetWasLocked = false;
    this.flightDistance = 0;

    // Network Sync Timing
    this.lastNetworkSyncTime = 0;
    this.networkSyncIntervalMs = 40; // 25 Hz sync

    // Game Mode: 'lobby' | 'flight'
    this.mode = 'lobby';

    // Animation loop
    this.lastFrameTime = performance.now();
    this.animationFrameId = null;

    // DOM Elements
    this.dom = {
      lobbyModal: document.getElementById('modal-lobby'),
      hudContainer: document.getElementById('hud-container'),
      deathOverlay: document.getElementById('overlay-death'),
      deathKillerName: document.getElementById('death-killer-name'),
      deathTimer: document.getElementById('death-timer'),
      respawnCountdown: document.getElementById('respawn-countdown'),
      killFeed: document.getElementById('kill-feed'),
      scoreboardModal: document.getElementById('modal-scoreboard'),
      scoreboardTable: document.getElementById('scoreboard-table-body'),
      hudHpBar: document.getElementById('hud-hp-bar'),
      hudHpText: document.getElementById('hud-hp-text'),
      hudKills: document.getElementById('hud-kills'),
      hudDeaths: document.getElementById('hud-deaths'),
      hudPing: document.getElementById('hud-ping'),
      hudShieldBadge: document.getElementById('hud-shield-badge'),
      inputCallsign: document.getElementById('input-callsign'),
      inputRoom: document.getElementById('input-room'),
      btnJoin: document.getElementById('btn-join'),
      btnCreate: document.getElementById('btn-create'),
      colorPicker: document.querySelectorAll('.color-choice'),
      joystickBadge: document.getElementById('joystick-status-badge'),
      invertPitchBtn: document.getElementById('btn-invert-pitch'),
      invertRollBtn: document.getElementById('btn-invert-roll'),
      btnCopyLink: document.getElementById('btn-copy-link'),
      roomBanner: document.getElementById('hud-room-code'),
    };

    this.initEventListeners();
    this.setupNetworkCallbacks();
  }

  initEventListeners() {
    // Check URL parameters for direct room join
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam && this.dom.inputRoom) {
      this.dom.inputRoom.value = roomParam.toUpperCase();
    }

    // Color picker
    this.dom.colorPicker.forEach((btn) => {
      btn.addEventListener('click', () => {
        this.dom.colorPicker.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.player.color = btn.getAttribute('data-color') || '#38bdf8';
      });
    });

    // Invert Pitch / Roll
    if (this.dom.invertPitchBtn) {
      this.dom.invertPitchBtn.addEventListener('click', () => {
        this.joystick.invertPitch = !this.joystick.invertPitch;
        this.dom.invertPitchBtn.classList.toggle('active', this.joystick.invertPitch);
      });
    }
    if (this.dom.invertRollBtn) {
      this.dom.invertRollBtn.addEventListener('click', () => {
        this.joystick.invertRoll = !this.joystick.invertRoll;
        this.dom.invertRollBtn.classList.toggle('active', this.joystick.invertRoll);
      });
    }

    // Join Button
    if (this.dom.btnJoin) {
      this.dom.btnJoin.addEventListener('click', () => this.handleJoinRoom());
    }

    // Create Room Button
    if (this.dom.btnCreate) {
      this.dom.btnCreate.addEventListener('click', () => {
        const randCode = 'ACE-' + Math.floor(10 + Math.random() * 90);
        this.dom.inputRoom.value = randCode;
        this.handleJoinRoom();
      });
    }

    // Copy Link Button
    if (this.dom.btnCopyLink) {
      this.dom.btnCopyLink.addEventListener('click', () => {
        const url = `${window.location.origin}/?room=${encodeURIComponent(this.network.roomCode || '')}`;
        navigator.clipboard.writeText(url).then(() => {
          this.dom.btnCopyLink.textContent = '✓ Copied Link!';
          setTimeout(() => (this.dom.btnCopyLink.textContent = '🔗 Share Link'), 2000);
        });
      });
    }

    // Joystick device badge updates
    this.joystick.callbacks.onConnectionChange = (info) => {
      this.updateJoystickBadge(info);
    };
    this.updateJoystickBadge(this.joystick.getDeviceInfo());
  }

  updateJoystickBadge(info) {
    if (!this.dom.joystickBadge) return;
    if (info.connected) {
      const short = info.name.length > 25 ? info.name.substring(0, 23) + '...' : info.name;
      this.dom.joystickBadge.innerHTML = `<span class="dot connected">●</span> 🎮 ${short}`;
      this.dom.joystickBadge.classList.add('connected');
    } else {
      this.dom.joystickBadge.innerHTML = `<span class="dot">○</span> ⌨️ Keyboard Mode (W/S/A/D)`;
      this.dom.joystickBadge.classList.remove('connected');
    }
  }

  async handleJoinRoom() {
    const callsign = (this.dom.inputCallsign.value || 'Maverick').trim();
    let room = (this.dom.inputRoom.value || 'SKY-1').trim().toUpperCase();

    this.player.callsign = callsign;
    this.audio.init();

    try {
      this.dom.btnJoin.disabled = true;
      this.dom.btnJoin.textContent = 'Connecting...';
      await this.network.connect(room, callsign, this.player.color);
    } catch (e) {
      alert('Failed to connect to Dogfight server: ' + e);
      this.dom.btnJoin.disabled = false;
      this.dom.btnJoin.textContent = 'Engage Sortie';
    }
  }

  setupNetworkCallbacks() {
    this.network.callbacks.onJoined = (data) => {
      this.player.id = data.playerId;
      this.dom.lobbyModal.style.display = 'none';
      this.dom.hudContainer.style.display = 'block';
      this.mode = 'flight';

      if (this.dom.roomBanner) {
        this.dom.roomBanner.textContent = `ROOM: ${data.room}`;
      }

      // Initialize remote players list
      this.otherPlayers = {};
      if (data.players) {
        for (let p of data.players) {
          if (p.id !== this.player.id) {
            this.otherPlayers[p.id] = { ...p, targetX: p.x, targetY: p.y };
          }
        }
      }

      // Start 60 FPS Game Loop
      this.lastFrameTime = performance.now();
      if (!this.animationFrameId) {
        this.animationFrameId = requestAnimationFrame((t) => this.loop(t));
      }
    };

    this.network.callbacks.onPlayerJoined = (p) => {
      if (p.id !== this.player.id) {
        this.otherPlayers[p.id] = { ...p, targetX: p.x, targetY: p.y };
        this.addKillFeedNotice(`✈️ [${p.callsign}] has entered airspace`);
      }
    };

    this.network.callbacks.onPlayerLeft = (pid, callsign) => {
      delete this.otherPlayers[pid];
      this.addKillFeedNotice(`💨 [${callsign}] departed airspace`);
    };

    this.network.callbacks.onWorldUpdate = (players) => {
      for (let p of players) {
        if (p.id === this.player.id) {
          // Update local scores from server
          this.player.kills = p.kills;
          this.player.deaths = p.deaths;
          this.player.score = p.score;
          this.player.hasShield = p.hasShield;
        } else {
          // Interpolate remote player
          if (!this.otherPlayers[p.id]) {
            this.otherPlayers[p.id] = { ...p, targetX: p.x, targetY: p.y };
          } else {
            const op = this.otherPlayers[p.id];
            op.targetX = p.x;
            op.targetY = p.y;
            op.targetAlt = p.alt;
            op.targetHeading = p.heading;
            op.pitch = p.pitch;
            op.roll = p.roll;
            op.speed = p.speed;
            op.hp = p.hp;
            op.isDead = p.isDead;
            op.hasShield = p.hasShield;
            op.kills = p.kills;
            op.deaths = p.deaths;
            op.score = p.score;
            op.ping = p.ping;
          }
        }
      }
    };

    this.network.callbacks.onWeaponFired = (data) => {
      // Audio or visual tracer from remote shooter
      const shooter = this.otherPlayers[data.shooterId];
      if (shooter && shooter.dist !== undefined && shooter.dist < 800) {
        // Subtle distant cannon burst
      }
    };

    this.network.callbacks.onPlayerDamaged = (data) => {
      if (data.targetId === this.player.id) {
        // Local player took damage!
        this.player.hp = data.hp;
        this.renderer.triggerShake(90, 5);
        this.renderer.triggerFlash(90, 'rgba(239, 68, 68, 0.45)');
        this.audio.playHitTarget();
        if (this.player.hp < 30) {
          this.audio.playWarningSiren();
        }
      } else {
        // Remote player took damage
        const tgt = this.otherPlayers[data.targetId];
        if (tgt) {
          tgt.hp = data.hp;
        }
      }
    };

    this.network.callbacks.onPlayerKilled = (data) => {
      const killerName = data.killerCallsign;
      const victimName = data.victimCallsign;
      this.addKillFeedEntry(killerName, victimName);

      // If local player scored the kill!
      if (data.killerId === this.player.id) {
        this.audio.playKillReward();
        this.showKillConfirmedSplash(victimName);
      }

      // If local player was killed!
      if (data.victimId === this.player.id) {
        this.player.isDead = true;
        this.player.hp = 0;
        this.audio.playExplosion();
        this.renderer.triggerShake(450, 15);
        this.renderer.triggerFlash(400, 'rgba(239, 68, 68, 0.8)');
        this.showDeathScreen(killerName, data.respawnIn || 3.0);
      } else {
        // Remote plane exploded
        const victim = this.otherPlayers[data.victimId];
        if (victim && victim.screenX !== undefined && victim.inFront) {
          this.renderer.addExplosion(victim.screenX, victim.screenY, 1.8);
          this.audio.playExplosion();
        }
      }
    };

    this.network.callbacks.onPlayerRespawned = (data) => {
      if (data.playerId === this.player.id) {
        // Local player respawned
        this.player.isDead = false;
        this.player.hp = 100;
        this.player.x = data.x;
        this.player.y = data.y;
        this.player.alt = data.alt;
        this.player.heading = data.heading;
        this.player.pitch = 0;
        this.player.roll = 0;
        this.player.hasShield = true;
        this.player.shieldUntil = performance.now() + 3000;

        this.hideDeathScreen();
        this.audio.playRespawn();
      } else {
        // Remote player respawned
        const p = this.otherPlayers[data.playerId];
        if (p) {
          p.isDead = false;
          p.hp = 100;
          p.x = data.x;
          p.y = data.y;
          p.targetX = data.x;
          p.targetY = data.y;
          p.alt = data.alt;
          p.heading = data.heading;
          p.hasShield = true;
        }
      }
    };

    this.network.callbacks.onError = (msg) => {
      alert(msg);
      this.dom.btnJoin.disabled = false;
      this.dom.btnJoin.textContent = 'Engage Sortie';
    };

    this.network.callbacks.onDisconnect = () => {
      alert('Disconnected from Dogfight Server');
      location.reload();
    };
  }

  fireWeapon() {
    const now = performance.now();
    if (this.player.isDead || now - this.lastFireTime < this.fireRateMs) return;
    this.lastFireTime = now;

    this.audio.playCannonFire();
    this.renderer.triggerShake(50, 2.5);
    this.network.sendFire();

    // Visual Wing Cannon Tracers
    let aimX = 480;
    let aimY = 270;
    if (this.lockedTarget && this.lockedTarget.screenX !== undefined) {
      aimX = this.lockedTarget.screenX;
      aimY = this.lockedTarget.screenY;
    }
    this.renderer.addTracer(aimX, aimY);

    // Hit Registration check against active targets in front
    if (this.lockedTarget && !this.lockedTarget.isDead && !this.lockedTarget.hasShield) {
      const tx = this.lockedTarget.screenX;
      const ty = this.lockedTarget.screenY;
      const distToCrosshair = Math.hypot(480 - tx, 270 - ty);

      // Hits register when target is in gunsight lock cone (< 90px)
      if (this.lockedTarget.dist < 800 && distToCrosshair < 90) {
        this.audio.playHitTarget();
        this.renderer.addExplosion(tx, ty, 0.7);
        this.renderer.triggerFlash(90, 'rgba(255, 176, 46, 0.4)');
        this.network.sendHit(this.lockedTarget.id, 12);
      }
    }
  }

  showDeathScreen(killerCallsign, seconds) {
    if (!this.dom.deathOverlay) return;
    this.dom.deathKillerName.textContent = killerCallsign;
    this.dom.deathOverlay.style.display = 'flex';

    let rem = Math.ceil(seconds);
    this.dom.respawnCountdown.textContent = rem;
    const interval = setInterval(() => {
      rem--;
      if (rem >= 0) {
        this.dom.respawnCountdown.textContent = rem;
      }
      if (rem <= 0 || !this.player.isDead) {
        clearInterval(interval);
      }
    }, 1000);
  }

  hideDeathScreen() {
    if (this.dom.deathOverlay) {
      this.dom.deathOverlay.style.display = 'none';
    }
  }

  showKillConfirmedSplash(victimName) {
    const banner = document.createElement('div');
    banner.className = 'kill-splash-banner';
    banner.innerHTML = `<span class="accent">💥 KILL CONFIRMED</span> • ${victimName} (+100 PTS)`;
    document.body.appendChild(banner);
    setTimeout(() => banner.remove(), 2200);
  }

  addKillFeedEntry(killer, victim) {
    if (!this.dom.killFeed) return;
    const entry = document.createElement('div');
    entry.className = 'kill-feed-row';
    entry.innerHTML = `<span class="killer">${killer}</span> <span class="ico">💥</span> <span class="victim">${victim}</span>`;
    this.dom.killFeed.prepend(entry);
    setTimeout(() => entry.remove(), 6000);
  }

  addKillFeedNotice(text) {
    if (!this.dom.killFeed) return;
    const entry = document.createElement('div');
    entry.className = 'kill-feed-notice';
    entry.textContent = text;
    this.dom.killFeed.prepend(entry);
    setTimeout(() => entry.remove(), 4000);
  }

  updateHUD() {
    // Local HP bar
    if (this.dom.hudHpBar) {
      const pct = Math.max(0, this.player.hp);
      this.dom.hudHpBar.style.width = `${pct}%`;
      this.dom.hudHpBar.className = pct > 50 ? 'hp-good' : (pct > 25 ? 'hp-warn' : 'hp-crit');
    }
    if (this.dom.hudHpText) {
      this.dom.hudHpText.textContent = `${this.player.hp} / 100`;
    }
    if (this.dom.hudKills) {
      this.dom.hudKills.textContent = `${this.player.kills}`;
    }
    if (this.dom.hudDeaths) {
      this.dom.hudDeaths.textContent = `${this.player.deaths}`;
    }
    if (this.dom.hudPing) {
      this.dom.hudPing.textContent = `${this.network.ping}ms`;
    }
    if (this.dom.hudShieldBadge) {
      this.dom.hudShieldBadge.style.display = this.player.hasShield ? 'inline-block' : 'none';
    }
  }

  renderScoreboard(show) {
    if (!this.dom.scoreboardModal) return;
    this.dom.scoreboardModal.style.display = show ? 'flex' : 'none';

    if (show && this.dom.scoreboardTable) {
      const allList = [
        {
          callsign: this.player.callsign,
          color: this.player.color,
          kills: this.player.kills,
          deaths: this.player.deaths,
          score: this.player.score,
          ping: this.network.ping,
          isMe: true,
        },
        ...Object.values(this.otherPlayers).map((p) => ({
          callsign: p.callsign,
          color: p.color,
          kills: p.kills || 0,
          deaths: p.deaths || 0,
          score: p.score || 0,
          ping: p.ping || 0,
          isMe: false,
        })),
      ];

      // Sort by score descending
      allList.sort((a, b) => b.score - a.score);

      this.dom.scoreboardTable.innerHTML = allList
        .map(
          (p, idx) => `
        <tr class="${p.isMe ? 'row-me' : ''}">
          <td>#${idx + 1}</td>
          <td><span class="color-dot" style="background:${p.color}"></span> ${p.callsign} ${p.isMe ? '(YOU)' : ''}</td>
          <td class="num">${p.kills}</td>
          <td class="num">${p.deaths}</td>
          <td class="num font-bold text-amber">${p.score}</td>
          <td class="num">${p.ping}ms</td>
        </tr>
      `
        )
        .join('');
    }
  }

  /**
   * Main 60 FPS Game Loop
   */
  loop(timestamp) {
    const dt = Math.min((timestamp - this.lastFrameTime) / 1000, 0.1);
    this.lastFrameTime = timestamp;

    if (this.mode === 'flight') {
      const input = this.joystick.poll();

      if (!this.player.isDead) {
        // Continuous weapon fire trigger
        if (input.isFiring) {
          this.fireWeapon();
        }

        // Flight Physics Update:
        // Authentic flight controls:
        // S / Stick Back = +Pitch (Climb)
        // W / Stick Forward = -Pitch (Dive)
        // D / Stick Right = +Roll (Bank Right)
        // A / Stick Left = -Roll (Bank Left)
        const controlSpeed = 42; // deg/sec
        this.player.pitch = Math.max(-35, Math.min(35, this.player.pitch + input.pitch * controlSpeed * dt));
        this.player.roll = Math.max(-60, Math.min(60, this.player.roll + input.roll * controlSpeed * dt));

        // Banking turns heading (coordinated turn dynamics: ~55 deg/s at 20° bank)
        const turnRate = (this.player.roll / 20) * 55;
        this.player.heading = (this.player.heading + turnRate * dt + 360) % 360;

        // Altitude physics: climbing raises alt, diving lowers alt
        const climbRate = 5.2;
        this.player.alt = Math.max(5, Math.min(95, this.player.alt + (this.player.pitch / 25) * climbRate * dt));

        // Airspeed dynamics: base 95 kts scaled by throttle input (70 to 140 kts)
        const targetSpeed = 95 * input.throttle;
        this.player.speed += (targetSpeed - this.player.speed) * 4 * dt;
        this.audio.updateEngineRPM(this.player.speed);

        // World displacement
        const speedMPS = this.player.speed * 0.45;
        const headingRad = (this.player.heading * Math.PI) / 180;
        this.player.x += Math.sin(headingRad) * speedMPS * dt;
        this.player.y += Math.cos(headingRad) * speedMPS * dt;
        this.flightDistance += speedMPS * dt;

        // Check shield expiry
        if (this.player.hasShield && performance.now() > this.player.shieldUntil) {
          this.player.hasShield = false;
        }

        // Network State Sync (25 Hz)
        if (timestamp - this.lastNetworkSyncTime > this.networkSyncIntervalMs) {
          this.lastNetworkSyncTime = timestamp;
          this.network.sendFlightState(this.player);
        }
      }

      // Smoothly interpolate remote players toward target positions
      const otherList = Object.values(this.otherPlayers);
      for (let p of otherList) {
        if (p.targetX !== undefined) {
          p.x += (p.targetX - p.x) * 15 * dt;
          p.y += (p.targetY - p.y) * 15 * dt;
        }
        if (p.targetAlt !== undefined) {
          p.alt += (p.targetAlt - p.alt) * 15 * dt;
        }
        if (p.targetHeading !== undefined) {
          p.heading += (p.targetHeading - p.heading) * 15 * dt;
        }
      }

      // Lock-On Detection & Lead Aim Calculation:
      // Search for the closest aircraft in front near center boresight (480, 270)
      let bestTarget = null;
      let minCrosshairDist = 85; // Lock radius pixels

      for (let p of otherList) {
        p.isLocked = false;
        if (!p.isDead && p.inFront && p.dist < 800) {
          const dCenter = Math.hypot(480 - p.screenX, 270 - p.screenY);
          if (dCenter < minCrosshairDist) {
            minCrosshairDist = dCenter;
            bestTarget = p;
          }
        }
      }

      if (bestTarget) {
        bestTarget.isLocked = true;
        this.lockedTarget = bestTarget;
        if (!this.targetWasLocked) {
          this.audio.playLockOn();
        }
        this.targetWasLocked = true;

        // Compute predictive lead reticle based on target's speed & roll
        const leadDist = Math.max(15, bestTarget.dist / 35);
        const leadRad = ((bestTarget.heading - this.player.heading) * Math.PI) / 180;
        this.leadPoint = {
          x: bestTarget.screenX + Math.sin(leadRad) * leadDist,
          y: bestTarget.screenY - Math.cos(leadRad) * leadDist,
        };
      } else {
        this.lockedTarget = null;
        this.leadPoint = null;
        this.targetWasLocked = false;
      }

      // Render 3D World & HUD
      this.renderer.render(
        {
          pitch: this.player.pitch,
          roll: this.player.roll,
          heading: this.player.heading,
          speed: this.player.speed,
          throttle: input.throttle,
          altitude: this.player.alt,
          distance: this.flightDistance,
          hp: this.player.hp,
          isDead: this.player.isDead,
          myPlane: this.player,
          otherPlayers: otherList,
          lockedTarget: this.lockedTarget,
          leadPoint: this.leadPoint,
        },
        dt
      );

      this.updateHUD();
      this.renderScoreboard(input.showScoreboard);
    }

    this.animationFrameId = requestAnimationFrame((t) => this.loop(t));
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.DogfightGameInstance = new DogfightGame();
});
