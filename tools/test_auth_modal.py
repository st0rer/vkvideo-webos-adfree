import socket, base64, os, json, urllib.request, time, sys

sys.stdout.reconfigure(encoding='utf-8')

pages = json.loads(urllib.request.urlopen('http://192.168.1.199:9998/json').read().decode('utf-8'))
ws_url = pages[0]['webSocketDebuggerUrl']
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
    f'Sec-WebSocket-Version: 13\r\n\r\n'
)
s.sendall(req.encode('ascii'))
s.recv(4096)

def send_ws(msg):
    raw = json.dumps(msg).encode('utf-8')
    l = len(raw)
    h = bytearray([0x81])
    if l <= 125: h.append(0x80 | l)
    elif l <= 65535: h.append(0x80 | 126); h.extend(l.to_bytes(2, 'big'))
    m = os.urandom(4); h.extend(m)
    s.sendall(h + bytearray([b ^ m[i % 4] for i, b in enumerate(raw)]))

def recv_frame():
    hdr = s.recv(2)
    if not hdr: return None
    payload_len = hdr[1] & 0x7f
    if payload_len == 126:
        ext = s.recv(2)
        payload_len = int.from_bytes(ext, 'big')
    elif payload_len == 127:
        ext = s.recv(8)
        payload_len = int.from_bytes(ext, 'big')
    data = bytearray()
    while len(data) < payload_len:
        chunk = s.recv(min(4096, payload_len - len(data)))
        if not chunk: break
        data.extend(chunk)
    return data.decode('utf-8', errors='ignore')

msg_id = 0
def eval_js(expression):
    global msg_id
    msg_id += 1
    req = {
        "id": msg_id,
        "method": "Runtime.evaluate",
        "params": {
            "expression": expression,
            "returnByValue": True,
            "awaitPromise": True
        }
    }
    send_ws(req)
    while True:
        frame = recv_frame()
        if not frame: return None
        try:
            resp = json.loads(frame)
            if resp.get("id") == msg_id:
                res = resp.get("result", {})
                if "exceptionDetails" in res:
                    print("JS EXCEPTION:", res["exceptionDetails"])
                return res.get("result", {}).get("result", {}).get("value")
        except:
            pass

time.sleep(1.0)

print("\n--- TEST: ON-DEMAND LOCAL AUTH SERVER LIFECYCLE ---")

# Step 1: Verify server is NOT running initially
print("[Step 1] Verifying server port 8765 is NOT running initially...")
port_open = False
try:
    sock = socket.socket()
    sock.settimeout(0.5)
    sock.connect(('192.168.1.199', 8765))
    port_open = True
    sock.close()
except:
    pass
print(f"  Port 8765 open: {port_open} (Expected: False - zero idle resources)")
assert not port_open, "Port 8765 must not be open initially!"

# Step 2: Open QR Login Modal
print("\n[Step 2] Opening QR Login Modal on TV...")
eval_js("window.vkApp.openQRModal()")
time.sleep(1.5)

modal_state = eval_js("""
(() => {
    const modal = document.getElementById('qr-modal');
    const urlEl = document.getElementById('qr-local-url');
    const statusEl = document.getElementById('qr-status');
    const svg = document.querySelector('#qr-canvas-container svg');
    return {
        isOpen: modal && modal.style.display === 'flex',
        url: urlEl ? urlEl.textContent : '',
        status: statusEl ? statusEl.textContent : '',
        hasSvg: Boolean(svg)
    };
})()
""")
print(f"  Modal state: {modal_state}")
assert modal_state['isOpen'], "Modal should be open"
assert '8765' in modal_state['url'], "URL should contain port 8765"
assert modal_state['hasSvg'], "QR code SVG should be generated"

# Step 3: Check that local auth server is now running and serving mobile HTML
print("\n[Step 3] Fetching mobile page from http://192.168.1.199:8765...")
req = urllib.request.Request('http://192.168.1.199:8765')
html = urllib.request.urlopen(req, timeout=3).read().decode('utf-8')
print(f"  Fetched {len(html)} bytes from local server")
assert "Вход в VK Video" in html, "HTML must contain page title"
assert "oauth.vk.com/authorize" in html, "HTML must contain official VK OAuth button"
print("  SUCCESS: Local mobile authorization page served correctly!")

# Step 4: Simulate user sending token from smartphone
print("\n[Step 4] Simulating phone sending token to TV via POST /submit...")
test_token = "vk1.a.TEST_SAMPLE_TOKEN_FOR_VERIFICATION_ONLY_998877"
submit_req = urllib.request.Request(
    f'http://192.168.1.199:8765/submit?token={test_token}',
    data=b'',
    method='POST'
)
submit_res = json.loads(urllib.request.urlopen(submit_req, timeout=3).read().decode('utf-8'))
print(f"  Submit response: {submit_res}")
assert submit_res.get('success'), "Server should confirm token receipt"

# Step 5: Wait for TV app to poll and process token
print("\n[Step 5] Waiting for TV to process token and shut down server...")
time.sleep(2.5)

after_state = eval_js("""
(() => {
    const modal = document.getElementById('qr-modal');
    return {
        isModalOpen: modal && modal.style.display === 'flex',
        tokenSaved: Boolean(localStorage.getItem('vk_user_token'))
    };
})()
""")
print(f"  TV state after login: {after_state}")
assert after_state['tokenSaved'], "Token must be saved in localStorage"

# Step 6: Verify local server process has exited completely (0 resources)
print("\n[Step 6] Verifying local server has terminated completely...")
time.sleep(1.0)
port_after = False
try:
    sock = socket.socket()
    sock.settimeout(0.5)
    sock.connect(('192.168.1.199', 8765))
    port_after = True
    sock.close()
except:
    pass
print(f"  Port 8765 open after login: {port_after} (Expected: False)")
assert not port_after, "FAIL: Server port must be closed immediately after login!"

# Clean up test token
eval_js("window.vkApp.api.logout(); window.vkApp.updateUserCard();")
print("\n=== ALL ON-DEMAND LOCAL AUTH TESTS PASSED 100%! ZERO LEAKED RESOURCES! ===")
s.close()
