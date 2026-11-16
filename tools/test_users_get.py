import urllib.request, ssl, json
ctx = ssl._create_unverified_context()
url = 'https://api.vk.com/method/users.get?v=5.199'
try:
    req = urllib.request.Request(url, headers={'User-Agent': 'KateMobileAndroid/56 lite-arm64-v8a'})
    res = urllib.request.urlopen(req, context=ctx)
    print(res.read().decode('utf-8'))
except urllib.error.HTTPError as e:
    print(e.code, e.read().decode('utf-8'))
