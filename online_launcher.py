#!/usr/bin/env python3
"""
Sky Ace: Dogfight Arena - Online Launcher with Instant Cloudflare Tunnel
Starts the game server and exposes a free, secure global HTTPS/WSS URL
so friends across the world can join with zero setup!
"""

import os
import re
import signal
import subprocess
import sys
import time
import urllib.request
import webbrowser

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
CLOUDFLARED_BIN = os.path.join(ROOT_DIR, "bin", "cloudflared")
SERVER_PY = os.path.join(ROOT_DIR, "server.py")
PORT = 8088


def find_free_port(start_port=8088):
    import socket

    for p in range(start_port, start_port + 20):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("127.0.0.1", p)) != 0:
                return p
    return start_port


def main():
    global PORT
    PORT = find_free_port(8088)
    env = os.environ.copy()
    env["PORT"] = str(PORT)

    print("\n" + "=" * 70)
    print(" ✈️   SKY ACE: DOGFIGHT ARENA - ONLINE LAUNCHER")
    print("=" * 70)
    print(" [1/3] กำลังเปิดเซิร์ฟเวอร์เกมในเครื่อง (Port: " + str(PORT) + ")...")

    # 1. Start Server
    server_proc = subprocess.Popen(
        [sys.executable, SERVER_PY],
        cwd=ROOT_DIR,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )

    # Wait for server to respond
    server_ready = False
    for _ in range(30):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/") as r:
                if r.status == 200:
                    server_ready = True
                    break
        except Exception:
            time.sleep(0.2)

    if not server_ready:
        print("❌ เกิดข้อผิดพลาดในการเปิดเซิร์ฟเวอร์ กรุณาลองใหม่อีกครั้ง")
        server_proc.kill()
        sys.exit(1)

    print(" ✓ เซิร์ฟเวอร์ในเครื่องพร้อมใช้งาน!")
    print(" [2/3] กำลังสร้างลิงก์ออนไลน์ความเร็วสูงผ่าน Cloudflare Tunnel...")

    # 2. Start Cloudflare Tunnel
    if not os.path.isfile(CLOUDFLARED_BIN):
        print(f"❌ ไม่พบไฟล์ {CLOUDFLARED_BIN}")
        server_proc.kill()
        sys.exit(1)

    cf_log_path = "/tmp/cf_dogfight.log"
    if os.path.exists(cf_log_path):
        try: os.remove(cf_log_path)
        except Exception: pass

    tunnel_proc = subprocess.Popen(
        [CLOUDFLARED_BIN, "tunnel", "--url", f"http://localhost:{PORT}", "--logfile", cf_log_path],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL
    )

    # Poll log file for public URL
    public_url = None
    url_pattern = re.compile(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com")

    start_time = time.time()
    while time.time() - start_time < 20:
        if os.path.exists(cf_log_path):
            with open(cf_log_path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
                match = url_pattern.search(content)
                if match:
                    public_url = match.group(0)
                    break
        time.sleep(0.5)

    print("=" * 70)
    if public_url:
        print(" 🎉 สร้างลิงก์ออนไลน์สำหรับเล่นกับเพื่อนสำเร็จแล้ว! (Online Ready)")
        print("=" * 70)
        print(f"\n 🌐 ส่งลิงก์นี้ให้เพื่อนเข้าเล่นได้ทันที (เล่นได้จากทุกที่ทั่วโลก):")
        print(f"    👉  \033[1;36m{public_url}\033[0m\n")
        print(f" 💻 สำหรับคุณเล่นในเครื่องนี้ (Local):")
        print(f"    👉  \033[1;32mhttp://localhost:{PORT}\033[0m\n")
        print(" 🕹️  ขั้นตอนการเล่นกับเพื่อน:")
        print("    1. ก๊อปปี้ลิงก์สีฟ้าด้านบนส่งให้เพื่อนใน LINE, Discord หรือแชท")
        print("    2. ให้เพื่อนเปิดผ่านเบราว์เซอร์ (Chrome, Safari, Edge, หรือมือถือ)")
        print("    3. ใส่รหัสห้องเดียวกัน (เช่น SKY-1) แล้วกดยิงกันได้ทันที!")
    else:
        print(" ⚠️ สร้างลิงก์ภายนอกไม่สำเร็จ แต่คุณยังสามารถเล่นในวง LAN / Wi-Fi ได้:")
        print(f"    👉  http://localhost:{PORT}")
    print("=" * 70)
    print(" 💡 กดปุ่ม [Ctrl + C] เมื่อต้องการปิดเซิร์ฟเวอร์\n")

    # Open local browser
    try:
        webbrowser.open(public_url or f"http://localhost:{PORT}")
    except Exception:
        pass

    def cleanup(sig=None, frame=None):
        print("\n\nกำลังปิดเซิร์ฟเวอร์และหยุด Tunnel...")
        try:
            tunnel_proc.terminate()
            server_proc.terminate()
        except Exception:
            pass
        print("ปิดเรียบร้อยแล้ว แล้วพบกันใหม่ครับ! ✈️")
        sys.exit(0)

    signal.signal(signal.SIGINT, cleanup)
    signal.signal(signal.SIGTERM, cleanup)

    # Keep alive
    try:
        while True:
            if server_proc.poll() is not None:
                print("Server stopped unexpectedly.")
                break
            time.sleep(1)
    except KeyboardInterrupt:
        cleanup()


if __name__ == "__main__":
    main()
