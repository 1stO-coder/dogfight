/**
 * Sky Ace: Dogfight Arena - Main Client Game Engine
 * Coordinates flight physics, multi-target combat, respawns, HUD, and network sync.
 */

function getTerrainHeight(x, y) {
  let maxH = 0;
  const list = window.DOGFIGHT_MOUNTAINS || [];
  for (let m of list) {
    const dist = Math.hypot(x - m.x, y - m.y);
    if (dist < m.r) {
      const h = m.h * (1 - Math.pow(dist / m.r, 1.1));
      if (h > maxH) maxH = h;
    }
  }
  return maxH;
}

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
      level: 1,
      hp: 100,
      maxHp: 100,
      shieldHp: 0,
      isDead: false,
      hasShield: false,
      hasSpawnProtection: true,
      spawnProtectionUntil: performance.now() + 3000,
      shieldUntil: 0,
      hasDamageBoost: false,
      damageBoostUntil: 0,
      kills: 0,
      deaths: 0,
      score: 0,
      magAmmo: 150,
      maxMag: 150,
      reserveAmmo: 300,
      maxReserve: 600,
    };

    // Tactical In-Game Items & Terrain Proximity
    this.items = [];
    this.terrainWarning = false;
    this.terrainDist = 0;

    // Remote Players Dictionary: id -> playerObject
    this.otherPlayers = {};
    this.lockedTarget = null;
    this.leadPoint = null;

    // Combat & Timing
    this.lastFireTime = 0;
    this.fireRateMs = 80; // Rapid high-cyclic twin cannon fire
    this.targetWasLocked = false;
    this.flightDistance = 0;

    // Ammo & 5s Reload System ("ถ้ายิงหมดแม็ก ให้มี reload 5 วิ")
    this.isReloading = false;
    this.reloadTimeRemaining = 0.0;
    this.reloadDuration = 5.0;

    // Network Sync Timing
    this.lastNetworkSyncTime = 0;
    this.networkSyncIntervalMs = 40; // 25 Hz sync

    // Game Mode: 'lobby' | 'flight'
    this.mode = 'lobby';

    // Combat Airspace Boundary Tracking (1200m Radius Arena)
    this.distFromCenter = 0;
    this.boundaryState = 'safe'; // 'safe' | 'caution' | 'danger'
    this.boundaryTimeRemaining = 5.0;

    // Animation loop
    this.lastFrameTime = performance.now();
    this.animationFrameId = null;

    // DOM Elements
    this.dom = {
      lobbyModal: document.getElementById('modal-lobby'),
      lobbyErrorMsg: document.getElementById('lobby-error-msg'),
      hudContainer: document.getElementById('hud-container'),
      deathOverlay: document.getElementById('overlay-death'),
      deathKillerName: document.getElementById('death-killer-name'),
      deathTimer: document.getElementById('death-timer'),
      respawnCountdown: document.getElementById('respawn-countdown'),
      killFeed: document.getElementById('kill-feed'),
      scoreboardModal: document.getElementById('modal-scoreboard'),
      scoreboardTable: document.getElementById('scoreboard-table-body'),
      hudHpBar: document.getElementById('hud-hp-bar'),
      hudShieldBar: document.getElementById('hud-shield-bar'),
      hudHpText: document.getElementById('hud-hp-text'),
      hudKills: document.getElementById('hud-kills'),
      hudDeaths: document.getElementById('hud-deaths'),
      hudPing: document.getElementById('hud-ping'),
      hudShieldBadge: document.getElementById('hud-shield-badge'),
      hudDmgBadge: document.getElementById('hud-dmg-badge'),
      hudLevelBadge: document.getElementById('hud-level-badge'),
      hudMagAmmo: document.getElementById('hud-mag-ammo'),
      hudResAmmo: document.getElementById('hud-res-ammo'),
      hudAmmoText: document.getElementById('hud-ammo-text'),
      hudReloadStatus: document.getElementById('hud-reload-status'),
      btnManualReload: document.getElementById('btn-manual-reload'),
      inputCallsign: document.getElementById('input-callsign'),
      btnJoin: document.getElementById('btn-join'),
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
    // Color picker
    this.dom.colorPicker.forEach((btn) => {
      btn.addEventListener('click', () => {
        this.dom.colorPicker.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.player.color = btn.getAttribute('data-color') || '#38bdf8';
      });
    });

    // Manual Reload Button & Keyboard 'R' Listener
    if (this.dom.btnManualReload) {
      this.dom.btnManualReload.addEventListener('click', () => {
        this.triggerReload();
      });
    }
    window.addEventListener('keydown', (e) => {
      if (e.key === 'r' || e.key === 'R') {
        this.triggerReload();
      }
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

    // Join Button (Single shared arena)
    if (this.dom.btnJoin) {
      this.dom.btnJoin.addEventListener('click', () => this.handleJoinRoom());
    }

    // Input Enter key triggers join
    if (this.dom.inputCallsign) {
      this.dom.inputCallsign.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          this.handleJoinRoom();
        }
      });
    }

    // Copy Link Button
    if (this.dom.btnCopyLink) {
      this.dom.btnCopyLink.addEventListener('click', () => {
        const url = window.location.origin;
        navigator.clipboard.writeText(url).then(() => {
          this.dom.btnCopyLink.textContent = '✓ Copied Link!';
          setTimeout(() => (this.dom.btnCopyLink.textContent = '🔗 Share Link'), 2000);
        });
      });
    }

    // Joystick device badge updates & button test feedback
    this.joystick.callbacks.onConnectionChange = (info) => {
      this.updateJoystickBadge(info);
    };
    this.updateJoystickBadge(this.joystick.getDeviceInfo());
  }

  updateJoystickBadge(info) {
    if (!this.dom.joystickBadge) return;
    if (info.connected) {
      const short = info.name.length > 28 ? info.name.substring(0, 26) + '...' : info.name;
      const lastKey = this.joystick.lastPressedButton ? ` • [${this.joystick.lastPressedButton}]` : '';
      this.dom.joystickBadge.innerHTML = `<span class="dot connected">●</span> 🎮 ${short}${lastKey}`;
      this.dom.joystickBadge.classList.add('connected');
    } else {
      this.dom.joystickBadge.innerHTML = `<span class="dot">○</span> ⌨️ Keyboard Mode (W/S/A/D)`;
      this.dom.joystickBadge.classList.remove('connected');
    }
  }

  async handleJoinRoom() {
    const callsign = (this.dom.inputCallsign.value || '').trim();
    if (!callsign) {
      if (this.dom.lobbyErrorMsg) {
        this.dom.lobbyErrorMsg.textContent = 'กรุณากรอกชื่อนักบินก่อนเข้าเล่น (Enter Callsign)';
        this.dom.lobbyErrorMsg.style.display = 'block';
      }
      return;
    }

    if (this.dom.lobbyErrorMsg) {
      this.dom.lobbyErrorMsg.style.display = 'none';
    }

    this.player.callsign = callsign;
    this.audio.init();

    try {
      this.dom.btnJoin.disabled = true;
      this.dom.btnJoin.textContent = 'Connecting to Arena...';
      // Connect to single shared ARENA
      await this.network.connect('ARENA', callsign, this.player.color);
    } catch (e) {
      if (this.dom.lobbyErrorMsg) {
        this.dom.lobbyErrorMsg.textContent = 'เกิดข้อผิดพลาดในการเชื่อมต่อ: ' + e;
        this.dom.lobbyErrorMsg.style.display = 'block';
      }
      this.dom.btnJoin.disabled = false;
      this.dom.btnJoin.textContent = 'ENGAGE SORTIE (เข้าสู่สนามรบ)';
    }
  }

  setupNetworkCallbacks() {
    this.network.callbacks.onJoined = (data) => {
      this.player.id = data.playerId;
      this.dom.lobbyModal.style.display = 'none';
      this.dom.hudContainer.style.display = 'block';
      this.mode = 'flight';

      if (this.dom.roomBanner) {
        this.dom.roomBanner.textContent = `ARENA (1200m)`;
      }

      // Initialize items from server
      this.items = data.items || [];

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

    this.network.callbacks.onWorldUpdate = (players, items) => {
      if (items) {
        this.items = items;
      }

      for (let p of players) {
        if (p.id === this.player.id) {
          // Update local scores & buffs from server
          this.player.kills = p.kills;
          this.player.deaths = p.deaths;
          this.player.score = p.score;
          this.player.level = p.level || this.player.level;
          this.player.maxHp = p.maxHp || this.player.maxHp;
          this.player.shieldHp = p.shieldHp || 0;
          this.player.hasShield = p.hasShield || false;
          this.player.hasSpawnProtection = p.hasSpawnProtection || false;
          this.player.hasDamageBoost = p.hasDamageBoost;
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
            op.maxHp = p.maxHp || 100;
            op.shieldHp = p.shieldHp || 0;
            op.level = p.level || 1;
            op.isDead = p.isDead;
            op.hasShield = p.hasShield;
            op.hasSpawnProtection = p.hasSpawnProtection;
            op.hasDamageBoost = p.hasDamageBoost;
            op.kills = p.kills;
            op.deaths = p.deaths;
            op.score = p.score;
            op.ping = p.ping;
          }
        }
      }
    };

    this.network.callbacks.onItemCollected = (data) => {
      this.items = this.items.filter((it) => it.id !== data.itemId);

      if (data.collectorId === this.player.id) {
        this.player.hp = data.collectorHp;
        this.player.maxHp = data.collectorMaxHp;

        if (data.itemType === 'medkit') {
          this.audio.playItemPickup('medkit');
          this.showPowerupSplash('💚 MEDKIT COLLECTED!', '+50 HP HULL REPAIRED');
        } else if (data.itemType === 'damage_boost') {
          this.audio.playItemPickup('damage_boost');
          this.player.hasDamageBoost = true;
          this.player.damageBoostUntil = performance.now() + 120000;
          this.showPowerupSplash('⚡ OVERCHARGED CANNONS!', '2X DAMAGE • 2 MINUTES DURATION');
        } else if (data.itemType === 'shield') {
          this.audio.playItemPickup('shield');
          this.player.shieldHp = data.collectorShieldHp !== undefined ? data.collectorShieldHp : (this.player.shieldHp + 20);
          this.player.hasShield = true;
          this.player.shieldUntil = performance.now() + 120000;
          this.showPowerupSplash('🛡️ TEMPORARY ARMOR +20 HP!', 'เพิ่มเกราะ +20 เลือดชั่วคราว • 2 MINUTES DURATION');
        } else if (data.itemType === 'ammo') {
          this.audio.playItemPickup('ammo');
          // Instantly cancel any ongoing reload and replenish gun to full 150 bullets
          this.isReloading = false;
          this.reloadTimeRemaining = 0.0;
          this.player.magAmmo = 150;
          this.player.reserveAmmo = Math.min(this.player.maxReserve, this.player.reserveAmmo + 150);
          this.showPowerupSplash('📦 AMMO RESTOCKED +150!', 'เติมกระสุนเต็มแม็ก 150 นัด พร้อมยิงทันที!');
          this.addKillFeedEntry('SUPPLY AIRDROP', `📦 ${this.player.callsign} REPLENISHED +150 AMMO!`);
        }
      } else {
        const p = this.otherPlayers[data.collectorId];
        if (p) {
          p.hp = data.collectorHp;
          p.maxHp = data.collectorMaxHp;
          if (data.itemType === 'shield') {
            p.hasShield = true;
            p.shieldHp = data.collectorShieldHp !== undefined ? data.collectorShieldHp : 20;
          }
          if (data.itemType === 'damage_boost') p.hasDamageBoost = true;
        }
      }
    };

    this.network.callbacks.onItemSpawned = (data) => {
      if (data.item) {
        this.items = this.items.filter((it) => it.id !== data.item.id);
        this.items.push(data.item);
      }
    };

    this.network.callbacks.onWeaponFired = (data) => {
      const shooter = this.otherPlayers[data.shooterId];
      if (shooter && shooter.dist !== undefined && shooter.dist < 800) {
        // Subtle distant cannon burst
      }
    };

    this.network.callbacks.onPlayerDamaged = (data) => {
      if (data.targetId === this.player.id) {
        this.player.hp = data.hp;
        if (data.shieldHp !== undefined) {
          this.player.shieldHp = data.shieldHp;
        }
        if (data.shieldAbsorbed && data.shieldAbsorbed > 0) {
          this.renderer.triggerFlash(90, 'rgba(56, 189, 248, 0.45)');
        } else {
          this.renderer.triggerShake(90, 5);
          this.renderer.triggerFlash(90, 'rgba(239, 68, 68, 0.45)');
        }
        this.audio.playHitTarget();
        if (this.player.hp < 30) {
          this.audio.playWarningSiren();
        }
      } else {
        const tgt = this.otherPlayers[data.targetId];
        if (tgt) {
          tgt.hp = data.hp;
          if (data.shieldHp !== undefined) tgt.shieldHp = data.shieldHp;
        }
      }
    };

    this.network.callbacks.onPlayerKilled = (data) => {
      const killerName = data.killerCallsign;
      const victimName = data.victimCallsign;
      this.addKillFeedEntry(killerName, victimName);

      // If local player scored the kill!
      if (data.killerId === this.player.id) {
        this.player.kills = (this.player.kills || 0) + 1;
        this.player.level = Math.min(5, data.killerLevel || (this.player.level + 1));
        this.player.maxHp = data.killerMaxHp || (100 + (this.player.level - 1) * 15);
        this.player.hp = data.killerHp || Math.min(this.player.maxHp, this.player.hp + 40);
        this.audio.playLevelUp();
        this.showKillConfirmedSplash(victimName, this.player.level, data.hpReward || 40);
      }

      // If local player was killed! (Reset level to LV.1)
      if (data.victimId === this.player.id) {
        this.player.isDead = true;
        this.player.hp = 0;
        this.player.level = 1;
        this.player.maxHp = 100;
        this.player.hasDamageBoost = false;
        this.player.damageBoostUntil = 0;
        this.audio.playExplosion();
        this.renderer.triggerShake(450, 15);
        this.renderer.triggerFlash(400, 'rgba(239, 68, 68, 0.8)');
        this.showDeathScreen(killerName, data.respawnIn || 3.0);
      } else {
        // Remote plane exploded
        const victim = this.otherPlayers[data.victimId];
        if (victim) {
          victim.isDead = true;
          victim.level = 1;
          victim.maxHp = 100;
          if (victim.screenX !== undefined && victim.inFront) {
            this.renderer.addExplosion(victim.screenX, victim.screenY, 1.8);
            this.audio.playExplosion();
          }
        }
      }
    };

    this.network.callbacks.onPlayerRespawned = (data) => {
      if (data.playerId === this.player.id) {
        // Local player respawned
        this.player.isDead = false;
        this.player.level = 1; // Resets to LV.1 on death!
        this.player.maxHp = 100;
        this.player.hp = 100;
        this.player.shieldHp = 0;
        this.player.hasShield = false;
        this.player.hasSpawnProtection = true;
        this.player.spawnProtectionUntil = performance.now() + 3000;
        this.player.hasDamageBoost = false;
        this.player.damageBoostUntil = 0;
        this.player.magAmmo = 150;
        this.player.reserveAmmo = 300;
        this.isReloading = false;
        this.reloadTimeRemaining = 0.0;
        this.player.x = data.x;
        this.player.y = data.y;
        this.player.alt = data.alt;
        this.player.heading = data.heading;
        this.player.pitch = 0;
        this.player.roll = 0;
        this.player.speed = 95;

        this.hideDeathScreen();
        this.audio.playRespawn();
      } else {
        // Remote player respawned
        const p = this.otherPlayers[data.playerId];
        if (p) {
          p.isDead = false;
          p.level = 1;
          p.maxHp = 100;
          p.hp = 100;
          p.shieldHp = 0;
          p.hasShield = false;
          p.hasSpawnProtection = true;
          p.x = data.x;
          p.y = data.y;
          p.targetX = data.x;
          p.targetY = data.y;
          p.alt = data.alt;
          p.heading = data.heading;
        }
      }
    };

    this.network.callbacks.onError = (msg) => {
      if (this.dom.lobbyErrorMsg) {
        this.dom.lobbyErrorMsg.textContent = msg;
        this.dom.lobbyErrorMsg.style.display = 'block';
      } else {
        alert(msg);
      }
      this.dom.btnJoin.disabled = false;
      this.dom.btnJoin.textContent = 'ENGAGE SORTIE (เข้าสู่สนามรบ)';
      if (this.dom.inputCallsign) {
        this.dom.inputCallsign.focus();
        this.dom.inputCallsign.select();
      }
    };

    this.network.callbacks.onDisconnect = () => {
      alert('Disconnected from Dogfight Server');
      location.reload();
    };
  }

  triggerReload() {
    if (this.isReloading) return;
    if (this.player.magAmmo >= this.player.maxMag) return; // Magazine already full
    if (this.player.reserveAmmo <= 0) {
      this.audio.playEmptyClick();
      return;
    }
    this.isReloading = true;
    this.reloadTimeRemaining = this.reloadDuration; // 5.0 seconds reload!
    this.audio.playReloadStart();
  }

  fireWeapon() {
    const now = performance.now();
    if (this.player.isDead || now - this.lastFireTime < this.fireRateMs) return;

    // 1. If currently reloading, cannot shoot (5 second reload lock)
    if (this.isReloading) {
      if (now - this.lastFireTime > 250) {
        this.audio.playEmptyClick();
        this.lastFireTime = now;
      }
      return;
    }

    // 2. If out of ammo in magazine, cannot shoot -> trigger reload
    if (this.player.magAmmo <= 0) {
      if (now - this.lastFireTime > 250) {
        this.audio.playEmptyClick();
        this.lastFireTime = now;
      }
      if (this.player.reserveAmmo > 0) {
        this.triggerReload();
      }
      return;
    }

    this.lastFireTime = now;
    // Consume 1 round of ammo
    this.player.magAmmo -= 1;

    this.audio.playCannonFire();
    this.renderer.triggerShake(45, 2.0);
    this.network.sendFire();

    // If magazine just emptied and we have reserve ammo, auto initiate 5s reload!
    if (this.player.magAmmo <= 0 && this.player.reserveAmmo > 0) {
      this.triggerReload();
    }

    let hitTarget = null;
    let hitScreenX = 480;
    let hitScreenY = 270;

    // Case 1: Locked target engagement (strictly within <= 100m) - Guaranteed Auto-Aim Hit!
    if (
      this.lockedTarget &&
      !this.lockedTarget.isDead &&
      !this.lockedTarget.hasSpawnProtection &&
      this.lockedTarget.dist <= 100
    ) {
      hitTarget = this.lockedTarget;
      hitScreenX = this.lockedTarget.screenX !== undefined ? this.lockedTarget.screenX : 480;
      hitScreenY = this.lockedTarget.screenY !== undefined ? this.lockedTarget.screenY : 270;
    } else {
      // Case 2: Manual boresight & spray firing (> 100m up to 500m) - "ยิงสาด ถ้าโดนก็ได้ ไม่ได้ล็อค"
      const hRad = (this.player.heading * Math.PI) / 180;
      const pRad = ((this.player.pitch || 0) * Math.PI) / 180;
      const rRad = ((this.player.roll || 0) * Math.PI) / 180;

      const sinH = Math.sin(hRad), cosH = Math.cos(hRad);
      const sinP = Math.sin(pRad), cosP = Math.cos(pRad);
      const sinR = Math.sin(rRad), cosR = Math.cos(rRad);

      const Fx = sinH * cosP, Fy = cosH * cosP, Fz = sinP;
      const Rx = cosH * cosR + sinH * sinP * sinR;
      const Ry = -sinH * cosR + cosH * sinP * sinR;
      const Rz = -cosP * sinR;
      const Ux = cosH * sinR - sinH * sinP * cosR;
      const Uy = -sinH * sinR - cosH * sinP * cosR;
      const Uz = cosP * cosR;

      let bestScore = Infinity;
      const otherList = Object.values(this.otherPlayers);

      for (let p of otherList) {
        if (p.isDead || p.hasSpawnProtection) continue;

        const dx = p.x - this.player.x;
        const dy = p.y - this.player.y;
        const dz = (p.alt || 50) - (this.player.alt || 50);
        const dist = Math.hypot(dx, dy);

        // Effective gun range is strictly < 500 meters
        if (dist >= 500) continue;

        const relZ = dx * Fx + dy * Fy + dz * Fz;
        if (relZ <= 10) continue; // Behind or too close

        const relX = dx * Rx + dy * Ry + dz * Rz;
        const relY = dx * Ux + dy * Uy + dz * Uz;

        const k = 620 / Math.max(20, relZ);
        const sx = 480 + relX * k;
        const sy = 270 - relY * k;

        if (sx < -60 || sx > 1020 || sy < -60 || sy > 600) continue;

        const distToCrosshair = Math.hypot(480 - sx, 270 - sy);

        // Boresight bullet spray cone (> 100m manual aiming)
        const hitRadius = Math.max(50, 90 * (1 - dist / 550));

        const isHit = distToCrosshair <= hitRadius;
        if (isHit && distToCrosshair < bestScore) {
          bestScore = distToCrosshair;
          hitTarget = p;
          hitScreenX = sx;
          hitScreenY = sy;
        }
      }
    }

    if (hitTarget) {
      // Direct tracer hit with subtle machine gun spread
      const hitScatter = 8;
      this.renderer.addTracer(hitScreenX + (Math.random() - 0.5) * hitScatter, hitScreenY + (Math.random() - 0.5) * hitScatter);
      this.renderer.triggerHitMarker(160);
      this.audio.playHitTarget();
      this.renderer.addExplosion(hitScreenX, hitScreenY, 0.75);
      this.renderer.triggerFlash(70, 'rgba(255, 176, 46, 0.35)');
      const dmg = this.player.hasDamageBoost ? 7.2 : 3.6; // 20% cannon damage, allowing evasion & dogfight escapes
      this.network.sendHit(hitTarget.id, dmg);
    } else {
      // Manual spray firing tracers ("ยิงสาด")
      const spraySpread = 38;
      const sprayX = 480 + (Math.random() - 0.5) * spraySpread;
      const sprayY = 270 + (Math.random() - 0.5) * spraySpread;
      this.renderer.addTracer(sprayX, sprayY);
    }
  }

  showDeathScreen(killerCallsign, seconds) {
    if (!this.dom.deathOverlay) return;
    this.dom.deathKillerName.textContent = killerCallsign;
    this.dom.deathOverlay.style.display = 'flex';

    if (this.deathTimerInterval) {
      clearInterval(this.deathTimerInterval);
    }

    let rem = Math.ceil(seconds);
    this.dom.respawnCountdown.textContent = rem;
    this.deathTimerInterval = setInterval(() => {
      rem--;
      if (rem >= 0) {
        this.dom.respawnCountdown.textContent = rem;
      }
      if (rem <= 0) {
        clearInterval(this.deathTimerInterval);
        this.deathTimerInterval = null;

        // If local player is still dead after countdown finishes, request respawn
        if (this.player.isDead) {
          this.network.sendRespawnRequest();

          // Client-side failsafe watchdog: if server response delayed > 1.5s, self-restore safely at map edge
          setTimeout(() => {
            if (this.player.isDead) {
              console.warn('[Failsafe] Auto-respawning local player safely at map perimeter');
              this.player.isDead = false;
              this.player.level = 1;
              this.player.hp = 100;
              this.player.maxHp = 100;
              const fAngle = Math.random() * 2 * Math.PI;
              const fDist = 1000 + Math.random() * 90;
              this.player.x = fDist * Math.cos(fAngle);
              this.player.y = fDist * Math.sin(fAngle);
              this.player.alt = 60;
              this.player.heading = ((Math.atan2(-this.player.x, -this.player.y) * 180) / Math.PI + 360) % 360;
              this.player.pitch = 0;
              this.player.roll = 0;
              this.player.speed = 95;
              this.player.hasShield = true;
              this.player.shieldUntil = performance.now() + 3000;
              this.hideDeathScreen();
              this.audio.playRespawn();
            }
          }, 1500);
        }
      }
    }, 1000);
  }

  hideDeathScreen() {
    if (this.deathTimerInterval) {
      clearInterval(this.deathTimerInterval);
      this.deathTimerInterval = null;
    }
    if (this.dom.deathOverlay) {
      this.dom.deathOverlay.style.display = 'none';
    }
  }

  showKillConfirmedSplash(victimName, newLevel, hpGain) {
    const banner = document.createElement('div');
    banner.className = 'kill-splash-banner';
    const rankTitle = this.getRankTitle(newLevel);
    const lvlText = newLevel >= 5 ? `⭐ LV.5 ${rankTitle}` : `⭐ LEVEL UP! [LV.${newLevel} ${rankTitle}]`;
    banner.innerHTML = `
      <div style="font-size:17px; color:#38bdf8; font-weight:bold;">💥 KILL CONFIRMED • ${victimName}</div>
      <div style="font-size:13px; color:#10b981; margin-top:4px;">💚 REPAIR +${hpGain} HP • ${lvlText}</div>
    `;
    document.body.appendChild(banner);
    setTimeout(() => banner.remove(), 2600);
  }

  showPowerupSplash(title, desc) {
    const banner = document.createElement('div');
    banner.className = 'powerup-splash-banner';
    banner.innerHTML = `
      <div style="font-size:16px; font-weight:bold;">${title}</div>
      <div style="font-size:12px; color:#cbd5e1; margin-top:3px;">${desc}</div>
    `;
    document.body.appendChild(banner);
    setTimeout(() => banner.remove(), 2600);
  }

  getRankTitle(lvl) {
    if (lvl <= 1) return 'ROOKIE';
    if (lvl === 2) return 'FIGHTER';
    if (lvl === 3) return 'VETERAN';
    if (lvl === 4) return 'ACE';
    return 'MASTER ACE [MAX]';
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
      const maxHp = this.player.maxHp || 100;
      const pct = Math.max(0, Math.min(100, (this.player.hp / maxHp) * 100));
      this.dom.hudHpBar.style.width = `${pct}%`;
      this.dom.hudHpBar.className = pct > 50 ? 'hp-good' : (pct > 25 ? 'hp-warn' : 'hp-crit');
    }

    // Temporary Armor Overlay Bar
    if (this.dom.hudShieldBar) {
      if (this.player.shieldHp > 0) {
        const sPct = Math.min(100, (this.player.shieldHp / 20) * 100);
        this.dom.hudShieldBar.style.width = `${sPct}%`;
        this.dom.hudShieldBar.style.display = 'block';
      } else {
        this.dom.hudShieldBar.style.width = '0%';
        this.dom.hudShieldBar.style.display = 'none';
      }
    }

    if (this.dom.hudHpText) {
      if (this.player.shieldHp > 0) {
        this.dom.hudHpText.textContent = `${Math.round(this.player.hp)} / ${this.player.maxHp || 100} (+${this.player.shieldHp} 🛡️ เกราะ)`;
      } else {
        this.dom.hudHpText.textContent = `${Math.round(this.player.hp)} / ${this.player.maxHp || 100}`;
      }
    }
    if (this.dom.hudLevelBadge) {
      const rankTitle = this.getRankTitle(this.player.level || 1);
      this.dom.hudLevelBadge.textContent = `⭐ LV. ${this.player.level || 1} ${rankTitle}`;
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

    // Active Buff Badges (Shield & Damage Boost)
    if (this.dom.hudShieldBadge) {
      if (this.player.shieldHp > 0 && performance.now() < this.player.shieldUntil) {
        const sec = Math.max(0, Math.ceil((this.player.shieldUntil - performance.now()) / 1000));
        this.dom.hudShieldBadge.textContent = `🛡️ เกราะ +${this.player.shieldHp} (${sec}s)`;
        this.dom.hudShieldBadge.style.display = 'inline-block';
      } else if (performance.now() < this.player.spawnProtectionUntil) {
        const sec = Math.max(0, Math.ceil((this.player.spawnProtectionUntil - performance.now()) / 1000));
        this.dom.hudShieldBadge.textContent = `🛡️ SPAWN SHIELD (${sec}s)`;
        this.dom.hudShieldBadge.style.display = 'inline-block';
      } else {
        this.dom.hudShieldBadge.style.display = 'none';
      }
    }

    if (this.dom.hudDmgBadge) {
      if (this.player.hasDamageBoost) {
        const sec = Math.max(0, Math.ceil((this.player.damageBoostUntil - performance.now()) / 1000));
        this.dom.hudDmgBadge.textContent = `⚡ 2X DMG (${sec}s)`;
        this.dom.hudDmgBadge.style.display = 'inline-block';
      } else {
        this.dom.hudDmgBadge.style.display = 'none';
      }
    }

    // Ammo & Reload Status Update
    if (this.dom.hudMagAmmo && this.dom.hudResAmmo) {
      this.dom.hudMagAmmo.textContent = this.player.magAmmo;
      this.dom.hudResAmmo.textContent = this.player.reserveAmmo;
    }
    if (this.dom.hudReloadStatus) {
      if (this.isReloading) {
        this.dom.hudReloadStatus.style.display = 'inline-block';
        this.dom.hudReloadStatus.textContent = `🔄 RELOADING (${this.reloadTimeRemaining.toFixed(1)}s)`;
      } else if (this.player.magAmmo <= 0 && this.player.reserveAmmo <= 0) {
        this.dom.hudReloadStatus.style.display = 'inline-block';
        this.dom.hudReloadStatus.textContent = `⚠️ NO AMMO! COLLECT CRATES`;
      } else {
        this.dom.hudReloadStatus.style.display = 'none';
      }
    }
    if (this.dom.hudAmmoText) {
      if (this.player.magAmmo <= 0) {
        this.dom.hudAmmoText.className = 'ammo-empty';
      } else if (this.player.magAmmo <= 35) {
        this.dom.hudAmmoText.className = 'ammo-low';
      } else {
        this.dom.hudAmmoText.className = 'ammo-good';
      }
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
          level: this.player.level || 1,
          kills: this.player.kills,
          deaths: this.player.deaths,
          score: this.player.score,
          ping: this.network.ping,
          isMe: true,
        },
        ...Object.values(this.otherPlayers).map((p) => ({
          callsign: p.callsign,
          color: p.color,
          level: p.level || 1,
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
          <td class="num font-bold text-cyan">LV.${p.level}</td>
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

        // Process Reload Countdown (5.0 seconds reload)
        if (this.isReloading) {
          this.reloadTimeRemaining = Math.max(0, this.reloadTimeRemaining - dt);
          if (this.reloadTimeRemaining <= 0) {
            this.isReloading = false;
            const needed = this.player.maxMag - this.player.magAmmo;
            const take = Math.min(needed, this.player.reserveAmmo);
            this.player.magAmmo += take;
            this.player.reserveAmmo -= take;
            this.audio.playReloadComplete();
          }
        }

        // Flight Physics Update:
        // Authentic flight controls with enhanced agility:
        // S / Stick Back = +Pitch (Climb / 360° Loop)
        // W / Stick Forward = -Pitch (Dive / Invert)
        // D / Stick Right = +Roll (Bank Right)
        // A / Stick Left = -Roll (Bank Left)
        const controlSpeed = 80; // deg/sec (agile snappy response)
        this.player.pitch = (this.player.pitch + input.pitch * controlSpeed * dt + 360) % 360;
        this.player.roll = Math.max(-75, Math.min(75, this.player.roll + input.roll * controlSpeed * dt));

        // Banking turns heading (coordinated turn dynamics: ~85 deg/s at 20° bank)
        const turnRate = (this.player.roll / 20) * 85;
        this.player.heading = (this.player.heading + turnRate * dt + 360) % 360;

        // Airspeed energy dynamics up to 300 KNOTS ("ความเร็วให้แม็กที่ 300 knott"):
        const pitchRad = (this.player.pitch * Math.PI) / 180;
        const sinPitch = Math.sin(pitchRad);
        const cosPitch = Math.cos(pitchRad);

        // Base throttle speed (throttle 0.65 to 1.55 gives base speeds ~125 to 302 kts)
        const baseThrottleSpeed = 195 * input.throttle;

        // Climbing (sinPitch > 0): bleeds speed down by up to 45 kts
        // Diving (sinPitch < 0): accelerates speed up by up to 65 kts
        const gravityBias = -sinPitch * (sinPitch > 0 ? 45.0 : 65.0);
        const dynamicTargetSpeed = Math.max(65, Math.min(305, baseThrottleSpeed + gravityBias));

        const accelFactor = sinPitch < -0.2 ? 6.5 : 4.5;
        this.player.speed += (dynamicTargetSpeed - this.player.speed) * accelFactor * dt;
        this.player.speed = Math.max(60, Math.min(300, this.player.speed)); // MAX 300 KNOTS!
        this.audio.updateEngineRPM(this.player.speed);

        // Altitude physics: climb rate proportional to sin(pitchRad)
        const speedMPS = this.player.speed * 0.52;
        const vertSpeedMPS = sinPitch * speedMPS * 0.60;
        this.player.alt = Math.max(8, Math.min(220, this.player.alt + vertSpeedMPS * dt)); // Expanded 220m ceiling!

        // World displacement
        const horizSpeedMPS = cosPitch * speedMPS;
        const headingRad = (this.player.heading * Math.PI) / 180;
        this.player.x += Math.sin(headingRad) * horizSpeedMPS * dt;
        this.player.y += Math.cos(headingRad) * horizSpeedMPS * dt;
        this.flightDistance += speedMPS * dt;

        // Check temporary shield armor expiry
        if (this.player.shieldHp > 0 && performance.now() > this.player.shieldUntil) {
          this.player.shieldHp = 0;
          this.player.hasShield = false;
        }

        // Check damage boost expiry
        if (this.player.hasDamageBoost && performance.now() > this.player.damageBoostUntil) {
          this.player.hasDamageBoost = false;
        }

        // Terrain Mountain Check & GPWS Proximity Warning
        const groundH = getTerrainHeight(this.player.x, this.player.y);
        const clearance = this.player.alt - groundH;

        // GPWS Forward Lookahead (120m ahead)
        const hRad = (this.player.heading * Math.PI) / 180;
        const lookX = this.player.x + Math.sin(hRad) * 120;
        const lookY = this.player.y + Math.cos(hRad) * 120;
        const aheadH = getTerrainHeight(lookX, lookY);

        if (aheadH > this.player.alt - 8 && aheadH > 25) {
          this.terrainWarning = true;
          this.terrainDist = Math.hypot(lookX - this.player.x, lookY - this.player.y);
          if (timestamp % 700 < 60) {
            this.audio.playTerrainWarning();
          }
        } else {
          this.terrainWarning = false;
        }

        // Mountain Crash Destruction (Spawn protected planes are immune)
        const isSpawnProtected = performance.now() < this.player.spawnProtectionUntil;
        if (clearance <= 0 && !this.player.isDead && !isSpawnProtected) {
          this.player.hp = 0;
          this.player.shieldHp = 0;
          this.player.isDead = true;
          this.player.level = 1;
          this.player.maxHp = 100;
          this.player.hasDamageBoost = false;
          this.player.damageBoostUntil = 0;
          this.audio.playExplosion();
          this.renderer.triggerShake(500, 20);
          this.renderer.triggerFlash(400, 'rgba(239, 68, 68, 0.85)');
          this.showDeathScreen('MOUNTAIN TERRAIN (ชนภูเขา)', 3.0);
          this.network.sendCrash('mountain');
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

      // Target Lock-On Detection: Strictly within <= 100 meters with Sticky Lock!
      let bestTarget = null;
      let minCrosshairDist = 120; // 120px acquisition zone matching compact lock box

      // 1. Sticky Lock: Retain currently locked target if still in front view and within <= 100m
      if (
        this.lockedTarget &&
        !this.lockedTarget.isDead &&
        !this.lockedTarget.hasSpawnProtection &&
        this.lockedTarget.dist <= 100 &&
        this.lockedTarget.inFront
      ) {
        const dCurrent = Math.hypot(480 - (this.lockedTarget.screenX || 480), 270 - (this.lockedTarget.screenY || 270));
        if (dCurrent < 220) {
          bestTarget = this.lockedTarget;
        }
      }

      // 2. If no target retained, acquire closest target in front within 120px crosshair radius and <= 100m
      if (!bestTarget) {
        for (let p of otherList) {
          p.isLocked = false;
          if (!p.isDead && !p.hasSpawnProtection && p.inFront && p.dist <= 100) {
            const dCenter = Math.hypot(480 - p.screenX, 270 - p.screenY);
            if (dCenter < minCrosshairDist) {
              minCrosshairDist = dCenter;
              bestTarget = p;
            }
          }
        }
      }

      for (let p of otherList) {
        p.isLocked = !!(bestTarget && p.id === bestTarget.id);
      }

      if (bestTarget) {
        bestTarget.isLocked = true;
        this.lockedTarget = bestTarget;
        if (!this.targetWasLocked) {
          this.audio.playLockOn();
        }
        this.targetWasLocked = true;

        // Predictive lead aim indicator
        const leadDist = Math.max(14, bestTarget.dist / 22);
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

        // Combat Airspace Boundary Tracking (Arena Radius = 1200m)
        const distFromCenter = Math.hypot(this.player.x, this.player.y);
        this.distFromCenter = distFromCenter;

        if (distFromCenter <= 950) {
          this.boundaryState = 'safe';
          this.boundaryTimeRemaining = 5.0;
        } else if (distFromCenter <= 1150) {
          this.boundaryState = 'caution';
          this.boundaryTimeRemaining = 5.0;
        } else {
          // Danger / Out-of-bounds Zone (> 1150m)
          this.boundaryState = 'danger';
          this.boundaryTimeRemaining = Math.max(0, this.boundaryTimeRemaining - dt);

          if (timestamp % 900 < 60) {
            this.audio.playWarningSiren();
          }

          // Crossing 1200m perimeter: Autopilot smooth turn towards battlefield center (0, 0)
          if (distFromCenter >= 1200) {
            const targetH = (Math.atan2(-this.player.x, -this.player.y) * 180) / Math.PI;
            const diffH = ((targetH - this.player.heading + 540) % 360) - 180;
            const autoRoll = Math.sign(diffH) * 45;
            this.player.roll += (autoRoll - this.player.roll) * 3.5 * dt;

            // Health penalty if staying outside > 5 seconds
            if (this.boundaryTimeRemaining <= 0) {
              this.player.hp = Math.max(1, this.player.hp - 12 * dt);
            }
          }
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
            items: this.items,
            isFiring: input.isFiring,
            lockedTarget: this.lockedTarget,
            leadPoint: this.leadPoint,
            magAmmo: this.player.magAmmo,
            reserveAmmo: this.player.reserveAmmo,
            isReloading: this.isReloading,
            reloadTimeRem: this.reloadTimeRemaining,
            distFromCenter: this.distFromCenter,
            boundaryState: this.boundaryState,
            boundaryTimeRem: this.boundaryTimeRemaining,
            terrainWarning: this.terrainWarning,
            terrainDist: this.terrainDist,
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
