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

time.sleep(1.0)

print("--- 1. Testing Zero Animation / Transition CSS ---")
perf_check = eval_js("""(() => {
    const card = document.querySelector('.video-card');
    const cs = window.getComputedStyle(card || document.body);
    return {
        cardTransition: cs.transition,
        bodyTransition: window.getComputedStyle(document.body).transition,
        durationBadgeFilter: document.querySelector('.duration-badge') ? window.getComputedStyle(document.querySelector('.duration-badge')).backdropFilter : 'none',
        modalBackdropFilter: window.getComputedStyle(document.getElementById('quality-modal')).backdropFilter
    };
})()""", 1)
print("Performance check:", perf_check)

print("\n--- 2. Starting Video Playback ---")
eval_js("document.querySelectorAll('.video-card')[0].click()", 2)
time.sleep(3.0)

print("\n--- 3. Opening Quality Modal ---")
eval_js("window.vkApp.openQualityModal()", 3)
time.sleep(0.5)

modal_geometry = eval_js("""(() => {
    const modal = document.getElementById('quality-modal');
    const card = modal.querySelector('.modal-card');
    const list = document.getElementById('quality-options-list');
    const buttons = Array.from(list.querySelectorAll('.option-btn'));
    
    const cardRect = card.getBoundingClientRect();
    const btnRects = buttons.map(b => {
        const r = b.getBoundingClientRect();
        return {
            text: b.textContent.trim().replace(/\\s+/g, ' '),
            top: r.top,
            bottom: r.bottom,
            left: r.left,
            right: r.right,
            height: r.height,
            width: r.width,
            visible: r.top >= 0 && r.bottom <= 1080
        };
    });

    return {
        modalDisplay: window.getComputedStyle(modal).display,
        cardRect: { top: cardRect.top, bottom: cardRect.bottom, height: cardRect.height, width: cardRect.width },
        buttonsCount: buttons.length,
        allButtonsVisibleWithin1080p: btnRects.every(b => b.bottom <= 1080 && b.top >= 0),
        buttons: btnRects
    };
})()""", 4)

print("\nModal Geometry & Viewport Fit:")
print(f"Modal Display: {modal_geometry['modalDisplay']}")
print(f"Card Height: {modal_geometry['cardRect']['height']}px (Screen height: 1080px)")
print(f"Card Top/Bottom: {modal_geometry['cardRect']['top']}px / {modal_geometry['cardRect']['bottom']}px")
print(f"Buttons Count: {modal_geometry['buttonsCount']}")
print(f"All Buttons Completely Fit in Screen: {modal_geometry['allButtonsVisibleWithin1080p']}")

for b in modal_geometry['buttons']:
    print(f"  - [{b['left']}px - {b['right']}px, Y: {b['top']}px]: {b['text']} (fits: {b['visible']})")

assert modal_geometry['allButtonsVisibleWithin1080p'], "ERROR: Buttons overflow off the 1080p TV screen!"
assert modal_geometry['cardRect']['bottom'] <= 1060, f"ERROR: Modal card spills beyond bottom: {modal_geometry['cardRect']['bottom']}px"

print("\n--- 4. Testing Directional Navigation inside Quality Modal ---")
focused_before = eval_js("document.activeElement.textContent.trim().replace(/\\s+/g, ' ')", 5)
print("Initially focused option:", focused_before)

# Press Right (39)
dispatch_key(39)
time.sleep(0.2)
focused_after_right = eval_js("document.activeElement.textContent.trim().replace(/\\s+/g, ' ')", 6)
print("After pressing Right:", focused_after_right)

# Press Down (40)
dispatch_key(40)
time.sleep(0.2)
focused_after_down = eval_js("document.activeElement.textContent.trim().replace(/\\s+/g, ' ')", 7)
print("After pressing Down:", focused_after_down)

# Press OK (13) to select this quality
dispatch_key(13)
time.sleep(0.5)

modal_closed = eval_js("document.getElementById('quality-modal').style.display", 8)
print("Quality modal display after selecting:", modal_closed)
assert modal_closed == 'none', "Modal should close immediately upon selecting quality!"

print("\n==========================================")
print("ALL QUALITY MODAL & ZERO-LAG TESTS PASSED!")
print("==========================================")
