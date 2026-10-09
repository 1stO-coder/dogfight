#!/usr/bin/env python3
"""
Sky Ace: Dogfight Arena - Multiplayer Server (Python 3.9+)
Unified HTTP static server + WebSocket game engine on a single port.
Supports up to 10 players per room, 25 Hz state sync, damage validation,
death/respawn cycles, and live leaderboard.
"""

import asyncio
import json
import mimetypes
import os
import random
import time
from typing import Dict, Set

import websockets
from websockets import Headers, Response

PORT = int(os.environ.get("PORT", 8088))
HOST = "0.0.0.0"
BASE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public")

# MIME types
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("image/svg+xml", ".svg")


class Player:
    def __init__(self, player_id: str, callsign: str, color: str, ws):
        self.id = player_id
        self.callsign = callsign[:16]
        self.color = color
        self.ws = ws

        # Flight state
        self.x = (random.random() - 0.5) * 800
        self.y = (random.random() - 0.5) * 800
        self.alt = 50.0  # 0 to 100 cruising level
        self.heading = random.random() * 360.0
        self.pitch = 0.0
        self.roll = 0.0
        self.speed = 95.0

        # Combat state
        self.max_hp = 100
        self.hp = 100
        self.is_dead = False
        self.respawn_at = 0.0
        self.shield_until = time.time() + 3.0  # 3s shield on initial join
        self.kills = 0
        self.deaths = 0
        self.score = 0
        self.ping = 0
        self.last_seen = time.time()

    def to_dict(self):
        now = time.time()
        return {
            "id": self.id,
            "callsign": self.callsign,
            "color": self.color,
            "x": round(self.x, 1),
            "y": round(self.y, 1),
            "alt": round(self.alt, 1),
            "heading": round(self.heading, 1),
            "pitch": round(self.pitch, 1),
            "roll": round(self.roll, 1),
            "speed": round(self.speed, 1),
            "hp": self.hp,
            "maxHp": self.max_hp,
            "isDead": self.is_dead,
            "hasShield": now < self.shield_until,
            "shieldRem": max(0.0, round(self.shield_until - now, 1)),
            "kills": self.kills,
            "deaths": self.deaths,
            "score": self.score,
            "ping": self.ping,
        }


class Room:
    def __init__(self, code: str):
        self.code = code
        self.players: Dict[str, Player] = {}
        self.max_players = 10
        self.created_at = time.time()

    def add_player(self, player: Player) -> bool:
        if len(self.players) >= self.max_players:
            return False
        self.players[player.id] = player
        return True

    def remove_player(self, player_id: str):
        if player_id in self.players:
            del self.players[player_id]

    async def broadcast(self, message: dict, exclude_id: str = None):
        msg_str = json.dumps(message)
        dead_conns = []
        for pid, p in self.players.items():
            if exclude_id and pid == exclude_id:
                continue
            try:
                await p.ws.send(msg_str)
            except Exception:
                dead_conns.append(pid)
        for pid in dead_conns:
            self.remove_player(pid)


