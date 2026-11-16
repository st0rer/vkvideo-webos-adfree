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

time.sleep(1.0)

print("\n--- TEST: BI-DIRECTIONAL ACCELERATED SEEKING (FORWARD & BACKWARD) ---")

# Clear saved watch progress
eval_js("""
try {
    localStorage.removeItem('vk_watch_progress');
} catch(e) {}
""")

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

# Wait until playback is actively running and progressing
print("Waiting for video stream to initialize and play...")
last_time = -1
for i in range(25):
    time.sleep(1)
    status = eval_js("""
    (() => {
        const p = window.vkApp.player;
        if (!p || !p.video) return null;
        return {
            cur: p.video.currentTime || 0,
            dur: p.getDuration() || 0,
            readyState: p.video.readyState,
            isPlaying: p.isPlaying,
            paused: p.video.paused
        };
    })()
    """)
    if status and status['readyState'] >= 3 and not status['paused'] and status['cur'] > 0.5:
        if last_time > 0 and status['cur'] > last_time:
            print(f"Video is stably playing at {status['cur']:.1f}s / {status['dur']:.1f}s (readyState={status['readyState']})")
            break
        last_time = status['cur']

# Ensure OSD is hidden initially for clean scrubbing
eval_js("window.vkApp.player.hideOSD()")
time.sleep(0.5)

base_info = eval_js("""
(() => {
    const p = window.vkApp.player;
    return {
        cur: p.video.currentTime || 0,
        dur: p.getDuration() || 0
    };
})()
""")
print(f"Base video state: currentTime={base_info['cur']:.1f}s, duration={base_info['dur']:.1f}s")
base_cur = base_info['cur']

def press_key(key_code):
    send_ws({'id': 100, 'method': 'Input.dispatchKeyEvent', 'params': {'type': 'keyDown', 'keyCode': key_code, 'windowsVirtualKeyCode': key_code}})
    send_ws({'id': 101, 'method': 'Input.dispatchKeyEvent', 'params': {'type': 'keyUp', 'keyCode': key_code, 'windowsVirtualKeyCode': key_code}})

def get_seek_info():
    return eval_js("""
    (() => {
        const p = window.vkApp.player;
        return {
            isSeeking: p.isSeeking,
            seekTargetTime: p.seekTargetTime,
            seekStreak: p.seekStreak,
            seekDirection: p.seekDirection,
            bubbleText: document.getElementById('seek-bubble-text') ? document.getElementById('seek-bubble-text').textContent : '',
            thumbLeft: document.getElementById('progress-thumb') ? document.getElementById('progress-thumb').style.left : ''
        };
    })()
    """)

# Step 1: Forward seek (Right key 39)
print("\n[Step 1] Press RIGHT (Forward #1)...")
press_key(39)
time.sleep(0.1)
s1 = get_seek_info()
print(f"  Seek info: target={s1['seekTargetTime']:.1f}s, streak={s1['seekStreak']}, bubble={s1['bubbleText']}, thumb={s1['thumbLeft']}")
assert s1['isSeeking'], "Should be in seeking mode"
assert s1['seekStreak'] == 1, "Streak should be 1"
t1 = s1['seekTargetTime']

# Step 2: Forward seek again (Right key 39)
print("\n[Step 2] Press RIGHT (Forward #2, rapid)...")
time.sleep(0.15)
press_key(39)
time.sleep(0.1)
s2 = get_seek_info()
print(f"  Seek info: target={s2['seekTargetTime']:.1f}s, streak={s2['seekStreak']}, bubble={s2['bubbleText']}")
assert s2['seekStreak'] == 2, f"Streak should be 2, got {s2['seekStreak']}"
assert s2['seekTargetTime'] > t1, f"Target time should advance: {s2['seekTargetTime']} > {t1}"
t2 = s2['seekTargetTime']

# Step 3: Forward seek third time (Right key 39)
print("\n[Step 3] Press RIGHT (Forward #3, rapid)...")
time.sleep(0.15)
press_key(39)
time.sleep(0.1)
s3 = get_seek_info()
print(f"  Seek info: target={s3['seekTargetTime']:.1f}s, streak={s3['seekStreak']}, bubble={s3['bubbleText']}")
assert s3['seekStreak'] == 3
assert s3['seekTargetTime'] > t2
t3 = s3['seekTargetTime']
print(f"  Total scrubbed forward to: {t3:.1f}s")

