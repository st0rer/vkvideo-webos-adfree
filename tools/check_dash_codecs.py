import urllib.request, json, re, sys

sys.stdout.reconfigure(encoding='utf-8')

req = urllib.request.Request('https://proxy.vkvideo.ru/api/method/auth.getAnonymToken?client_id=2274003&v=5.199', headers={'User-Agent': 'VKVideoSmartTV/1.0'})
resp = urllib.request.urlopen(req)
token = json.loads(resp.read().decode())['response']['token']

url = f'https://proxy.vkvideo.ru/api/method/video.get?videos=-108468_456257702&extended=1&v=5.199&access_token={token}'
req2 = urllib.request.Request(url, headers={'User-Agent': 'VKVideoSmartTV/1.0'})
resp2 = urllib.request.urlopen(req2)
item = json.loads(resp2.read().decode())['response']['items'][0]
files = item.get('files', {})

for name in ['dash_webm_av1', 'dash_webm', 'dash_sep']:
    u = files.get(name)
    if u:
        try:
            r = urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': 'VKVideoSmartTV/1.0'}))
            content = r.read().decode('utf-8')
            reps = re.findall(r'<Representation[^>]+>', content)
            print(f'=== {name} ===')
            for rep in reps:
                w = re.search(r'width="(\d+)"', rep)
                h = re.search(r'height="(\d+)"', rep)
                c = re.search(r'codecs="([^"]+)"', rep)
                bw = re.search(r'bandwidth="(\d+)"', rep)
                ws = w.group(1) if w else '?'
                hs = h.group(1) if h else '?'
                cs = c.group(1) if c else '?'
                bws = bw.group(1) if bw else '?'
                print(f'  {ws}x{hs} codec={cs} bw={bws}')
        except Exception as e:
            print(f'Error {name}:', e)
