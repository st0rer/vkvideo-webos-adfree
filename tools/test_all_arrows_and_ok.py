import socket
import base64
import os
import json
import time
import urllib.request

# Connect to TV Chrome DevTools
pages = json.loads(urllib.request.urlopen('http://192.168.1.199:9998/json').read().decode('utf-8'))
ws_url = [p['webSocketDebuggerUrl'] for p in pages if 'vkvideo' in p['url']][0]
path = ws_url.split(':9998')[-1]
s = socket.socket()
s.connect(('192.168.1.199', 9998))
key = base64.b64encode(os.urandom(16)).decode('ascii')
s.sendall(f'GET {path} HTTP/1.1\r\nHost: 192.168.1.199:9998\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n'.encode('ascii'))
s.recv(4096)

def send_ws(msg):
    raw = json.dumps(msg).encode('utf-8')
    header = bytearray([0x81, 0x80 | (126 if len(raw) > 125 else len(raw))])
    if len(raw) > 125: header.extend(len(raw).to_bytes(2, 'big'))
    mask = os.urandom(4)
    header.extend(mask)
    s.sendall(header + bytearray([b ^ mask[i % 4] for i, b in enumerate(raw)]))

req_counter = 100
def eval_js(expr):
    global req_counter
    req_counter += 1
    cid = req_counter
    send_ws({'id': cid, 'method': 'Runtime.evaluate', 'params': {'expression': expr, 'returnByValue': True}})
    time.sleep(0.2)
    data = s.recv(16384)
    idx = 0
    while idx < len(data):
        if idx + 2 > len(data): break
        payload_len = data[idx+1] & 0x7f
        idx += 2
        if payload_len == 126:
            payload_len = int.from_bytes(data[idx:idx+2], 'big')
            idx += 2
        payload = data[idx:idx+payload_len]
        idx += payload_len
        try:
            msg = json.loads(payload.decode('utf-8'))
            if msg.get('id') == cid:
                return msg.get('result', {}).get('result', {}).get('value')
        except:
            pass
    return None

def press_key(key_code):
    script = f"""
    (() => {{
        const ev = new KeyboardEvent('keydown', {{
            keyCode: {key_code},
            which: {key_code},
            bubbles: true,
            cancelable: true
        }});
        window.dispatchEvent(ev);
        const cur = window.vkApp.nav.currentFocused;
        const rect = cur ? cur.getBoundingClientRect() : {{}};
        return {{
            id: cur ? (cur.id || cur.dataset.id || cur.dataset.section || '') : '',
            classes: cur ? cur.className : '',
            x: Math.round(rect.left || 0),
            y: Math.round(rect.top || 0),
            w: Math.round(rect.width || 0),
            h: Math.round(rect.height || 0)
        }};
    }})()
    """
    return eval_js(script)

# Make sure we start fresh on Home section and wait for cards to load
print("Initializing Home grid...")
eval_js("window.vkApp.player.close(); window.vkApp.loadSection('home');")
for _ in range(15):
    count = eval_js("document.querySelectorAll('#video-grid .video-card').length")
    if count and count > 0:
        print(f"Loaded {count} video cards.")
        break
    time.sleep(0.3)

# Focus first video card
eval_js("(() => { const first = document.querySelector('#video-grid .video-card'); if (first) window.vkApp.nav.setFocus(first); })()")
time.sleep(0.2)

cur = eval_js("(() => { const c = window.vkApp.nav.currentFocused; const r = c.getBoundingClientRect(); return { id: c.dataset.id, x: Math.round(r.left), y: Math.round(r.top) }; })()")
print("START POSITION: Card [0,0] at", cur)

# 1. Move RIGHT to Card 1
c1 = press_key(39) # Right
print("1. Press RIGHT -> Pos:", (c1['x'], c1['y']), "ID:", c1['id'])
assert c1['x'] > cur['x'], f"Should have moved right: {c1['x']} > {cur['x']}"

