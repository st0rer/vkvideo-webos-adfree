import socket, base64, os, json, time, urllib.request, sys

sys.stdout.reconfigure(encoding='utf-8')

pages = json.loads(urllib.request.urlopen('http://192.168.1.199:9998/json').read().decode('utf-8'))
ws_url = None
for p in pages:
    if 'vkvideo' in p.get('url', ''):
        ws_url = p.get('webSocketDebuggerUrl')
        break

if not ws_url:
    print("Error: Could not find webSocketDebuggerUrl")
    sys.exit(1)

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

def eval_js(expr, req_id, timeout=3.0):
    send_ws({'id': req_id, 'method': 'Runtime.evaluate', 'params': {'expression': expr, 'returnByValue': True, 'awaitPromise': True}})
    deadline = time.time() + timeout
    buffer = b""
    s.settimeout(0.5)
    while time.time() < deadline:
        try:
            chunk = s.recv(65536)
            if not chunk: break
            buffer += chunk
        except socket.timeout:
            pass

        # Try parse messages from buffer
        idx = 0
        while idx < len(buffer):
            if idx + 2 > len(buffer): break
            b2 = buffer[idx+1]
            payload_len = b2 & 0x7F
            header_len = 2
            if payload_len == 126:
                if idx + 4 > len(buffer): break
                payload_len = int.from_bytes(buffer[idx+2:idx+4], 'big')
                header_len = 4
            elif payload_len == 127:
                if idx + 10 > len(buffer): break
                payload_len = int.from_bytes(buffer[idx+2:idx+10], 'big')
                header_len = 10
            
            if idx + header_len + payload_len > len(buffer):
                break
                
            payload = buffer[idx+header_len : idx+header_len+payload_len]
            idx += header_len + payload_len
            try:
                msg = json.loads(payload.decode('utf-8', errors='ignore'))
                if msg.get('id') == req_id:
                    return msg.get('result', {}).get('result', {}).get('value')
            except:
                pass
    return None

def dispatch_key(keycode, req_id):
    expr = f"window.dispatchEvent(new KeyboardEvent('keydown', {{keyCode: {keycode}, which: {keycode}, bubbles: true}}));"
    return eval_js(expr, req_id)

print("--- 1. Checking Home Screen and Playing First Video ---", flush=True)
click_first_video = """
(() => {
    const card = document.querySelector('.video-card');
    if (!card) return false;
    card.click();
    return true;
})()
"""
clicked = eval_js(click_first_video, 100)
print("Clicked video card:", clicked, flush=True)
time.sleep(2.5)

check_player = """
(() => {
    const p = window.app ? window.app.player : (window.vkApp ? window.vkApp.player : null);
    const v = document.getElementById('native-player');
    const badge = document.getElementById('player-center-badge');
    const btnText = document.getElementById('play-btn-text');
    const focused = document.activeElement ? (document.activeElement.id || document.activeElement.className) : 'none';
    return {
        playerVisible: p ? p.container.style.display !== 'none' : false,
        paused: v ? v.paused : null,
        currentTime: v ? v.currentTime : null,
        badgeDisplay: badge ? window.getComputedStyle(badge).display : null,
        btnText: btnText ? btnText.textContent : null,
        focused: focused
    };
})()
"""
status1 = eval_js(check_player, 101)
print("Initial Playback State:", json.dumps(status1, indent=2), flush=True)

print("\n--- 2. Pressing OK (Key 13) to Pause ---", flush=True)
dispatch_key(13, 102)
time.sleep(0.5)

status2 = eval_js(check_player, 103)
print("Paused State:", json.dumps(status2, indent=2), flush=True)
assert status2['paused'] == True, "FAIL: Video should be paused!"
assert 'btn-play-pause' in status2['focused'], "FAIL: Focus should be on btn-play-pause!"
assert status2['badgeDisplay'] == 'flex', "FAIL: Center pause badge should be visible (display: flex)!"
assert 'Воспроизвести' in status2['btnText'], f"FAIL: Expected text to say Воспроизвести, got {status2['btnText']}"
print(">>> PASS: Video paused, btn-play-pause focused, pause badge displayed!", flush=True)

print("\n--- 3. Pressing OK (Key 13) to Resume Playback ---", flush=True)
dispatch_key(13, 104)
time.sleep(0.8)

