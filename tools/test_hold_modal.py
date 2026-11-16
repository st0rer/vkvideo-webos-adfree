import socket, base64, os, json, urllib.request, time, sys

sys.stdout.reconfigure(encoding='utf-8')
pages = json.loads(urllib.request.urlopen('http://192.168.1.199:9998/json').read().decode('utf-8'))
ws_url = pages[0]['webSocketDebuggerUrl']
path = ws_url.split(':9998')[-1]
s = socket.socket()
s.connect(('192.168.1.199', 9998))
key = base64.b64encode(os.urandom(16)).decode('ascii')
s.sendall(f'GET {path} HTTP/1.1\r\nHost: 192.168.1.199:9998\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n'.encode('ascii'))
s.recv(4096)

def send_ws(msg):
    raw = json.dumps(msg).encode('utf-8')
    l = len(raw)
    h = bytearray([0x81])
    if l <= 125: h.append(0x80 | l)
    elif l <= 65535: h.append(0x80 | 126); h.extend(l.to_bytes(2, 'big'))
    m = os.urandom(4); h.extend(m)
    s.sendall(h + bytearray([b ^ m[i % 4] for i, b in enumerate(raw)]))

def eval_js(js):
    send_ws({'id': 1, 'method': 'Runtime.evaluate', 'params': {'expression': js, 'returnByValue': True}})
    while True:
        hdr = s.recv(2)
        if not hdr: return None
        pl = hdr[1] & 0x7f
        if pl == 126: pl = int.from_bytes(s.recv(2), 'big')
        elif pl == 127: pl = int.from_bytes(s.recv(8), 'big')
        d = bytearray()
        while len(d) < pl: d.extend(s.recv(min(4096, pl - len(d))))
        res = json.loads(d.decode('utf-8', errors='ignore'))
        if res.get('id') == 1: return res.get('result', {}).get('result', {}).get('value')

# Wait for cards
time.sleep(2)
card_focused = eval_js("""
(() => {
    const card = document.querySelector('.video-card');
    if (!card) return false;
    window.vkApp.nav.setFocus(card);
    return true;
})()
""")
print(f"Card focused: {card_focused}")

# Simulate long press: hold OK for 1000ms with repeat events (exact remote hold behavior)
print("Holding OK key for 1000ms with repeated keydown...")
send_ws({'id': 2, 'method': 'Input.dispatchKeyEvent', 'params': {'type': 'keyDown', 'keyCode': 13, 'windowsVirtualKeyCode': 13}})
time.sleep(0.3)
send_ws({'id': 3, 'method': 'Input.dispatchKeyEvent', 'params': {'type': 'keyDown', 'keyCode': 13, 'windowsVirtualKeyCode': 13, 'repeat': True}})
time.sleep(0.3)
send_ws({'id': 4, 'method': 'Input.dispatchKeyEvent', 'params': {'type': 'keyDown', 'keyCode': 13, 'windowsVirtualKeyCode': 13, 'repeat': True}})
time.sleep(0.4)
send_ws({'id': 5, 'method': 'Input.dispatchKeyEvent', 'params': {'type': 'keyUp', 'keyCode': 13, 'windowsVirtualKeyCode': 13}})

# Check modal right after release
time.sleep(0.1)
state1 = eval_js("""
(() => {
    const m = document.getElementById('video-context-modal');
    return {
        display: m ? m.style.display : 'none',
        focused: window.vkApp.nav.currentFocused ? window.vkApp.nav.currentFocused.id : null,
        isPlayerActive: window.vkApp.player.container.style.display !== 'none'
    };
})()
""")
print(f"Modal state immediately after release: {state1}")
assert state1["display"] == "flex", "Modal should remain open!"
assert not state1["isPlayerActive"], "Player should NOT have been activated!"

# Check modal 1 second later (it should STILL be open and steady, NOT auto-closed!)
time.sleep(1.0)
state2 = eval_js("""
(() => {
    const m = document.getElementById('video-context-modal');
    return {
        display: m ? m.style.display : 'none',
        focused: window.vkApp.nav.currentFocused ? window.vkApp.nav.currentFocused.id : null,
        isPlayerActive: window.vkApp.player.container.style.display !== 'none'
    };
})()
""")
print(f"Modal state 1.0s later (still open): {state2}")
assert state2["display"] == "flex", "Modal should still remain open 1s later!"

# Now deliberately press Down arrow to focus next button, then press OK
print("Pressing Down arrow in modal...")
send_ws({'id': 6, 'method': 'Input.dispatchKeyEvent', 'params': {'type': 'keyDown', 'keyCode': 40, 'windowsVirtualKeyCode': 40}})
send_ws({'id': 7, 'method': 'Input.dispatchKeyEvent', 'params': {'type': 'keyUp', 'keyCode': 40, 'windowsVirtualKeyCode': 40}})
time.sleep(0.2)

state3 = eval_js("window.vkApp.nav.currentFocused ? window.vkApp.nav.currentFocused.id : null")
print(f"Focused after Down: {state3}")

# Close modal cleanly using Back (27)
send_ws({'id': 8, 'method': 'Input.dispatchKeyEvent', 'params': {'type': 'keyDown', 'keyCode': 27, 'windowsVirtualKeyCode': 27}})
send_ws({'id': 9, 'method': 'Input.dispatchKeyEvent', 'params': {'type': 'keyUp', 'keyCode': 27, 'windowsVirtualKeyCode': 27}})
time.sleep(0.2)

state4 = eval_js("document.getElementById('video-context-modal').style.display")
print(f"Modal after Back key: {state4}")
assert state4 == "none", "Modal should close on Back key!"

print("\nSUCCESS: Modal stays open stably during long-press and ignores hold/repeat events!")
s.close()
