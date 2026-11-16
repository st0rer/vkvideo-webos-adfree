import socket
import base64
import os
import json
import time
import urllib.request

# 1. Connect to Chrome DevTools on TV
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
resp = s.recv(4096)
print("Handshake established with LG webOS Chromium!")

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

def read_ws():
    res = b""
    s.settimeout(3.0)
    try:
        while True:
            chunk = s.recv(65536)
            if not chunk: break
            res += chunk
            if b'"id":' in res:
                break
    except socket.timeout:
        pass
    
    # Simple parse frames
    messages = []
    idx = 0
    while idx < len(res):
        if idx + 2 > len(res): break
        b1 = res[idx]
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
            messages.append(json.loads(payload.decode('utf-8', errors='ignore')))
        except:
            pass
        idx += header_len + payload_len
    return messages

def eval_js(expr, req_id):
    send_ws({'id': req_id, 'method': 'Runtime.evaluate', 'params': {'expression': expr, 'returnByValue': True, 'awaitPromise': True}})
    time.sleep(1.0)
    msgs = read_ws()
    for m in msgs:
        if m.get('id') == req_id:
            return m.get('result', {}).get('result', {}).get('value')
    return None

print("\n--- TEST 1: Inspect Home Feed ---")
home_info = eval_js("""
(() => {
    const cards = Array.from(document.querySelectorAll('.video-card'));
    return {
        section: window.vkApp ? window.vkApp.currentSection : null,
        cardCount: cards.length,
        cards: cards.slice(0, 4).map(c => ({
            id: c.dataset.id,
            title: c.querySelector('.card-title') ? c.querySelector('.card-title').textContent : '',
            author: c.querySelector('.card-author') ? c.querySelector('.card-author').textContent : '',
            thumb: c.querySelector('.card-thumb') ? c.querySelector('.card-thumb').src : '',
            duration: c.querySelector('.duration-badge') ? c.querySelector('.duration-badge').textContent : '',
            badges: Array.from(c.querySelectorAll('.card-badges-row span')).map(s => s.textContent)
        }))
    };
})()
""", 101)
print(json.dumps(home_info, ensure_ascii=False, indent=2))

print("\n--- TEST 2: Navigate to Categories ---")
eval_js("window.vkApp.loadSection('categories')", 102)
time.sleep(1.5)

cat_info = eval_js("""
(() => {
    const catCards = Array.from(document.querySelectorAll('.cat-card'));
    return {
        section: window.vkApp.currentSection,
        categoriesCount: catCards.length,
        categories: catCards.map(c => ({
            id: c.dataset.cat,
            title: c.textContent.trim()
        }))
    };
})()
""", 103)
print(json.dumps(cat_info, ensure_ascii=False, indent=2))

print("\n--- TEST 3: Click 'movies' Category ---")
eval_js("document.querySelector('.cat-card[data-cat=\"movies\"]').click()", 104)
time.sleep(3.0)

movies_info = eval_js("""
(() => {
    const cards = Array.from(document.querySelectorAll('#video-grid .video-card'));
    return {
        headerTitle: document.querySelector('.section-title') ? document.querySelector('.section-title').textContent : '',
        cardCount: cards.length,
        cards: cards.slice(0, 4).map(c => ({
            id: c.dataset.id,
            title: c.querySelector('.card-title') ? c.querySelector('.card-title').textContent : '',
            author: c.querySelector('.card-author') ? c.querySelector('.card-author').textContent : '',
            thumb: c.querySelector('.card-thumb') ? c.querySelector('.card-thumb').src : '',
            duration: c.querySelector('.duration-badge') ? c.querySelector('.duration-badge').textContent : '',
            badges: Array.from(c.querySelectorAll('.card-badges-row span')).map(s => s.textContent)
        }))
    };
})()
""", 105)
print(json.dumps(movies_info, ensure_ascii=False, indent=2))

print("\n--- TEST 4: Click 'games' Category ---")
eval_js("window.vkApp.loadSection('categories')", 106)
time.sleep(1.0)
eval_js("document.querySelector('.cat-card[data-cat=\"games\"]').click()", 107)
time.sleep(3.0)

games_info = eval_js("""
(() => {
    const cards = Array.from(document.querySelectorAll('#video-grid .video-card'));
    return {
        headerTitle: document.querySelector('.section-title') ? document.querySelector('.section-title').textContent : '',
        cardCount: cards.length,
        cards: cards.slice(0, 4).map(c => ({
            id: c.dataset.id,
            title: c.querySelector('.card-title') ? c.querySelector('.card-title').textContent : '',
            author: c.querySelector('.card-author') ? c.querySelector('.card-author').textContent : '',
            thumb: c.querySelector('.card-thumb') ? c.querySelector('.card-thumb').src : '',
            duration: c.querySelector('.duration-badge') ? c.querySelector('.duration-badge').textContent : '',
            badges: Array.from(c.querySelectorAll('.card-badges-row span')).map(s => s.textContent)
        }))
    };
})()
""", 108)
print(json.dumps(games_info, ensure_ascii=False, indent=2))

print("\n--- TEST 5: Click a video from Games to test Playback ---")
eval_js("document.querySelector('#video-grid .video-card').click()", 109)
time.sleep(4.0)

player_info = eval_js("""
(() => {
    const p = window.vkApp.player;
    const v = p ? p.video : null;
    return {
        isPlayerVisible: p ? p.container.style.display !== 'none' : false,
        videoTitle: document.getElementById('osd-video-title') ? document.getElementById('osd-video-title').textContent : '',
        channel: document.getElementById('osd-video-channel') ? document.getElementById('osd-video-channel').textContent : '',
        activeQuality: document.getElementById('osd-active-quality') ? document.getElementById('osd-active-quality').textContent : '',
        paused: v ? v.paused : null,
        currentTime: v ? v.currentTime : null,
        duration: v ? v.duration : null,
        readyState: v ? v.readyState : null,
        videoSrc: v ? v.src : null,
        hlsLevels: (p && p.hls) ? p.hls.levels.length : 0
    };
})()
""", 110)
print(json.dumps(player_info, ensure_ascii=False, indent=2))

# Close player to return to clean UI
eval_js("window.vkApp.player.close()", 111)
s.close()
print("\nAll live CDP tests completed!")
