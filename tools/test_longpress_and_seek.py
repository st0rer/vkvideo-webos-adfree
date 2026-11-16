import socket, base64, os, json, time, urllib.request, sys

sys.stdout.reconfigure(encoding='utf-8')

pages = json.loads(urllib.request.urlopen('http://192.168.1.199:9998/json').read().decode('utf-8'))
ws_url = None
for p in pages:
    if 'vkvideo' in p.get('url', ''):
        ws_url = p.get('webSocketDebuggerUrl')
        break

if not ws_url and pages:
    ws_url = pages[0].get('webSocketDebuggerUrl')

print(f"Connecting to CDP: {ws_url}")
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
        if not frame:
            return None
        try:
            resp = json.loads(frame)
            if resp.get("id") == msg_id:
                res = resp.get("result", {})
                if "exceptionDetails" in res:
                    print("JS EXCEPTION:", res["exceptionDetails"])
                return res.get("result", {}).get("value")
        except:
            pass

def dispatch_key(type_, key_code, char=""):
    global msg_id
    msg_id += 1
    req = {
        "id": msg_id,
        "method": "Input.dispatchKeyEvent",
        "params": {
            "type": type_,
            "windowsVirtualKeyCode": key_code,
            "nativeVirtualKeyCode": key_code,
            "keyCode": key_code,
            "text": char,
            "unmodifiedText": char
        }
    }
    send_ws(req)
    # Drain immediate response
    time.sleep(0.02)

print("Checking app readiness...")
for _ in range(15):
    ready = eval_js("Boolean(window.vkApp && window.vkApp.nav)")
    if ready:
        break
    time.sleep(1)

print(f"App ready: {ready}")
time.sleep(2)
cards_count = eval_js("document.querySelectorAll('.video-card').length")
print(f"Video cards found on screen: {cards_count}")

# 1. TEST LONG PRESS ON VIDEO CARD
print("\n--- TEST 1: LONG PRESS OK ON VIDEO CARD ---")
first_card_focused = eval_js("""
(() => {
    const card = document.querySelector('.video-card');
    if (!card) return false;
    window.vkApp.nav.setFocus(card);
    return true;
})()
""")
print(f"First card focused: {first_card_focused}")

# Emulate keydown OK (13) and hold for 650ms
print("Emulating OK keydown hold (>500ms)...")
dispatch_key("keyDown", 13)
time.sleep(0.7)
dispatch_key("keyUp", 13)

time.sleep(0.3)
modal_state = eval_js("""
(() => {
    const modal = document.getElementById('video-context-modal');
    const isVisible = modal && modal.style.display === 'flex';
    const title = document.getElementById('context-modal-title') ? document.getElementById('context-modal-title').textContent : '';
    const channel = document.getElementById('ctx-channel-name') ? document.getElementById('ctx-channel-name').textContent : '';
    const focusedId = window.vkApp.nav.currentFocused ? window.vkApp.nav.currentFocused.id : null;
    return { isVisible: isVisible, title: title, channel: channel, focusedId: focusedId };
})()
""")
print(f"Modal State after long-press: {modal_state}")

assert modal_state and modal_state["isVisible"], "FAIL: Context modal did not open on long press!"
print("SUCCESS: Context modal opened with options!")

# Test Channel Click
print("\n--- TEST 2: CLICK GO TO CHANNEL ---")
channel_loaded = eval_js("""
(() => {
    const btn = document.getElementById('ctx-btn-channel');
    if (btn) {
        btn.click();
        return true;
    }
    return false;
})()
""")
print(f"Clicked channel button: {channel_loaded}")
time.sleep(2.5)

channel_view_info = eval_js("""
(() => {
    const title = document.querySelector('.section-title') ? document.querySelector('.section-title').textContent : '';
    const gridCards = document.querySelectorAll('.video-card').length;
    const backBtn = Boolean(document.getElementById('channel-back-btn'));
    return { title: title, gridCards: gridCards, hasBackBtn: backBtn };
})()
""")
print(f"Channel view info: {channel_view_info}")
assert channel_view_info and channel_view_info["gridCards"] > 0, "FAIL: Channel videos did not load!"
print("SUCCESS: Channel videos loaded successfully!")

