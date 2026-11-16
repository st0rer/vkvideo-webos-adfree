import socket
import base64
import os
import json
import time
import urllib.request

# Connect to Chrome DevTools on TV
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

req_counter = 1
def eval_js(expr):
    global req_counter
    req_counter += 1
    cid = req_counter
    send_ws({'id': cid, 'method': 'Runtime.evaluate', 'params': {'expression': expr, 'returnByValue': True}})
    time.sleep(0.3)
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
        return {{
            tag: cur ? cur.tagName : null,
            id: cur ? cur.id : null,
            classes: cur ? cur.className : null,
            text: cur ? (cur.textContent || '').trim().slice(0, 30) : null,
            sidebarExpanded: document.getElementById('sidebar').classList.contains('expanded')
        }};
    }})()
    """
    return eval_js(script)

print("Starting Comprehensive Spatial Navigation Test Suite on LG C1 TV...\n")

# Ensure player is closed, start on Home
eval_js("window.vkApp.player.close(); window.vkApp.loadSection('home');")
time.sleep(0.5)

# Step 1: Check initial focus
status = eval_js("(() => { const c = window.vkApp.nav.currentFocused; return { id: c ? c.id : null, class: c ? c.className : null }; })()")
print("1. Initial state focus:", status)

# Step 2: D-Pad Right in grid
print("\n--- Testing Grid D-Pad Navigation ---")
r1 = press_key(39) # Right
print("2. Press RIGHT -> Focused:", r1['classes'], "| Text:", r1['text'])

r2 = press_key(39) # Right
print("3. Press RIGHT -> Focused:", r2['classes'], "| Text:", r2['text'])

d1 = press_key(40) # Down to row 2
print("4. Press DOWN -> Focused:", d1['classes'], "| Text:", d1['text'])

u1 = press_key(38) # Up back to row 1
print("5. Press UP -> Focused:", u1['classes'], "| Text:", u1['text'])

# Step 3: D-Pad Left to Sidebar
print("\n--- Testing Navigation to Sidebar & Auto-Expand ---")
press_key(37) # Left
press_key(37) # Left
s1 = press_key(37) # Left to Sidebar
print("6. Press LEFT into Sidebar -> Focused:", s1['classes'], "| Text:", s1['text'])
print("   Sidebar expanded:", s1['sidebarExpanded'])

s_down = press_key(40) # Down in sidebar
print("7. Press DOWN in Sidebar -> Focused:", s_down['text'])

s_down2 = press_key(40) # Down to Categories
print("8. Press DOWN to Categories -> Focused:", s_down2['text'])

# Step 4: Press OK (Enter) on Categories
print("\n--- Testing OK (Center) Button on Categories ---")
press_key(13) # OK
time.sleep(0.5)
cat_status = eval_js("(() => { return { section: window.vkApp.currentSection, title: document.querySelector('.section-title').textContent, cardsCount: document.querySelectorAll('.cat-card').length }; })()")
print("9. Categories Opened:", cat_status)

# Step 5: Test Navigation inside Categories Grid
print("\n--- Testing Navigation inside Categories Grid ---")
c_right = press_key(39) # Right
print("10. In Categories: Press RIGHT -> Focused:", c_right['text'])
c_down = press_key(40) # Down
print("11. In Categories: Press DOWN -> Focused:", c_down['text'])

# Step 6: Test Search Section & Virtual Keyboard Navigation
print("\n--- Testing Search Section & Virtual TV Keyboard ---")
eval_js("window.vkApp.loadSection('search');")
time.sleep(0.5)
kb_init = eval_js("(() => { const c = window.vkApp.nav.currentFocused; return { id: c ? c.id : null, text: c ? c.textContent.trim() : null, isKey: c && c.classList.contains('kb-key') }; })()")
print("12. Search Keyboard initial focus:", kb_init)

kb_r = press_key(39) # Right on keyboard
print("13. Keyboard: Press RIGHT -> Focused key:", kb_r['text'])
kb_d = press_key(40) # Down on keyboard
print("14. Keyboard: Press DOWN -> Focused key:", kb_d['text'])
kb_l = press_key(37) # Left on keyboard
print("15. Keyboard: Press LEFT -> Focused key:", kb_l['text'])

# Step 7: Test Login Modal (QR) and Focus Trap
print("\n--- Testing Modal Focus Trap (QR Login) ---")
eval_js("window.vkApp.openLoginQR();")
time.sleep(0.5)
modal_init = eval_js("(() => { const c = window.vkApp.nav.currentFocused; return { modalOpen: window.vkApp.isModalOpen(), focusedId: c ? c.id : null }; })()")
print("16. QR Modal Opened:", modal_init)

# Press Back key (461) to close modal
print("\n--- Testing Back Key (461) to Close Modal ---")
back_res = press_key(461) # Back
time.sleep(0.3)
modal_closed = eval_js("(() => { return { modalOpen: window.vkApp.isModalOpen(), focusedText: window.vkApp.nav.currentFocused ? window.vkApp.nav.currentFocused.textContent.trim() : null }; })()")
print("17. After Back Key -> Modal Open:", modal_closed['modalOpen'], "| Focused:", modal_closed['focusedText'])

# Step 8: Return Home and Verify Ready
eval_js("window.vkApp.loadSection('home');")
time.sleep(0.5)
final_focus = eval_js("(() => { const c = window.vkApp.nav.currentFocused; return { tag: c ? c.tagName : null, text: c ? c.querySelector('.card-title') ? c.querySelector('.card-title').textContent : c.textContent.trim().slice(0, 30) : null }; })()")
print("\n=== FINAL STATUS ===")
print("Navigation returned to Home grid. Focused card:", final_focus)

s.close()