# 2. Move RIGHT to Card 2
c2 = press_key(39) # Right
print("2. Press RIGHT -> Pos:", (c2['x'], c2['y']), "ID:", c2['id'])
assert c2['x'] > c1['x'], f"Should have moved right: {c2['x']} > {c1['x']}"

# 3. Move DOWN to Card in row 2
c3 = press_key(40) # Down
print("3. Press DOWN  -> Pos:", (c3['x'], c3['y']), "ID:", c3['id'])
assert c3['y'] > c2['y'], f"Should have moved down: {c3['y']} > {c2['y']}"

# 4. Move LEFT in row 2
c4 = press_key(37) # Left
print("4. Press LEFT  -> Pos:", (c4['x'], c4['y']), "ID:", c4['id'])
assert c4['x'] < c3['x'], f"Should have moved left: {c4['x']} < {c3['x']}"

# 5. Move UP back to row 1
c5 = press_key(38) # Up
print("5. Press UP    -> Pos:", (c5['x'], c5['y']), "ID:", c5['id'])
assert c5['y'] < c4['y'], f"Should have moved up: {c5['y']} < {c4['y']}"

# 6. Move all the way LEFT to Sidebar
press_key(37)
press_key(37)
s_nav = press_key(37)
print("6. Move LEFT into Sidebar -> Pos:", (s_nav['x'], s_nav['y']), "ID:", s_nav['id'], "Classes:", s_nav['classes'])
assert 'nav-item' in s_nav['classes'], "Should be focused on a sidebar nav-item"

# 7. Move DOWN in Sidebar to 'Категории'
s_cats = press_key(40)
print("7. Move DOWN in Sidebar to Categories -> ID:", s_cats['id'], "Classes:", s_cats['classes'])

# 8. Press CENTER (OK) on 'Категории'
print("\n--- Testing OK (Center) key ---")
press_key(13) # OK
time.sleep(0.5)
sec_info = eval_js("({ section: window.vkApp.currentSection, title: document.querySelector('.section-title').textContent })")
print("8. Activated section via OK button:", sec_info)
assert sec_info['section'] == 'categories', "Should have switched to categories section"

# 10. Test D-Pad inside Categories Grid
cat_c1 = eval_js("(() => { const c = window.vkApp.nav.currentFocused; const r = c.getBoundingClientRect(); return { id: c.dataset.cat, text: c.id, x: Math.round(r.left), y: Math.round(r.top) }; })()")
print("10. Initial Category Focus: ID:", cat_c1.get('id'), "Pos:", (cat_c1.get('x'), cat_c1.get('y')))

cat_c2 = press_key(39) # Right
print("11. Category RIGHT -> Pos:", (cat_c2['x'], cat_c2['y']), "ID:", cat_c2['id'])
assert cat_c2['x'] > cat_c1['x'], "Should have moved right to next category"

cat_c3 = press_key(40) # Down
print("12. Category DOWN  -> Pos:", (cat_c3['x'], cat_c3['y']), "ID:", cat_c3['id'])
assert cat_c3['y'] > cat_c2['y'], "Should have moved down in category grid"

# 11. Test OK button on category to load videos of that category
print("13. Press OK on Category card to open category videos...")
press_key(13) # OK
time.sleep(1.2)
cat_grid = eval_js("({ title: document.querySelector('.section-title').textContent, cardsCount: document.querySelectorAll('.video-card').length, focusedTag: window.vkApp.nav.currentFocused ? window.vkApp.nav.currentFocused.tagName : null })")
print("14. Category Opened:", cat_grid)
assert cat_grid['cardsCount'] > 0, "Category should display videos"

# 12. Return Home
eval_js("window.vkApp.loadSection('home');")
time.sleep(0.5)
print("\n[SUCCESS] All D-Pad Directions (Up, Down, Left, Right) and Center OK Key verified 100% functional on LG C1 TV!")

s.close()
