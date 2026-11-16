# install_tv.py - Automated deployment to LG C1 OLED TV over Telnet & Luna
import os
import sys
import time
import socket
import threading
import http.server
import socketserver

TV_IP = "192.168.1.199"
TV_PORT = 23
LOCAL_IP = "192.168.1.200"
HTTP_PORT = 8765
IPK_DIR = os.path.abspath("build")
IPK_NAME = "org.webosbrew.vkvideo.adfree_1.0.0_all.ipk"
IPK_PATH = os.path.join(IPK_DIR, IPK_NAME)

if not os.path.exists(IPK_PATH):
    print(f"Error: IPK not found at {IPK_PATH}")
    sys.exit(1)

file_size = os.path.getsize(IPK_PATH)
print(f"Target IPK: {IPK_NAME} ({file_size} bytes)")

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=IPK_DIR, **kwargs)
    def log_message(self, format, *args):
        print(f"[HTTP Server] {self.address_string()} - {format % args}")

httpd = socketserver.TCPServer((LOCAL_IP, HTTP_PORT), QuietHandler)
server_thread = threading.Thread(target=httpd.serve_forever, daemon=True)
server_thread.start()
print(f"HTTP server listening on http://{LOCAL_IP}:{HTTP_PORT}/")

def run_telnet_cmd(s, cmd, wait_sec=2):
    print(f">>> Running: {cmd}")
    s.sendall(cmd.encode("utf-8") + b"\n")
    time.sleep(wait_sec)
    out = b""
    while True:
        try:
            s.settimeout(1.0)
            chunk = s.recv(4096)
            if not chunk:
                break
            out += chunk
        except socket.timeout:
            break
    res = out.decode("utf-8", errors="ignore")
    print(res)
    return res

try:
    print(f"Connecting to TV Telnet at {TV_IP}:{TV_PORT}...")
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(10.0)
    s.connect((TV_IP, TV_PORT))
    time.sleep(1.0)
    s.recv(4096) # clear banner

    # 1. Download IPK to /tmp
    download_url = f"http://{LOCAL_IP}:{HTTP_PORT}/{IPK_NAME}"
    run_telnet_cmd(s, f"curl -s -f {download_url} -o /tmp/vkvideo.ipk", wait_sec=2)

    # 2. Check downloaded size
    run_telnet_cmd(s, "ls -la /tmp/vkvideo.ipk", wait_sec=1)

    # 3. If old app exists, remove it first
    run_telnet_cmd(s, "luna-send -n 1 -f luna://com.webos.appInstallService/dev/remove '{\"id\":\"org.webosbrew.vkvideo.adfree\"}'", wait_sec=2)

    # 4. Install via luna appInstallService
    print("Installing application via luna appInstallService...")
    install_res = run_telnet_cmd(
        s,
        "luna-send -n 1 -f luna://com.webos.appInstallService/dev/install '{\"id\":\"org.webosbrew.vkvideo.adfree\",\"ipkUrl\":\"/tmp/vkvideo.ipk\",\"subscribe\":false}'",
        wait_sec=5
    )

    # 5. Check if directory exists
    run_telnet_cmd(s, "ls -la /media/developer/apps/usr/palm/applications/org.webosbrew.vkvideo.adfree || ls -la /var/luna/applications/org.webosbrew.vkvideo.adfree", wait_sec=1)

    # 6. Verify registration
    run_telnet_cmd(s, "luna-send -n 1 -f luna://com.webos.applicationManager/getAppInfo '{\"id\":\"org.webosbrew.vkvideo.adfree\"}'", wait_sec=2)

    print("Deployment finished successfully!")

finally:
    httpd.shutdown()
    s.close()