class GameServer:
    def __init__(self):
        self.rooms: Dict[str, Room] = {}
        self.conn_to_room: Dict[websockets.ServerConnection, str] = {}
        self.conn_to_pid: Dict[websockets.ServerConnection, str] = {}

    def get_or_create_room(self, code: str) -> Room:
        code = code.strip().upper()[:8]
        if code not in self.rooms:
            self.rooms[code] = Room(code)
            print(f"[Room] Created room {code}")
        return self.rooms[code]

    async def handle_websocket(self, websocket: websockets.ServerConnection):
        player_id = f"ace_{random.randint(1000, 9999)}"
        current_room: Room = None

        try:
            async for raw_message in websocket:
                try:
                    data = json.loads(raw_message)
                except Exception:
                    continue

                msg_type = data.get("type")

                # 1. Ping / Pong
                if msg_type == "ping":
                    c_time = data.get("clientTime", 0)
                    await websocket.send(
                        json.dumps(
                            {
                                "type": "pong",
                                "clientTime": c_time,
                                "serverTime": round(time.time() * 1000),
                            }
                        )
                    )
                    if current_room and player_id in current_room.players:
                        p = current_room.players[player_id]
                        p.ping = max(
                            1, int(time.time() * 1000 - c_time)
                        ) if c_time else p.ping
                    continue

                # 2. Join Room
                if msg_type == "join":
                    room_code = (data.get("room") or "SKY-1").strip().upper()
                    callsign = (data.get("callsign") or f"Pilot-{player_id[-3:]}").strip()
                    color = data.get("color") or "#38bdf8"

                    current_room = self.get_or_create_room(room_code)
                    if len(current_room.players) >= current_room.max_players:
                        await websocket.send(
                            json.dumps(
                                {
                                    "type": "error",
                                    "message": f"ห้อง {room_code} เต็มแล้ว (จำกัดไม่เกิน 10 คน)",
                                }
                            )
                        )
                        continue

                    player = Player(player_id, callsign, color, websocket)
                    current_room.add_player(player)
                    self.conn_to_room[websocket] = room_code
                    self.conn_to_pid[websocket] = player_id

                    # Ack to joining player
                    all_players_data = [
                        p.to_dict() for p in current_room.players.values()
                    ]
                    await websocket.send(
                        json.dumps(
                            {
                                "type": "joined",
                                "playerId": player_id,
                                "room": room_code,
                                "players": all_players_data,
                            }
                        )
                    )

                    # Notify others
                    await current_room.broadcast(
                        {"type": "player_joined", "player": player.to_dict()},
                        exclude_id=player_id,
                    )
                    print(
                        f"[Join] {callsign} ({player_id}) joined room {room_code} ({len(current_room.players)}/10)"
                    )
                    continue

                # Player must have joined
                if not current_room or player_id not in current_room.players:
                    continue

                player = current_room.players[player_id]

                # 3. Flight State Update
                if msg_type == "state":
                    if not player.is_dead:
                        player.x = float(data.get("x", player.x))
                        player.y = float(data.get("y", player.y))
                        player.alt = float(data.get("alt", player.alt))
                        player.heading = float(data.get("heading", player.heading))
                        player.pitch = float(data.get("pitch", player.pitch))
                        player.roll = float(data.get("roll", player.roll))
                        player.speed = float(data.get("speed", player.speed))
                        player.last_seen = time.time()
                    continue

                # 4. Fire Weapon
                if msg_type == "fire":
                    if not player.is_dead:
                        await current_room.broadcast(
                            {
                                "type": "weapon_fired",
                                "shooterId": player_id,
                                "x": player.x,
                                "y": player.y,
                                "alt": player.alt,
                                "heading": player.heading,
                                "pitch": player.pitch,
                            },
                            exclude_id=player_id,
                        )
                    continue

                # 5. Hit Detection & Damage Validation
                if msg_type == "hit":
                    target_id = data.get("targetId")
                    damage = int(data.get("damage", 12))
                    if (
                        target_id
                        and target_id in current_room.players
                        and not player.is_dead
                    ):
                        target = current_room.players[target_id]
                        now = time.time()
                        # Cannot damage dead player or shielded player
                        if not target.is_dead and now > target.shield_until:
                            target.hp = max(0, target.hp - damage)

                            # Notify room of damage
                            await current_room.broadcast(
                                {
                                    "type": "player_damaged",
                                    "targetId": target_id,
                                    "hp": target.hp,
                                    "damage": damage,
                                    "attackerId": player_id,
                                }
                            )

                            # Check for Kill
                            if target.hp <= 0 and not target.is_dead:
                                target.is_dead = True
                                target.respawn_at = now + 3.0  # 3 seconds countdown
                                player.kills += 1
                                player.score += 100
                                target.deaths += 1

                                await current_room.broadcast(
                                    {
                                        "type": "player_killed",
                                        "victimId": target_id,
                                        "victimCallsign": target.callsign,
                                        "killerId": player_id,
                                        "killerCallsign": player.callsign,
                                        "respawnIn": 3.0,
                                    }
                                )
                                print(
                                    f"[Kill] {player.callsign} shot down {target.callsign} in {current_room.code}"
                                )
                    continue

                # 6. Quick Chat / Radio
                if msg_type == "chat":
                    text = str(data.get("text", ""))[:60]
                    if text.strip():
                        await current_room.broadcast(
                            {
                                "type": "chat_message",
                                "senderId": player_id,
                                "sender": player.callsign,
                                "color": player.color,
                                "text": text,
                            }
                        )
                    continue

        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            if current_room and player_id in current_room.players:
                p_left = current_room.players[player_id]
                current_room.remove_player(player_id)
                print(
                    f"[Leave] {p_left.callsign} left room {current_room.code} ({len(current_room.players)} left)"
                )
                await current_room.broadcast(
                    {
                        "type": "player_left",
                        "playerId": player_id,
                        "callsign": p_left.callsign,
                    }
                )
                if len(current_room.players) == 0:
                    del self.rooms[current_room.code]
                    print(f"[Room] Closed empty room {current_room.code}")

    async def world_tick_loop(self):
        """25 Hz tick loop for real-time multiplayer dogfight synchronization"""
        while True:
            await asyncio.sleep(0.04)  # 25 Hz
            now = time.time()

            for room in list(self.rooms.values()):
                if not room.players:
                    continue

                # Process Respawn Timers
                for p in list(room.players.values()):
                    if p.is_dead and now >= p.respawn_at and p.respawn_at > 0:
                        # Respawn player at safe coordinates
                        p.is_dead = False
                        p.hp = 100
                        p.respawn_at = 0.0
                        p.shield_until = now + 3.0  # 3s invulnerability shield
                        # Random safe distance away from combat center
                        angle = random.random() * 2 * 3.14159
                        dist = 600 + random.random() * 300
                        p.x = dist * 0.8 * (1 if random.random() > 0.5 else -1)
                        p.y = dist * 0.8 * (1 if random.random() > 0.5 else -1)
                        p.alt = 50.0 + (random.random() - 0.5) * 15.0
                        p.heading = random.random() * 360.0

                        asyncio.create_task(
                            room.broadcast(
                                {
                                    "type": "player_respawned",
                                    "playerId": p.id,
                                    "x": p.x,
                                    "y": p.y,
                                    "alt": p.alt,
                                    "heading": p.heading,
                                    "hp": p.hp,
                                    "shieldDuration": 3.0,
                                }
                            )
                        )

                # Broadcast World Update
                players_payload = [p.to_dict() for p in list(room.players.values())]
                update_msg = json.dumps(
                    {"type": "world_update", "players": players_payload}
                )

                dead_conns = []
                for p in list(room.players.values()):
                    try:
                        await p.ws.send(update_msg)
                    except Exception:
                        dead_conns.append(p.id)
                for pid in dead_conns:
                    room.remove_player(pid)