# Return to home
print("\nReturning to home...")
eval_js("window.vkApp.loadSection('home')")
time.sleep(2)

# TEST 3: ACCELERATED SEEKING WHEN OSD IS HIDDEN
print("\n--- TEST 3: ACCELERATED SEEKING (OSD HIDDEN) ---")
# Start video
play_started = eval_js("""
(async () => {
    const card = document.querySelector('.video-card');
    if (!card) return false;
    const id = card.dataset.id;
    const details = await window.vkApp.api.getVideoDetails(id);
    window.vkApp.player.loadAndPlay(details);
    return true;
})()
""")
print(f"Initiated playback: {play_started}")

# Wait for video duration
for i in range(15):
    dur = eval_js("Boolean(window.vkApp.player.video && window.vkApp.player.video.duration > 0)")
    if dur:
        break
    time.sleep(1)

# Ensure OSD is hidden
eval_js("window.vkApp.player.hideOSD()")
time.sleep(0.5)

osd_initially_hidden = eval_js("window.vkApp.player.osd.classList.contains('hidden')")
print(f"OSD initially hidden: {osd_initially_hidden}")

# Press Right arrow once (key 39)
print("Sending Right Arrow key...")
dispatch_key("keyDown", 39)
dispatch_key("keyUp", 39)

seek_bubble_state1 = eval_js("""
(() => {
    const bubble = document.getElementById('seek-bubble');
    const text = document.getElementById('seek-bubble-text') ? document.getElementById('seek-bubble-text').textContent : '';
    const isOSDHidden = window.vkApp.player.osd.classList.contains('hidden');
    const display = bubble ? bubble.style.display : 'none';
    return { bubbleVisible: display === 'flex', bubbleText: text, isOSDHidden: isOSDHidden };
})()
""")
print(f"Seek Bubble State 1: {seek_bubble_state1}")
assert seek_bubble_state1["bubbleVisible"], "FAIL: Seek bubble should be visible on Right arrow!"
assert seek_bubble_state1["isOSDHidden"], "FAIL: OSD must REMAIN HIDDEN when accelerated seek occurs!"

# Press Right arrow rapidly 2 more times (within 700ms)
time.sleep(0.2)
dispatch_key("keyDown", 39)
dispatch_key("keyUp", 39)
time.sleep(0.2)
dispatch_key("keyDown", 39)
dispatch_key("keyUp", 39)

seek_bubble_state2 = eval_js("""
(() => {
    const text = document.getElementById('seek-bubble-text') ? document.getElementById('seek-bubble-text').textContent : '';
    const streak = window.vkApp.player.seekStreak;
    const accum = window.vkApp.player.accumulatedSeek;
    const isOSDHidden = window.vkApp.player.osd.classList.contains('hidden');
    return { streak: streak, accumulatedSeek: accum, text: text, isOSDHidden: isOSDHidden };
})()
""")
print(f"Seek Bubble State 2 (after rapid presses): {seek_bubble_state2}")
assert seek_bubble_state2["streak"] >= 3, "FAIL: Seek streak did not accelerate!"
assert seek_bubble_state2["accumulatedSeek"] >= 60, "FAIL: Accumulated seek should accelerate (10+20+30=60s)!"
assert seek_bubble_state2["isOSDHidden"], "FAIL: OSD must stay hidden!"

print("\nWaiting for seek to commit (550ms)...")
time.sleep(0.8)
committed_state = eval_js("""
(() => {
    const bubble = document.getElementById('seek-bubble');
    return { bubbleVisible: bubble && bubble.style.display !== 'none', isOSDHidden: window.vkApp.player.osd.classList.contains('hidden') };
})()
""")
print(f"Committed state: {committed_state}")
assert not committed_state["bubbleVisible"], "FAIL: Seek bubble should auto-hide after commit!"

# Close player cleanly
eval_js("window.vkApp.player.close()")
print("\nALL VERIFICATIONS PASSED 100%!")
s.close()