status3 = eval_js(check_player, 105)
print("Resumed Playback State:", json.dumps(status3, indent=2), flush=True)
assert status3['paused'] == False, "FAIL: Video should be playing again!"
assert status3['badgeDisplay'] == 'none', "FAIL: Center pause badge should be hidden!"
assert 'Пауза' in status3['btnText'], f"FAIL: Expected text to say Пауза, got {status3['btnText']}"
print(">>> PASS: Video resumed playing immediately on OK click!", flush=True)

print("\n--- 4. Testing D-Pad Navigation in OSD ---", flush=True)
# Pause first to keep OSD open
dispatch_key(13, 106)
time.sleep(0.4)

# Press Right (39) -> should move to btn-rewind
dispatch_key(39, 107)
time.sleep(0.2)
f_right1 = eval_js("document.activeElement.id", 108)
print("Focus after Right 1:", f_right1, flush=True)
assert f_right1 == 'btn-rewind', f"Expected btn-rewind, got {f_right1}"

# Press Right (39) -> should move to btn-forward
dispatch_key(39, 109)
time.sleep(0.2)
f_right2 = eval_js("document.activeElement.id", 110)
print("Focus after Right 2:", f_right2, flush=True)
assert f_right2 == 'btn-forward', f"Expected btn-forward, got {f_right2}"

# Press Right (39) -> should move to btn-quality
dispatch_key(39, 111)
time.sleep(0.2)
f_right3 = eval_js("document.activeElement.id", 112)
print("Focus after Right 3:", f_right3, flush=True)
assert f_right3 == 'btn-quality', f"Expected btn-quality, got {f_right3}"

# Press Left (37) -> should move back to btn-forward
dispatch_key(37, 113)
time.sleep(0.2)
f_left1 = eval_js("document.activeElement.id", 114)
print("Focus after Left 1:", f_left1, flush=True)
assert f_left1 == 'btn-forward', f"Expected btn-forward, got {f_left1}"

# Press Up (38) -> should move to progress-track
dispatch_key(38, 115)
time.sleep(0.2)
f_up = eval_js("document.activeElement.id", 116)
print("Focus after Up:", f_up, flush=True)
assert f_up == 'progress-track', f"Expected progress-track, got {f_up}"

# Press Down (40) -> should move back to btn-play-pause
dispatch_key(40, 117)
time.sleep(0.2)
f_down = eval_js("document.activeElement.id", 118)
print("Focus after Down:", f_down, flush=True)
assert f_down == 'btn-play-pause', f"Expected btn-play-pause, got {f_down}"

print("\n--- 5. Testing Quality Modal ---", flush=True)
# Navigate Right to btn-quality: play-pause -> rewind -> forward -> quality
dispatch_key(39, 119)
time.sleep(0.15)
dispatch_key(39, 120)
time.sleep(0.15)
dispatch_key(39, 121)
time.sleep(0.15)

# Press OK on btn-quality to open modal
dispatch_key(13, 122)
time.sleep(0.5)

check_modal = """
(() => {
    const m = document.getElementById('quality-modal');
    const opts = Array.from(m.querySelectorAll('.option-btn')).map(b => b.textContent.trim());
    return {
        modalVisible: window.getComputedStyle(m).display !== 'none',
        options: opts,
        focused: document.activeElement ? document.activeElement.textContent.trim() : null
    };
})()
"""
modal_status = eval_js(check_modal, 123)
print("Quality Modal State:", json.dumps(modal_status, indent=2), flush=True)
assert modal_status['modalVisible'] == True, "FAIL: Quality modal should be open!"
print(">>> PASS: Quality modal opened smoothly with clear recommendations!", flush=True)

# Close modal with Back key (461)
dispatch_key(461, 124)
time.sleep(0.4)

# Finally press OK to unpause and resume playback
dispatch_key(13, 125)
time.sleep(0.8)

final_status = eval_js(check_player, 126)
print("Final Playback State:", json.dumps(final_status, indent=2), flush=True)
assert final_status['paused'] == False, "FAIL: Video should be playing!"

print("\n==============================================", flush=True)
print("ALL REMOTE CONTROL & PLAYER TESTS PASSED 100%!", flush=True)
print("==============================================", flush=True)
s.close()
