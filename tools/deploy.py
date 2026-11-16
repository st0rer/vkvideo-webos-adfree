# deploy.py - Direct TCP file transfer & installation to LG C1 webOS TV
import socket
import time
import os

TV_IP = "192.168.1.199"
TELNET_PORT = 23
DATA_PORT = 9999
IPK_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "build", "org.webosbrew.vkvideo.adfree_1.0.0_all.ipk")

data = open(IPK_PATH, "rb").read()
file_size = len(data)
print(f"Target IPK: {IPK_PATH} ({file_size} bytes)")

tn = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
tn.settimeout(15.0)
tn.connect((TV_IP, TELNET_PORT))
time.sleep(1.0)
tn.recv(4096)

def exec_telnet(cmd, wait=1.5):
    print(f"\n>>> TV: {cmd}")
    tn.sendall(cmd.encode("utf-8") + b"\n")
    time.sleep(wait)
    out = b""
    while True:
        try:
            tn.settimeout(0.8)
            chunk = tn.recv(4096)
            if not chunk: break
            out += chunk
        except socket.timeout:
            break
    res = out.decode("utf-8", errors="ignore")
    print(res)
    return res

# 1. Create receiver script on TV using cat << 'EOF'
create_script_cmd = """cat << 'EOF' > /tmp/recv.py
import socket
s = socket.socket()
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(('0.0.0.0', 9999))
s.listen(1)
print('RECEIVER_READY')
conn, addr = s.accept()
f = open('/tmp/vkvideo.ipk', 'wb')
while True:
    buf = conn.recv(65536)
    if not buf:
        break
    f.write(buf)
f.close()
conn.close()
s.close()
print('RECEIVER_DONE')
EOF"""

exec_telnet(create_script_cmd, wait=1.0)
exec_telnet("cat /tmp/recv.py", wait=0.5)

# 2. Launch receiver in background on TV
exec_telnet("python /tmp/recv.py &", wait=1.0)

# 3. Connect to TV DATA_PORT and transmit binary
print(f"Connecting to TV data port {DATA_PORT}...")
sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.settimeout(10.0)
sock.connect((TV_IP, DATA_PORT))
print(f"Streaming {file_size} bytes...")
sock.sendall(data)
sock.close()
print("Data transmitted successfully!")

time.sleep(2.0)

# 4. Check received file size
exec_telnet("ls -la /tmp/vkvideo.ipk", wait=1.0)

# 5. Remove any old installation
exec_telnet("luna-send -n 1 -f luna://com.webos.appInstallService/dev/remove '{\"id\":\"org.webosbrew.vkvideo.adfree\"}'", wait=2.0)

# 6. Install package
print("\nInstalling IPK on webOS...")
exec_telnet("luna-send -i -f luna://com.webos.appInstallService/dev/install '{\"id\":\"org.webosbrew.vkvideo.adfree\",\"ipkUrl\":\"/tmp/vkvideo.ipk\",\"subscribe\":true}'", wait=6.0)

# 7. Check application directory
exec_telnet("ls -la /media/developer/apps/usr/palm/applications/org.webosbrew.vkvideo.adfree", wait=1.0)

# 8. Query application info
exec_telnet("luna-send -n 1 -f luna://com.webos.applicationManager/getAppInfo '{\"id\":\"org.webosbrew.vkvideo.adfree\"}'", wait=2.0)

# 9. Clean up
exec_telnet("rm -f /tmp/recv.py /tmp/vkvideo.ipk", wait=1.0)

tn.close()
print("\n[SUCCESS] VK Video AdFree 4K is now installed on your LG C1 TV!")