# Step 4: REVERSE DIRECTION - Immediately press LEFT (Backward #1)
print("\n[Step 4] REVERSING: Press LEFT (Backward #1) while scrubbed ahead...")
time.sleep(0.15)
press_key(37) # Left arrow
time.sleep(0.1)
s4 = get_seek_info()
print(f"  Seek info: target={s4['seekTargetTime']:.1f}s, streak={s4['seekStreak']}, bubble={s4['bubbleText']}")
# CRITICAL CHECK: Target should decrease smoothly by ~10s from t3, NOT jump backwards to currentTime-10s!
diff = t3 - s4['seekTargetTime']
print(f"  Difference (t3 - t4): {diff:.1f}s (expected ~10s)")
assert 9.0 <= diff <= 11.0, f"FAIL: Glitched seek! Expected decrease by 10s, got {diff:.1f}s!"
assert s4['seekStreak'] == 1, f"Streak should reset to 1 on direction change, got {s4['seekStreak']}"
assert s4['seekDirection'] == -1, f"Direction should be -1"
t4 = s4['seekTargetTime']

# Step 5: Press LEFT again (Backward #2)
print("\n[Step 5] Press LEFT again (Backward #2, rapid)...")
time.sleep(0.15)
press_key(37)
time.sleep(0.1)
s5 = get_seek_info()
print(f"  Seek info: target={s5['seekTargetTime']:.1f}s, streak={s5['seekStreak']}, bubble={s5['bubbleText']}")
diff2 = t4 - s5['seekTargetTime']
print(f"  Difference (t4 - t5): {diff2:.1f}s (expected ~20s due to streak 2)")
assert 19.0 <= diff2 <= 21.0, f"Expected 20s decrease, got {diff2:.1f}s"
t5 = s5['seekTargetTime']

# Step 6: REVERSE AGAIN - Press RIGHT (Forward #1)
print("\n[Step 6] REVERSING BACK TO RIGHT (Forward)...")
time.sleep(0.15)
press_key(39)
time.sleep(0.1)
s6 = get_seek_info()
print(f"  Seek info: target={s6['seekTargetTime']:.1f}s, streak={s6['seekStreak']}, bubble={s6['bubbleText']}")
diff3 = s6['seekTargetTime'] - t5
print(f"  Difference (t6 - t5): {diff3:.1f}s (expected ~10s forward)")
assert 9.0 <= diff3 <= 11.0, f"Expected 10s step forward, got {diff3:.1f}s"
t6 = s6['seekTargetTime']

# Step 7: Instant commit via OK/Enter
print(f"\n[Step 7] Commit instantly via OK/Enter (target {t6:.1f}s)...")
press_key(13)
time.sleep(1.2) # Allow decoder to complete seek

final_info = eval_js("""
(() => {
    const p = window.vkApp.player;
    return {
        isSeeking: p.isSeeking,
        curTime: p.video.currentTime,
        osdHidden: p.osd.classList.contains('hidden'),
        bubbleDisplay: document.getElementById('seek-bubble') ? document.getElementById('seek-bubble').style.display : ''
    };
})()
""")
print(f"Final state: currentTime={final_info['curTime']:.1f}s (target was {t6:.1f}s), isSeeking={final_info['isSeeking']}, bubble={final_info['bubbleDisplay']}")
assert not final_info['isSeeking'], "Seek should be committed and isSeeking false"
assert abs(final_info['curTime'] - t6) < 4.0, f"Video currentTime should be close to committed target {t6}, got {final_info['curTime']}"
assert final_info['bubbleDisplay'] == 'none', "Seek bubble must be hidden"

# Step 8: Auto-commit test (without pressing OK)
print("\n[Step 8] Testing automatic commit after 650ms timeout...")
press_key(39) # Seek +10s
s_auto1 = get_seek_info()
print(f"  Auto seek target: {s_auto1['seekTargetTime']:.1f}s")
target_auto = s_auto1['seekTargetTime']

print("  Waiting 1.5s for automatic commit...")
time.sleep(1.5)

final_auto = eval_js("""
(() => {
    const p = window.vkApp.player;
    return {
        isSeeking: p.isSeeking,
        curTime: p.video.currentTime,
        bubbleDisplay: document.getElementById('seek-bubble') ? document.getElementById('seek-bubble').style.display : ''
    };
})()
""")
print(f"Auto-commit state: currentTime={final_auto['curTime']:.1f}s (target was {target_auto:.1f}s), isSeeking={final_auto['isSeeking']}, bubble={final_auto['bubbleDisplay']}")
assert not final_auto['isSeeking'], "Auto commit should clear isSeeking"
assert abs(final_auto['curTime'] - target_auto) < 4.0, f"Auto-commit time should match target {target_auto}, got {final_auto['curTime']}"
assert final_auto['bubbleDisplay'] == 'none', "Seek bubble must be hidden"

# Clean up
eval_js("window.vkApp.player.close()")
print("\n=== ALL BI-DIRECTIONAL SEEK TESTS PASSED 100% PERFECTLY! ===")
s.close()
