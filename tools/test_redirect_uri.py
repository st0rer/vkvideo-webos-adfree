import urllib.request, ssl
ctx = ssl._create_unverified_context()
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None
opener = urllib.request.build_opener(NoRedirect, urllib.request.HTTPSHandler(context=ctx))

# Test with redirect_uri = http://192.168.1.199:8765/callback
u = 'https://oauth.vk.com/authorize?client_id=2685278&display=page&redirect_uri=http://192.168.1.199:8765/callback&scope=video,offline&response_type=token&v=5.199'
try:
    res = opener.open(u)
    print('Custom redirect_uri result: 200 OK')
except urllib.error.HTTPError as e:
    print('Custom redirect_uri result:', e.code, e.read()[:200])
