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

def eval_js(expr, req_id, timeout=4.0):
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
            
            total_len = header_len + payload_len
            if idx + total_len > len(buffer): break
            
            payload = buffer[idx+header_len : idx+total_len]
            idx += total_len
            try:
                msg = json.loads(payload.decode('utf-8', errors='ignore'))
                if msg.get('id') == req_id:
                    return msg.get('result', {}).get('result', {}).get('value')
            except:
                pass
    return None

def dispatch_key(keycode):
    eval_js(f"window.dispatchEvent(new KeyboardEvent('keydown', {{keyCode: {keycode}, which: {keycode}, bubbles: true}}))", 999)

print("--- 1. Checking Initial App State ---")
state = eval_js("""({
    appDisplay: document.getElementById('app').style.display || window.getComputedStyle(document.getElementById('app')).display,
    playerDisplay: document.getElementById('player-container').style.display,
    videoCardsCount: document.querySelectorAll('.video-card').length
})""", 1)
print("Initial state:", state)

print("\n--- 2. Starting Video Playback ---")
play_res = eval_js("""(async () => {
    const cards = document.querySelectorAll('.video-card');
    if (cards.length > 0) {
        cards[0].click();
        return 'Card clicked';
    }
    return 'No cards found';
})()""", 2)
print("Play trigger:", play_res)

time.sleep(3.0)

print("\n--- 3. Verifying Player Screen Isolation (#app hidden) ---")
isolation = eval_js("""({
    appDisplay: document.getElementById('app').style.display,
    playerDisplay: document.getElementById('player-container').style.display,
    videoPaused: document.getElementById('native-player').paused,
    videoTime: document.getElementById('native-player').currentTime,
    centerBadgeExists: !!document.getElementById('player-center-badge'),
    osdHidden: document.getElementById('player-osd').classList.contains('hidden'),
    activeFocus: document.activeElement ? (document.activeElement.id || document.activeElement.className) : null
})""", 3)
print("Player isolation check:", isolation)
assert isolation['appDisplay'] == 'none', f"Expected #app display to be 'none', got {isolation['appDisplay']}"
assert not isolation['centerBadgeExists'], "Center badge overlay should not exist in DOM!"

print("\n--- 4. Testing Pause via OK Remote Button ---")
# Dispatch OK (Enter / KeyCode 13)
dispatch_key(13)
time.sleep(0.5)

pause_state = eval_js("""({
    videoPaused: document.getElementById('native-player').paused,
    osdHidden: document.getElementById('player-osd').classList.contains('hidden'),
    playBtnText: document.getElementById('play-btn-text').textContent,
    activeFocus: document.activeElement ? document.activeElement.id : null
})""", 4)
print("State after pause via OK:", pause_state)
assert pause_state['videoPaused'] is True, "Video should be paused!"
assert not pause_state['osdHidden'], "OSD should be visible immediately upon pause!"
assert pause_state['activeFocus'] == 'btn-play-pause', f"btn-play-pause should be focused, got {pause_state['activeFocus']}"

print("\n--- 5. Testing Down Key (Dismiss OSD on Pause) ---")
# Press Down key (40) - should hide OSD immediately so frame can be inspected
dispatch_key(40)
time.sleep(0.3)

down_state = eval_js("""({
    videoPaused: document.getElementById('native-player').paused,
    osdHidden: document.getElementById('player-osd').classList.contains('hidden')
})""", 5)
print("State after Down key:", down_state)
assert down_state['osdHidden'] is True, "OSD should be hidden when Down is pressed on buttons!"

print("\n--- 6. Testing Unpause via OK Remote Button ---")
# Press OK (13) while paused and OSD is hidden -> should instantly resume playback!
dispatch_key(13)
time.sleep(1.0)

resume_state = eval_js("""({
    videoPaused: document.getElementById('native-player').paused,
    playBtnText: document.getElementById('play-btn-text').textContent
})""", 6)
print("State after OK unpause:", resume_state)
assert resume_state['videoPaused'] is False, "Video should be resumed (playing)!"

print("\n--- 7. Testing Up Key (Wake OSD) and Auto-Fade ---")
# Press Up key (38) while playing
dispatch_key(38)
time.sleep(0.3)
up_state = eval_js("document.getElementById('player-osd').classList.contains('hidden')", 7)
print("OSD visible after Up key:", not up_state)
assert not up_state, "OSD should become visible on Up key!"

print("\n--- 8. Testing Close Player and Return to Home Screen ---")
eval_js("window.vkApp.player.close()", 8)
time.sleep(0.5)

close_state = eval_js("""({
    appDisplay: document.getElementById('app').style.display,
    playerDisplay: document.getElementById('player-container').style.display,
    activeFocus: document.activeElement ? (document.activeElement.id || document.activeElement.className) : null
})""", 9)
print("State after close:", close_state)
assert close_state['appDisplay'] == 'flex', f"Expected #app display to be 'flex', got {close_state['appDisplay']}"
assert close_state['playerDisplay'] == 'none', "Player container should be hidden!"

print("\n==========================================")
print("ALL LIVE TV PLAYER UX/UI TESTS PASSED 100%!")
print("==========================================")
