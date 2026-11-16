import urllib.request
import json
import asyncio
import websockets

async def inspect():
    # 1. Discover CDP endpoints
    req = urllib.request.urlopen("http://192.168.1.199:9998/json")
    targets = json.loads(req.read().decode())
    print("Found targets:")
    app_target = None
    for t in targets:
        print(f"  [{t.get('type')}] {t.get('title')} - {t.get('url')}")
        if "org.webosbrew.vkvideo.adfree" in t.get('url', ''):
            app_target = t

    if not app_target:
        print("ERROR: app target not found on port 9998")
        return

    ws_url = app_target['webSocketDebuggerUrl']
    print(f"Connecting to CDP: {ws_url}...")

    async with websockets.connect(ws_url) as ws:
        # Enable console and runtime
        await ws.send(json.dumps({"id": 1, "method": "Runtime.enable"}))
        await ws.send(json.dumps({"id": 2, "method": "Console.enable"}))
        await asyncio.sleep(2.0)

        # Evaluate state of the app
        script = """
        (() => {
            const grid = document.getElementById('video-grid');
            const cards = grid ? Array.from(grid.querySelectorAll('.video-card')) : [];
            const header = document.querySelector('.section-header');
            return {
                section: window.vkApp ? window.vkApp.currentSection : 'unknown',
                cardCount: cards.length,
                headerTitle: header ? header.querySelector('.section-title').textContent.trim() : null,
                sampleCards: cards.slice(0, 4).map(c => ({
                    id: c.dataset.id,
                    title: c.querySelector('.card-title') ? c.querySelector('.card-title').textContent : '',
                    author: c.querySelector('.card-author') ? c.querySelector('.card-author').textContent : '',
                    thumbSrc: c.querySelector('.card-thumb') ? c.querySelector('.card-thumb').src : '',
                    badges: Array.from(c.querySelectorAll('.card-badges-row span')).map(s => s.textContent),
                    duration: c.querySelector('.duration-badge') ? c.querySelector('.duration-badge').textContent : ''
                }))
            };
        })()
        """
        await ws.send(json.dumps({
            "id": 3,
            "method": "Runtime.evaluate",
            "params": {"expression": script, "returnByValue": True}
        }))

        res = await ws.recv()
        data = json.loads(res)
        while data.get('id') != 3:
            res = await ws.recv()
            data = json.loads(res)

        print("\n=== HOME FEED STATUS ===")
        val = data.get('result', {}).get('result', {}).get('value', {})
        print(json.dumps(val, ensure_ascii=False, indent=2))

        # Check for errors in console
        await ws.send(json.dumps({
            "id": 4,
            "method": "Runtime.evaluate",
            "params": {
                "expression": "console.error.toString()",
                "returnByValue": True
            }
        }))

asyncio.run(inspect())
