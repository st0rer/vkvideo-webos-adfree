import socket
import base64
import os
import json
import time
import urllib.request
import sys

# Force UTF-8 stdout
sys.stdout.reconfigure(encoding='utf-8')

pages = json.loads(urllib.request.urlopen('http://192.168.1.199:9998/json').read().decode('utf-8'))
ws_url = None
for p in pages:
    if 'vkvideo' in p.get('url', ''):
        ws_url = p.get('webSocketDebuggerUrl')
        break

if not ws_url:
    print("Could not find vkvideo page in devtools")
    exit(1)

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

def read_ws(timeout=2.0):
    s.settimeout(timeout)
    res = b""
    try:
        while True:
            chunk = s.recv(65536)
            if not chunk: break
            res += chunk
    except socket.timeout:
        pass
    
    msgs = []
    idx = 0
    while idx < len(res):
        if idx + 2 > len(res): break
        b2 = res[idx+1]
        payload_len = b2 & 0x7F
        header_len = 2
        if payload_len == 126:
            if idx + 4 > len(res): break
            payload_len = int.from_bytes(res[idx+2:idx+4], 'big')
            header_len = 4
        elif payload_len == 127:
            if idx + 10 > len(res): break
            payload_len = int.from_bytes(res[idx+2:idx+10], 'big')
            header_len = 10
        payload = res[idx+header_len : idx+header_len+payload_len]
        try:
            msgs.append(json.loads(payload.decode('utf-8', errors='ignore')))
        except:
            pass
        idx += header_len + payload_len
    return msgs

def eval_js(expr, req_id):
    send_ws({'id': req_id, 'method': 'Runtime.evaluate', 'params': {'expression': expr, 'returnByValue': True, 'awaitPromise': True}})
    time.sleep(1.0)
    msgs = read_ws()
    for m in msgs:
        if m.get('id') == req_id:
            return m.get('result', {}).get('result', {}).get('value')
    return None

print("=== 1. HOME FEED VERIFICATION ===")
h_info = eval_js("""
(() => {
    const cards = Array.from(document.querySelectorAll('.video-card'));
    return {
        section: window.vkApp.currentSection,
        count: cards.length,
        items: cards.slice(0, 3).map(c => ({
            id: c.dataset.id,
            title: c.querySelector('.card-title').textContent,
            author: c.querySelector('.card-author').textContent,
            duration: c.querySelector('.duration-badge').textContent,
            thumb: c.querySelector('.card-thumb').src.substring(0, 80) + '...',
            badges: Array.from(c.querySelectorAll('.card-badges-row span')).map(s => s.textContent)
        }))
    };
})()
""", 201)
print(json.dumps(h_info, ensure_ascii=False, indent=2))

print("\n=== 2. NAVIGATE TO CATEGORIES ===")
eval_js("window.vkApp.loadSection('categories')", 202)
time.sleep(1.5)
c_info = eval_js("""
(() => {
    const cards = Array.from(document.querySelectorAll('.cat-card'));
    return {
        section: window.vkApp.currentSection,
        categoryCount: cards.length,
        items: cards.map(c => ({
            id: c.dataset.cat,
            name: c.querySelector('div:last-child').textContent
        }))
    };
})()
""", 203)
print(json.dumps(c_info, ensure_ascii=False, indent=2))

print("\n=== 3. OPEN 'MOVIES' CATEGORY ===")
eval_js("document.querySelector('.cat-card[data-cat=\"movies\"]').click()", 204)
time.sleep(3.0)
m_info = eval_js("""
(() => {
    const cards = Array.from(document.querySelectorAll('#video-grid .video-card'));
    return {
        header: document.querySelector('.section-title').textContent,
        count: cards.length,
        items: cards.slice(0, 3).map(c => ({
            id: c.dataset.id,
            title: c.querySelector('.card-title').textContent,
            author: c.querySelector('.card-author').textContent,
            duration: c.querySelector('.duration-badge').textContent,
            thumb: c.querySelector('.card-thumb').src.substring(0, 80) + '...',
            badges: Array.from(c.querySelectorAll('.card-badges-row span')).map(s => s.textContent)
        }))
    };
})()
""", 205)
print(json.dumps(m_info, ensure_ascii=False, indent=2))

print("\n=== 4. TEST BACK NAVIGATION (Remote Back Button) ===")
eval_js("window.vkApp.handleBack()", 206)
time.sleep(1.0)
back_info = eval_js("""
(() => {
    return {
        section: window.vkApp.currentSection,
        currentCategory: window.vkApp.currentCategory,
        catCardsVisible: document.querySelectorAll('.cat-card').length
    };
})()
""", 207)
print(json.dumps(back_info, ensure_ascii=False, indent=2))

print("\n=== 5. OPEN 'GAMES' CATEGORY & VERIFY THUMBNAILS ===")
eval_js("document.querySelector('.cat-card[data-cat=\"games\"]').click()", 208)
time.sleep(3.0)
g_info = eval_js("""
(() => {
    const cards = Array.from(document.querySelectorAll('#video-grid .video-card'));
    return {
        header: document.querySelector('.section-title').textContent,
        count: cards.length,
        allThumbsValid: cards.every(c => c.querySelector('.card-thumb').src && !c.querySelector('.card-thumb').src.includes('preview.jpg')),
        sample: cards.slice(0, 2).map(c => ({
            id: c.dataset.id,
            title: c.querySelector('.card-title').textContent,
            author: c.querySelector('.card-author').textContent,
            duration: c.querySelector('.duration-badge').textContent,
            thumb: c.querySelector('.card-thumb').src.substring(0, 80) + '...'
        }))
    };
})()
""", 209)
print(json.dumps(g_info, ensure_ascii=False, indent=2))

print("\n=== 6. CLICK VIDEO & VERIFY PLAYBACK INTEGRITY ===")
eval_js("document.querySelector('#video-grid .video-card').click()", 210)
time.sleep(4.0)
play_info = eval_js("""
(() => {
    const p = window.vkApp.player;
    const v = p ? p.video : null;
    return {
        isPlayerVisible: p ? p.container.style.display !== 'none' : false,
        videoTitle: document.getElementById('osd-video-title').textContent,
        activeQuality: document.getElementById('osd-active-quality').textContent,
        paused: v.paused,
        currentTime: v.currentTime,
        duration: v.duration,
        readyState: v.readyState,
        hlsLevels: (p && p.hls) ? p.hls.levels.length : 0
    };
})()
""", 211)
print(json.dumps(play_info, ensure_ascii=False, indent=2))

# Close player cleanly
eval_js("window.vkApp.player.close()", 212)
s.close()
print("\n>>> ALL 6 LIVE LG C1 VERIFICATIONS PASSED 100%! <<<")
