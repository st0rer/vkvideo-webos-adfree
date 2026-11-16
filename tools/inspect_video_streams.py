import urllib.request, json

req = urllib.request.Request('https://proxy.vkvideo.ru/api/method/auth.getAnonymToken?client_id=2274003&v=5.199', headers={'User-Agent': 'VKVideoSmartTV/1.0'})
resp = urllib.request.urlopen(req)
token = json.loads(resp.read().decode())['response']['token']

url = f'https://proxy.vkvideo.ru/api/method/video.get?videos=-108468_456257702&extended=1&v=5.199&access_token={token}'
req2 = urllib.request.Request(url, headers={'User-Agent': 'VKVideoSmartTV/1.0'})
resp2 = urllib.request.urlopen(req2)
item = json.loads(resp2.read().decode())['response']['items'][0]
files = item.get('files', {})
print("Available files keys:", list(files.keys()))
for k, v in files.items():
    print(f"  {k}: {v[:80]}...")
