import urllib.request
import json
import urllib.parse

tok_url = 'https://proxy.vkvideo.ru/api/method/auth.getAnonymToken?client_id=2274003&v=5.199'
token = json.loads(urllib.request.urlopen(tok_url).read().decode('utf-8'))['response']['token']

queries = ['фильмы', 'кино', 'сериалы', 'шоу', 'wylsacom', 'союзмультфильм', 'спорт', 'игры']

for q in queries:
    url = 'https://proxy.vkvideo.ru/api/method/groups.search?q=' + urllib.parse.quote(q) + '&count=4&v=5.199&access_token=' + token
    req = urllib.request.Request(url, headers={'User-Agent': 'VKVideoSmartTV/1.0'})
    try:
        res = json.loads(urllib.request.urlopen(req).read().decode('utf-8'))
        print(f"Query {q} result keys: {list(res.keys())}, response: {res.get('error') or len(res.get('response', {}).get('items', []))}")
        for g in res.get('response', {}).get('items', []):
            gid = -g['id']
            v_url = 'https://proxy.vkvideo.ru/api/method/video.get?owner_id=' + str(gid) + '&count=3&extended=1&v=5.199&access_token=' + token
            v_res = json.loads(urllib.request.urlopen(v_url).read().decode('utf-8'))
            items = v_res.get('response', {}).get('items', [])
            if items:
                v = items[0]
                dur = v.get('duration', 0)
                # check if long form video
                if dur > 120 and v.get('width', 0) >= v.get('height', 0):
                    print(f"VALID [{q}]: {g['name']} (ID: {gid}) - Videos: {len(items)}, Dur: {dur}s, Res: {v.get('width')}x{v.get('height')}")
    except Exception as e:
        pass
