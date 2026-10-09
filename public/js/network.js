/**
 * Sky Ace: Dogfight Arena - Real-time WebSocket Client Manager
 * Handles room connection, 25 Hz state sync, combat hits, death & respawn events.
 */
class DogfightNetworkManager {
  constructor() {
    this.ws = null;
    this.isConnected = false;
    this.playerId = null;
    this.roomCode = null;
    this.ping = 0;
    this.pingInterval = null;

    // Callbacks
    this.callbacks = {
      onJoined: null,
      onPlayerJoined: null,
      onPlayerLeft: null,
      onWorldUpdate: null,
      onWeaponFired: null,
      onPlayerDamaged: null,
      onPlayerKilled: null,
      onPlayerRespawned: null,
      onItemCollected: null,
      onItemSpawned: null,
      onChatMessage: null,
      onError: null,
      onDisconnect: null,
    };
  }

  connect(roomCode, callsign, color) {
    return new Promise((resolve, reject) => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;

      try {
        this.ws = new WebSocket(wsUrl);
      } catch (e) {
        console.error('[Network] Connection failed:', e);
        if (this.callbacks.onError) this.callbacks.onError('Cannot connect to server');
        reject(e);
        return;
      }

      this.ws.onopen = () => {
        this.isConnected = true;
        console.log('[Network] Connected to game server');

        // Send Join Message
        this.send({
          type: 'join',
          room: roomCode,
          callsign: callsign,
          color: color,
        });

        // Start ping measurement loop
        this.startPingLoop();
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const data = jsonParse(event.data);
          this.handleMessage(data);
        } catch (err) {
          console.warn('[Network] Invalid packet:', err);
        }
      };

      this.ws.onerror = (err) => {
        console.error('[Network] WebSocket error:', err);
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        clearInterval(this.pingInterval);
        console.log('[Network] Disconnected from game server');
        if (this.callbacks.onDisconnect) this.callbacks.onDisconnect();
      };
    });
  }

  startPingLoop() {
    clearInterval(this.pingInterval);
    this.pingInterval = setInterval(() => {
      if (this.isConnected) {
        this.send({
          type: 'ping',
          clientTime: performance.now(),
        });
      }
    }, 2000);
  }

  send(payload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  sendFlightState(state) {
    this.send({
      type: 'state',
      x: state.x,
      y: state.y,
      alt: state.alt,
      heading: state.heading,
      pitch: state.pitch,
      roll: state.roll,
      speed: state.speed,
    });
  }

  sendFire() {
    this.send({ type: 'fire' });
  }

  sendHit(targetId, damage = 12) {
    this.send({
      type: 'hit',
      targetId: targetId,
      damage: damage,
    });
  }

  sendChat(text) {
    this.send({
      type: 'chat',
      text: text,
    });
  }

  handleMessage(msg) {
    if (!msg || !msg.type) return;

    switch (msg.type) {
      case 'pong':
        if (msg.clientTime) {
          this.ping = Math.round(performance.now() - msg.clientTime);
        }
        break;

      case 'joined':
        this.playerId = msg.playerId;
        this.roomCode = msg.room;
        if (this.callbacks.onJoined) this.callbacks.onJoined(msg);
        break;

      case 'error':
        if (this.callbacks.onError) this.callbacks.onError(msg.message);
        break;

      case 'player_joined':
        if (this.callbacks.onPlayerJoined) this.callbacks.onPlayerJoined(msg.player);
        break;

      case 'player_left':
        if (this.callbacks.onPlayerLeft) this.callbacks.onPlayerLeft(msg.playerId, msg.callsign);
        break;

      case 'world_update':
        if (this.callbacks.onWorldUpdate) this.callbacks.onWorldUpdate(msg.players, msg.items);
        break;

      case 'item_collected':
        if (this.callbacks.onItemCollected) this.callbacks.onItemCollected(msg);
        break;

      case 'item_spawned':
        if (this.callbacks.onItemSpawned) this.callbacks.onItemSpawned(msg);
        break;

      case 'weapon_fired':
        if (this.callbacks.onWeaponFired) this.callbacks.onWeaponFired(msg);
        break;

      case 'player_damaged':
        if (this.callbacks.onPlayerDamaged) this.callbacks.onPlayerDamaged(msg);
        break;

      case 'player_killed':
        if (this.callbacks.onPlayerKilled) this.callbacks.onPlayerKilled(msg);
        break;

      case 'player_respawned':
        if (this.callbacks.onPlayerRespawned) this.callbacks.onPlayerRespawned(msg);
        break;

      case 'chat_message':
        if (this.callbacks.onChatMessage) this.callbacks.onChatMessage(msg);
        break;
    }
  }
}

function jsonParse(str) {
  return JSON.parse(str);
}

window.DogfightNetwork = new DogfightNetworkManager();
