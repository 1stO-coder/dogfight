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


import math
from typing import Optional

# Shared Battlefield Terrain Mountains (Must fly around/above!)
MOUNTAINS = [
    # 4 Outer Perimeter Peaks
    {"name": "MT. TITAN", "x": 0.0, "y": 780.0, "r": 260.0, "h": 140.0},
    {"name": "SOUTH CRAG", "x": 0.0, "y": -780.0, "r": 260.0, "h": 135.0},
    {"name": "TWIN PEAKS", "x": 780.0, "y": 0.0, "r": 270.0, "h": 140.0},
    {"name": "IRON CLIFF", "x": -780.0, "y": 0.0, "r": 270.0, "h": 140.0},
    # 4 Mid-Field Tactical Peaks (Dogfight engagement zone, 88m - 95m elevation!)
    {"name": "EAGLE'S PILLAR", "x": 380.0, "y": 380.0, "r": 180.0, "h": 95.0},
    {"name": "DRAGON'S TOOTH", "x": -380.0, "y": 360.0, "r": 170.0, "h": 90.0},
    {"name": "OBSIDIAN RIDGE", "x": 360.0, "y": -380.0, "r": 180.0, "h": 92.0},
    {"name": "VIPER PEAK", "x": -360.0, "y": -380.0, "r": 170.0, "h": 88.0},
]

def get_terrain_height(x: float, y: float) -> float:
    """Calculate highest mountain elevation at (x, y) coordinates"""
    max_h = 0.0
    for m in MOUNTAINS:
        dist = math.hypot(x - m["x"], y - m["y"])
        if dist < m["r"]:
            h_here = m["h"] * (1.0 - (dist / m["r"]) ** 1.1)
            if h_here > max_h:
                max_h = h_here
    return max_h


class Item:
    def __init__(self, item_id: str, item_type: str, x: float, y: float, alt: float):
        self.id = item_id
        self.type = item_type  # 'medkit' | 'damage_boost' | 'shield'
        self.x = x
        self.y = y
        self.alt = alt
        self.spawn_time = time.time()

    def to_dict(self):
        return {
            "id": self.id,
            "type": self.type,
            "x": round(self.x, 1),
            "y": round(self.y, 1),
            "alt": round(self.alt, 1),
        }


class Player:
    def __init__(self, player_id: str, callsign: str, color: str, ws):
        self.id = player_id
        self.callsign = callsign[:16]
        self.color = color
        self.ws = ws

        # Flight state: spawn inside combat arena (radius 350 - 750m)
        angle = random.random() * 2 * math.pi
        dist = 350 + random.random() * 400
        self.x = dist * math.cos(angle)
        self.y = dist * math.sin(angle)
        self.alt = 50.0  # 0 to 100 cruising level
        # Face toward center battlefield
        self.heading = (math.degrees(math.atan2(-self.x, -self.y)) + 360) % 360
        self.pitch = 0.0
        self.roll = 0.0
        self.speed = 95.0

        # Combat & Progression state
        self.level = 1
        self.max_hp = 100
        self.hp = 100
        self.is_dead = False
        self.respawn_at = 0.0
        self.shield_until = time.time() + 3.0  # 3s shield on initial join
        self.damage_boost_until = 0.0  # 2x cannon damage buff (lasts 120s = 2 min)
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
            "level": self.level,
            "hp": self.hp,
            "maxHp": self.max_hp,
            "isDead": self.is_dead,
            "hasShield": now < self.shield_until,
            "shieldRem": max(0.0, round(self.shield_until - now, 1)),
            "hasDamageBoost": now < self.damage_boost_until,
            "damageBoostRem": max(0.0, round(self.damage_boost_until - now, 1)),
            "kills": self.kills,
            "deaths": self.deaths,
            "score": self.score,
            "ping": self.ping,
        }


