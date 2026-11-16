import socket
import time

s = socket.socket()
s.connect(('192.168.1.199', 23))
time.sleep(0.3)
s.recv(2048)

py_cmd = """python -c "
import glob, re, json, urllib.request, urllib.parse

# Find access token in leveldb
token = None
for f in glob.glob('/mnt/lg/cmn_data/var/lib/wam/Default/Local Storage/leveldb/*.ldb') + glob.glob('/mnt/lg/cmn_data/var/lib/wam/Default/Local Storage/leveldb/*.log'):
    with open(f, 'rb') as fp:
        c = fp.read()
    # Search for vk1.a. token
    m = re.search(b'(vk1\\.a\\.[A-Za-z0-9_-]{50,})', c)
    if m:
        token = m.group(1).decode('ascii')
        print('Found token:', token[:15] + '...')
        break

if not token:
    print('No token found')
    exit()

# Now test what server API returns!
def call_api(method, params):
    params['access_token'] = token
    params['v'] = '5.131'
    url = 'https://api.vk.com/method/' + method + '?' + urllib.parse.urlencode(params)
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'VKVideo/1.0 (SmartTV)'})
        res = json.loads(urllib.request.urlopen(req, timeout=5).read().decode('utf-8'))
        return res
    except Exception as e:
        return {'error': str(e)}

# 1. Test video.getCatalog
print('--- video.getCatalog ---')
cat = call_api('video.getCatalog', {'count': 10, 'extended': 1})
if 'response' in cat:
    items = cat['response'].get('items', [])
    print('Catalog sections:', len(items))
    for sec in items:
        print('  Section:', sec.get('id'), '|', sec.get('name'), '| items:', len(sec.get('items', [])))
else:
    print('Catalog error/resp:', cat)

# 2. Test video.get for user
print('--- video.get (user added videos) ---')
vids = call_api('video.get', {'count': 10, 'extended': 1})
if 'response' in vids:
    items = vids['response'].get('items', [])
    print('User videos count:', vids['response'].get('count'), 'retrieved:', len(items))
    for v in items[:5]:
        print('  Vid:', v.get('title'), '| owner:', v.get('owner_id'))
else:
    print('video.get error/resp:', vids)

# 3. Test video.getAlbums
print('--- video.getAlbums ---')
albums = call_api('video.getAlbums', {'need_system': 1, 'extended': 1})
if 'response' in albums:
    items = albums['response'].get('items', [])
    print('Albums count:', len(items))
    for a in items:
        print('  Album:', a.get('id'), '| title:', a.get('title'), '| count:', a.get('count'))
else:
    print('video.getAlbums error/resp:', albums)

# 4. Test fave.get
print('--- fave.get (video) ---')
fave = call_api('fave.get', {'item_type': 'video', 'count': 10, 'extended': 1})
if 'response' in fave:
    items = fave['response'].get('items', [])
    print('Fave items:', len(items))
    for f_item in items[:5]:
        v = f_item.get('video')
        if v:
            print('  Fave vid:', v.get('title'), '| owner:', v.get('owner_id'))
else:
    print('fave.get error/resp:', fave)
"
"""

s.sendall(py_cmd.encode('utf-8'))
time.sleep(4.0)
res = s.recv(16384).decode('utf-8', errors='ignore')
print("Server API Investigation:")
print(res)

s.close()
