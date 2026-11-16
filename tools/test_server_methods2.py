import socket
import time

s = socket.socket()
s.connect(('192.168.1.199', 23))
time.sleep(0.3)
s.recv(2048)

py_cmd = """python -c "
import glob, re, json, urllib2, urllib

token = None
for f in glob.glob('/mnt/lg/cmn_data/var/lib/wam/Default/Local Storage/leveldb/*.ldb') + glob.glob('/mnt/lg/cmn_data/var/lib/wam/Default/Local Storage/leveldb/*.log'):
    with open(f, 'rb') as fp:
        c = fp.read()
    m = re.search(r'(vk1\\.a\\.[A-Za-z0-9_-]{50,})', c)
    if m:
        token = m.group(1)
        break

def call_api(params):
    p = dict(params)
    p['access_token'] = token
    p['v'] = '5.131'
    url = 'https://proxy.vkvideo.ru/api/method/video.getCatalog?' + urllib.urlencode(p)
    req = urllib2.Request(url, headers={'User-Agent': 'VKVideo/1.0 (SmartTV)'})
    return json.loads(urllib2.urlopen(req, timeout=5).read())

tests = [
    {},
    {'filters': 'feed'},
    {'filters': 'ugc'},
    {'filters': 'top'},
    {'filters': 'other'},
    {'filters': 'channels'},
    {'extended': 1, 'count': 16},
    {'filters': 'feed,ugc,top,other', 'extended': 1}
]

for t in tests:
    res = call_api(t)
    resp = res.get('response', {})
    sections = resp.get('sections', [])
    items = resp.get('items', [])
    print t, '=> sections:', len(sections), 'items:', len(items)
    if sections:
        for sec in sections:
            print '   sec:', sec.get('id'), sec.get('name', '').encode('ascii', 'replace')
    if items:
        for it in items[:3]:
            print '   item:', it.get('id'), it.get('name', '').encode('ascii', 'replace')
"
"""

s.sendall(py_cmd.encode('utf-8'))
time.sleep(6.0)
res = s.recv(16384).decode('utf-8', errors='ignore')
print("VK Catalog Parameter Tests:")
print(res)

s.close()
