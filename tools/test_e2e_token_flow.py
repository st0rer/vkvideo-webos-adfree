import socket
import base64
import os
import json
import urllib.request
import urllib.parse
import time

pages = json.loads(urllib.request.urlopen('http://192.168.1.199:9998/json').read().decode('utf-8'))
ws_url = None
for p in pages:
    if 'vkvideo' in p.get('url', ''):
        ws_url = p.get('webSocketDebuggerUrl')
        break

path = ws_url.split(':9998')[-1]
s = socket.socket()
s.connect(('192.168.1.199', 9998))
key = base64.b64encode(os.urandom(16)).decode('ascii')
req = (
    f'GET {path} HTTP/1.1\r\n'
    'Host: 192.168.1.199:9998\r\n'
    'Upgrade: websocket\r\n'
    'Connection: Upgrade\r\n'
    f'Sec-WebSocket-Key: {key}\r\n'
    'Sec-WebSocket-Version: 13\r\n\r\n'
)
s.sendall(req.encode('ascii'))
resp = s.recv(4096)

def send_ws(msg):
    raw = json.dumps(msg).encode('utf-8')
    length = len(raw)
    header = bytearray([0x81])
    if length <= 125:
        header.append(0x80 | length)
    elif length <= 65535:
        header.append(0x80 | 126)
        header.extend(length.to_bytes(2, 'big'))
    mask = os.urandom(4)
    header.extend(mask)
    masked = bytearray([b ^ mask[i % 4] for i, b in enumerate(raw)])
    s.sendall(header + masked)

send_ws({'id': 1, 'method': 'Runtime.enable'})
send_ws({'id': 2, 'method': 'Console.enable'})

print("1. Opening QR Modal...")
send_ws({'id': 10, 'method': 'Runtime.evaluate', 'params': {'expression': 'window.vkApp.openQRModal()', 'returnByValue': True}})

time.sleep(2.0)

# Check if auth server is running
print("2. Verifying auth server is up...")
try:
    urllib.request.urlopen('http://192.168.1.199:8765/', timeout=2)
    print("   Auth server is UP!")
except Exception as e:
    print("   Auth server FAILED:", e)

print("3. Simulating phone submitting token...")
test_token = "vk1.a.DEMO_TEST_TOKEN_ON_DEMAND_12345"
req = urllib.request.Request('http://192.168.1.199:8765/submit?token=' + urllib.parse.quote(test_token), data=b'', method='POST')
try:
    submit_res = json.loads(urllib.request.urlopen(req, timeout=3).read().decode('utf-8'))
    print("   Submit response:", submit_res)
except Exception as e:
    print("   Submit error:", e)

print("4. Waiting for app to pick up token and complete login...")
time.sleep(2.5)

# Check console messages from TV
s.settimeout(0.5)
while True:
    try:
        chunk = s.recv(4096)
        if not chunk: break
        text = chunk.decode('utf-8', errors='ignore')
        for line in text.split('\n'):
            if 'text' in line or 'CONSOLE' in line or 'completeLoginWithToken' in line:
                print("   TV Log:", line.strip())
    except:
        break

# Verify auth_server is killed
tel = socket.socket()
tel.connect(('192.168.1.199', 23))
tel.recv(1024)
tel.sendall(b"ps aux | grep -v grep | grep auth_server\n")
time.sleep(0.5)
ps_out = tel.recv(4096).decode('utf-8', errors='ignore')
print("5. TV Processes after login completed:")
print(ps_out)
tel.close()

# Verify token in app localStorage
send_ws({'id': 20, 'method': 'Runtime.evaluate', 'params': {'expression': 'localStorage.getItem("vk_access_token")', 'returnByValue': True}})
time.sleep(0.5)
data = s.recv(4096)
print("6. localStorage vk_access_token in TV app:", data.decode('utf-8', errors='ignore'))

# Clean up test token in localStorage so user starts clean
send_ws({'id': 30, 'method': 'Runtime.evaluate', 'params': {'expression': 'localStorage.removeItem("vk_access_token"); localStorage.removeItem("vk_user_profile"); window.vkApp.updateUserCard()', 'returnByValue': True}})
time.sleep(0.5)
print("7. Cleaned up demo token from TV localStorage.")

s.close()
