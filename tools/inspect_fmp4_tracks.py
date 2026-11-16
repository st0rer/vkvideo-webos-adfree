import urllib.request, json

req = urllib.request.Request('https://proxy.vkvideo.ru/api/method/auth.getAnonymToken?client_id=2274003&v=5.199', headers={'User-Agent': 'VKVideoSmartTV/1.0'})
resp = urllib.request.urlopen(req)
token = json.loads(resp.read().decode())['response']['token']

url = f'https://proxy.vkvideo.ru/api/method/video.get?videos=-108468_456257702&extended=1&v=5.199&access_token={token}'
req2 = urllib.request.Request(url, headers={'User-Agent': 'VKVideoSmartTV/1.0'})
resp2 = urllib.request.urlopen(req2)
item = json.loads(resp2.read().decode())['response']['items'][0]
files = item.get('files', {})

hls_fmp4 = files.get('hls_fmp4')
r2 = urllib.request.urlopen(urllib.request.Request(hls_fmp4, headers={'User-Agent': 'VKVideoSmartTV/1.0'}))
lines = r2.read().decode('utf-8').split('\n')
for line in lines:
    if 'RESOLUTION' in line or 'CODECS' in line or 'EXT-X-STREAM-INF' in line:
        print(line)
