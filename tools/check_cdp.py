import urllib.request, json
try:
    data = json.loads(urllib.request.urlopen('http://192.168.1.199:9998/json', timeout=3).read().decode('utf-8'))
    print('Found targets:', len(data))
    for p in data:
        print('Target:', p.get('title'), p.get('url'))
except Exception as e:
    print('Err:', e)