game_server = GameServer()


async def process_http_or_ws(connection, request):
    """Handle HTTP requests for static web client or pass-through for WebSocket"""
    # If client requested WebSocket upgrade, pass-through to websocket handler
    if request.headers.get("Upgrade", "").lower() == "websocket":
        return None

    # Handle HTTP GET
    path = request.path.split("?")[0]
    if path == "/" or not path:
        path = "/index.html"

    # Sanitize path to prevent directory traversal
    clean_path = os.path.normpath(path.lstrip("/"))
    file_path = os.path.join(BASE_DIR, clean_path)

    # Check if file exists within BASE_DIR
    if not file_path.startswith(BASE_DIR) or not os.path.isfile(file_path):
        return Response(
            404,
            "Not Found",
            Headers([("Content-Type", "text/plain")]),
            b"404 Not Found",
        )

    content_type, _ = mimetypes.guess_type(file_path)
    if not content_type:
        content_type = "application/octet-stream"

    try:
        with open(file_path, "rb") as f:
            body = f.read()
        return Response(
            200,
            "OK",
            Headers(
                [
                    ("Content-Type", content_type),
                    ("Cache-Control", "no-cache"),
                    ("Content-Length", str(len(body))),
                ]
            ),
            body,
        )
    except Exception as e:
        return Response(
            500,
            "Internal Error",
            Headers([("Content-Type", "text/plain")]),
            f"Error: {e}".encode("utf-8"),
        )


async def main():
    global PORT
    # Start 25 Hz world update loop
    asyncio.create_task(game_server.world_tick_loop())

    # Try binding to PORT or search upwards
    server = None
    for attempt in range(10):
        try:
            server = await websockets.serve(
                game_server.handle_websocket,
                HOST,
                PORT,
                process_request=process_http_or_ws,
            )
            break
        except OSError as e:
            if e.errno == 48: # Address in use
                PORT += 1
            else:
                raise e

    print("=" * 60)
    print(" ✈️  SKY ACE: DOGFIGHT ARENA - MULTIPLAYER SERVER")
    print(f" 🌐 Running on: http://localhost:{PORT}")
    print(f" 🎮 Local Network: http://0.0.0.0:{PORT}")
    print(" 📡 WebSocket & HTTP on unified port.")
    print("=" * 60)

    await asyncio.Future()  # run forever


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[Server] Shutdown requested. Bye!")
