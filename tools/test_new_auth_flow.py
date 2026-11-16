import urllib.request, json, ssl, urllib.parse
ctx = ssl._create_unverified_context()

# 1. Get anonym token for Smart TV app (4171611)
url = 'https://api.vk.com/method/auth.getAnonymToken?client_id=4171611&client_secret=4zY5SwZXWDcXXLat9s0c&v=5.162'
r1 = json.loads(urllib.request.urlopen(url, context=ctx).read())
token = r1['response']['token']
print('1. Anonym Token OK:', token[:30] + '...')

# 2. Call auth.getAuthCode
data = urllib.parse.urlencode({
    'access_token': token,
    'scope': 'video,offline,wall,groups',
    'device_name': 'LG webOS TV',
    'auth_code_type': 1,
    'need_qr_code': 1,
    'v': '5.162'
}).encode('utf-8')

req = urllib.request.Request('https://api.vk.com/method/auth.getAuthCode', data=data)
r2 = json.loads(urllib.request.urlopen(req, context=ctx).read())
code_res = r2['response']
print('2. Auth Code:', code_res['auth_code'])
print('   Auth URL:', code_res['auth_url'])
print('   Auth Hash:', code_res['auth_hash'])

# 3. Call auth.checkAuthCode (expect status 0 = pending)
check_data = urllib.parse.urlencode({
    'access_token': token,
    'auth_hash': code_res['auth_hash'],
    'v': '5.162'
}).encode('utf-8')

req2 = urllib.request.Request('https://api.vk.com/method/auth.checkAuthCode', data=check_data)
r3 = json.loads(urllib.request.urlopen(req2, context=ctx).read())
print('3. Initial Check status:', r3['response']['status']) # 0 = pending
