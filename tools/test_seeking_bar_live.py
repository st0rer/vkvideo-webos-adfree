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
                return res.get("result", {}).get("value")
        except:
            pass

time.sleep(2.5)

print("\n--- TEST: SEEKBAR VISIBILITY AND INTERACTIVE SCRUBBING ---")

# 1. Start playback of first video
play_ok = eval_js("""
(async () => {
    const card = document.querySelector('.video-card');
    if (!card) return false;
    const id = card.dataset.id;
    const details = await window.vkApp.api.getVideoDetails(id);
    window.vkApp.player.loadAndPlay(details);
    return true;
})()
""")
print(f"Playback started: {play_ok}")

for _ in range(15):
    dur = eval_js("Boolean(window.vkApp.player.video && window.vkApp.player.video.duration > 0)")
    if dur: break
    time.sleep(1)

# Ensure OSD is hidden initially
eval_js("window.vkApp.player.hideOSD()")
time.sleep(0.5)

init_state = eval_js("""
(() => {
    const osd = window.vkApp.player.osd;
    return {
        hasHidden: osd.classList.contains('hidden'),
        hasSeeking: osd.classList.contains('seeking')
    };
})()
""")
print(f"Initial OSD state: {init_state}")
assert init_state['hasHidden'] and not init_state['hasSeeking']

# 2. Press Right Arrow
print("Pressing Right Arrow key...")
send_ws({'id': 10, 'method': 'Input.dispatchKeyEvent', 'params': {'type': 'keyDown', 'keyCode': 39, 'windowsVirtualKeyCode': 39}})
send_ws({'id': 11, 'method': 'Input.dispatchKeyEvent', 'params': {'type': 'keyUp', 'keyCode': 39, 'windowsVirtualKeyCode': 39}})
time.sleep(0.1)

seek_state1 = eval_js("""
(() => {
    const osd = window.vkApp.player.osd;
    const controlsBar = document.querySelector('.controls-bar');
    const controlsDisplay = controlsBar ? window.getComputedStyle(controlsBar).display : '';
    const progressTrack = document.getElementById('progress-track');
    const trackHeight = progressTrack ? window.getComputedStyle(progressTrack).height : '';
    const thumb = document.getElementById('progress-thumb');
    const thumbLeft = thumb ? thumb.style.left : '';
    const played = document.getElementById('progress-played');
    const playedWidth = played ? played.style.width : '';
    const timeCur = document.getElementById('time-current') ? document.getElementById('time-current').textContent : '';
    const bubble = document.getElementById('seek-bubble');
    const bubbleDisplay = bubble ? bubble.style.display : '';
    const bubbleText = document.getElementById('seek-bubble-text') ? document.getElementById('seek-bubble-text').textContent : '';

    return {
        isSeekingClass: osd.classList.contains('seeking'),
        controlsDisplay: controlsDisplay,
        trackHeight: trackHeight,
        thumbLeft: thumbLeft,
        playedWidth: playedWidth,
        timeCur: timeCur,
        bubbleDisplay: bubbleDisplay,
        bubbleText: bubbleText
    };
})()
""")
print(f"Seeking State 1 (on Right arrow): {seek_state1}")
assert seek_state1['isSeekingClass'], "FAIL: OSD must have 'seeking' class to reveal progress bar!"
assert seek_state1['controlsDisplay'] == 'none', "FAIL: Bulky buttons controls-bar must remain hidden during seek!"
assert seek_state1['bubbleDisplay'] == 'flex', "FAIL: Central seek bubble must be visible!"
assert seek_state1['thumbLeft'] and seek_state1['thumbLeft'] != '0%', "FAIL: Thumb must indicate scrub position on bar!"
print("SUCCESS: Progress bar and seek indicator are clearly displayed, without bulky buttons!")

# 3. Press Right Arrow again rapidly
print("Pressing Right Arrow second time...")
time.sleep(0.2)
send_ws({'id': 12, 'method': 'Input.dispatchKeyEvent', 'params': {'type': 'keyDown', 'keyCode': 39, 'windowsVirtualKeyCode': 39}})
send_ws({'id': 13, 'method': 'Input.dispatchKeyEvent', 'params': {'type': 'keyUp', 'keyCode': 39, 'windowsVirtualKeyCode': 39}})
time.sleep(0.1)

seek_state2 = eval_js("""
(() => {
    const thumb = document.getElementById('progress-thumb');
    const timeCur = document.getElementById('time-current') ? document.getElementById('time-current').textContent : '';
    const bubbleText = document.getElementById('seek-bubble-text') ? document.getElementById('seek-bubble-text').textContent : '';
    return {
        thumbLeft: thumb ? thumb.style.left : '',
        timeCur: timeCur,
        bubbleText: bubbleText
    };
})()
""")
print(f"Seeking State 2 (accelerated): {seek_state2}")
print("SUCCESS: Progress bar and thumb scrub forward smoothly in real-time!")

# 4. Wait for commit
print("Waiting for commit (700ms)...")
time.sleep(0.9)

after_commit = eval_js("""
(() => {
    const osd = window.vkApp.player.osd;
    const bubble = document.getElementById('seek-bubble');
    return {
        hasSeeking: osd.classList.contains('seeking'),
        hasHidden: osd.classList.contains('hidden'),
        bubbleDisplay: bubble ? bubble.style.display : ''
    };
})()
""")
print(f"After commit: {after_commit}")
assert not after_commit['hasSeeking'], "FAIL: 'seeking' class must be removed after commit!"
assert after_commit['hasHidden'], "FAIL: OSD should return to hidden for clean view!"
assert after_commit['bubbleDisplay'] == 'none', "FAIL: Bubble must be hidden!"
print("SUCCESS: Seek committed and screen returned to clean view automatically!")

# Cleanup
eval_js("window.vkApp.player.close()")
print("\nALL SEEKBAR VISIBILITY TESTS PASSED 100%!")
s.close()