class Room:
    def __init__(self, code: str):
        self.code = code
        self.players: Dict[str, Player] = {}
        self.items: Dict[str, Item] = {}
        self.max_players = 10
        self.created_at = time.time()
        self.next_item_id = 1
        self.spawn_initial_items()

    def spawn_initial_items(self):
        types = ["medkit", "medkit", "damage_boost", "damage_boost", "shield", "shield"]
        for t in types:
            self.spawn_random_item(t)

    def spawn_random_item(self, item_type: str = None) -> Item:
        if not item_type:
            item_type = random.choice(["medkit", "damage_boost", "shield"])

        for _ in range(25):
            angle = random.random() * 2 * math.pi
            dist = 220.0 + random.random() * 700.0
            x = dist * math.cos(angle)
            y = dist * math.sin(angle)
            ground_h = get_terrain_height(x, y)
            alt = max(ground_h + 20.0, 35.0 + random.random() * 45.0)
            if alt <= 90.0:
                break

        item_id = f"item_{self.next_item_id}"
        self.next_item_id += 1
        item = Item(item_id, item_type, x, y, alt)
        self.items[item_id] = item
        return item

    def check_item_pickup(self, player: Player) -> Optional[Item]:
        if player.is_dead:
            return None
        now = time.time()
        for item_id, item in list(self.items.items()):
            dx = player.x - item.x
            dy = player.y - item.y
            d_alt = player.alt - item.alt
            dist_3d = math.sqrt(dx * dx + dy * dy + d_alt * d_alt)
            if dist_3d <= 38.0:
                del self.items[item_id]
                # Apply powerup effect (2 minutes = 120.0s for buffs!)
                if item.type == "medkit":
                    player.hp = min(player.max_hp, player.hp + 50)
                elif item.type == "damage_boost":
                    player.damage_boost_until = now + 120.0  # 2 minutes
                elif item.type == "shield":
                    player.shield_until = max(player.shield_until, now + 120.0)  # 2 minutes
                return item
        return None

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

                # 2. Join Room (Single shared room ARENA, unique callsign check)
                if msg_type == "join":
                    room_code = "ARENA" # Standard single shared arena
                    callsign = (data.get("callsign") or f"Pilot-{player_id[-3:]}").strip()
                    color = data.get("color") or "#38bdf8"

                    current_room = self.get_or_create_room(room_code)

                    # Check for duplicate callsign in room (case-insensitive)
                    is_duplicate = False
                    for existing_p in current_room.players.values():
                        if existing_p.callsign.lower() == callsign.lower():
                            is_duplicate = True
                            break

                    if is_duplicate:
                        await websocket.send(
                            json.dumps(
                                {
                                    "type": "error",
                                    "message": f"ชื่อ \"{callsign}\" มีนักบินท่านอื่นใช้อยู่แล้ว กรุณาตั้งชื่อใหม่",
                                }
                            )
                        )
                        continue

                    if len(current_room.players) >= current_room.max_players:
                        await websocket.send(
                            json.dumps(
                                {
                                    "type": "error",
                                    "message": "ห้องสมรภูมิเต็มแล้ว (จำกัดไม่เกิน 10 คน)",
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
                    all_items_data = [
                        it.to_dict() for it in current_room.items.values()
                    ]
                    await websocket.send(
                        json.dumps(
                            {
                                "type": "joined",
                                "playerId": player_id,
                                "room": room_code,
                                "players": all_players_data,
                                "items": all_items_data,
                            }
                        )
                    )

                    # Notify others
                    await current_room.broadcast(
                        {"type": "player_joined", "player": player.to_dict()},
                        exclude_id=player_id,
                    )
                    print(
                        f"[Join] {callsign} ({player_id}) joined arena ({len(current_room.players)}/10)"
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

                        # Map Boundary Clamp (Limit radius to 1300m)
                        cur_dist = math.hypot(player.x, player.y)
                        if cur_dist > 1300.0:
                            scale = 1300.0 / cur_dist
                            player.x *= scale
                            player.y *= scale

                        # Mountain Terrain Collision Check
                        ground_h = get_terrain_height(player.x, player.y)
                        if player.alt <= ground_h and not player.is_dead:
                            now = time.time()
                            player.hp = 0
                            player.is_dead = True
                            player.respawn_at = now + 3.0
                            player.deaths += 1
                            # Reset level to 1 on death!
                            player.level = 1
                            player.max_hp = 100
                            player.damage_boost_until = 0.0

                            await current_room.broadcast(
                                {
                                    "type": "player_killed",
                                    "victimId": player_id,
                                    "victimCallsign": player.callsign,
                                    "victimLevel": 1,
                                    "killerId": "terrain",
                                    "killerCallsign": "MOUNTAIN TERRAIN",
                                    "killerLevel": 0,
                                    "killerHp": 0,
                                    "killerMaxHp": 100,
                                    "hpReward": 0,
                                    "respawnIn": 3.0,
                                }
                            )
                            print(f"[Crash] {player.callsign} crashed into mountain (Reset to Lv.1)")

                        # Collectible Item Pickup Check
                        picked_item = current_room.check_item_pickup(player)
                        if picked_item:
                            now = time.time()
                            await current_room.broadcast(
                                {
                                    "type": "item_collected",
                                    "itemId": picked_item.id,
                                    "itemType": picked_item.type,
                                    "collectorId": player_id,
                                    "collectorCallsign": player.callsign,
                                    "collectorHp": player.hp,
                                    "collectorMaxHp": player.max_hp,
                                    "collectorShieldRem": max(0.0, round(player.shield_until - now, 1)),
                                    "collectorDamageBoostRem": max(0.0, round(player.damage_boost_until - now, 1)),
                                }
                            )

                            # Respawn an item after 12s so arena always has 6 items
                            async def respawn_task(room):
                                await asyncio.sleep(12.0)
                                if len(room.items) < 6:
                                    new_it = room.spawn_random_item()
                                    await room.broadcast(
                                        {
                                            "type": "item_spawned",
                                            "item": new_it.to_dict(),
                                        }
                                    )
                            asyncio.create_task(respawn_task(current_room))

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
                    raw_damage = int(data.get("damage", 12))
                    now = time.time()
                    # 2x damage if damage boost buff is active!
                    effective_damage = (raw_damage * 2) if (now < player.damage_boost_until) else raw_damage

                    if (
                        target_id
                        and target_id in current_room.players
                        and not player.is_dead
                    ):
                        target = current_room.players[target_id]
                        # Cannot damage dead player or shielded player
                        if not target.is_dead and now > target.shield_until:
                            target.hp = max(0, target.hp - effective_damage)

                            # Notify room of damage
                            await current_room.broadcast(
                                {
                                    "type": "player_damaged",
                                    "targetId": target_id,
                                    "hp": target.hp,
                                    "damage": effective_damage,
                                    "attackerId": player_id,
                                }
                            )

                            # Check for Kill
                            if target.hp <= 0 and not target.is_dead:
                                target.is_dead = True
                                target.respawn_at = now + 3.0  # 3 seconds countdown
                                target.deaths += 1
                                # Death penalty: Reset victim back to LV.1 and default 100 max HP
                                target.level = 1
                                target.max_hp = 100
                                target.damage_boost_until = 0.0

                                # Killer rewards: kills, score, level up, max HP upgrade, and HP heal reward!
                                player.kills += 1
                                player.score += 100
                                player.level += 1
                                player.max_hp = 100 + (player.level - 1) * 15
                                heal_reward = 40
                                player.hp = min(player.max_hp, player.hp + heal_reward)

                                await current_room.broadcast(
                                    {
                                        "type": "player_killed",
                                        "victimId": target_id,
                                        "victimCallsign": target.callsign,
                                        "victimLevel": target.level,
                                        "killerId": player_id,
                                        "killerCallsign": player.callsign,
                                        "killerLevel": player.level,
                                        "killerHp": player.hp,
                                        "killerMaxHp": player.max_hp,
                                        "hpReward": heal_reward,
                                        "respawnIn": 3.0,
                                    }
                                )
                                print(
                                    f"[Kill] {player.callsign} (Lv.{player.level}, HP={player.hp}/{player.max_hp}) shot down {target.callsign} (Reset to Lv.1)"
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
                        p.level = 1
                        p.max_hp = 100
                        p.hp = 100
                        p.damage_boost_until = 0.0
                        p.respawn_at = 0.0
                        p.shield_until = now + 3.0  # 3s invulnerability shield
                        # Safe circular respawn inside arena facing center
                        angle = random.random() * 2 * math.pi
                        dist = 400 + random.random() * 350
                        p.x = dist * math.cos(angle)
                        p.y = dist * math.sin(angle)
                        p.alt = 50.0 + (random.random() - 0.5) * 15.0
                        p.heading = (math.degrees(math.atan2(-p.x, -p.y)) + 360) % 360

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
                                    "maxHp": p.max_hp,
                                    "level": p.level,
                                    "shieldDuration": 3.0,
                                }
                            )
                        )

                # Broadcast World Update
                players_payload = [p.to_dict() for p in list(room.players.values())]
                items_payload = [it.to_dict() for it in list(room.items.values())]
                update_msg = json.dumps(
                    {
                        "type": "world_update",
                        "players": players_payload,
                        "items": items_payload,
                    }
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
