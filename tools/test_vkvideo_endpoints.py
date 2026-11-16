import urllib.request
import urllib.parse
import json

def test_api_vkvideo():
    urls = [
        'https://api.vkvideo.ru/',
        'https://api.vkvideo.ru/method/video.getCatalog',
        'https://api.vkvideo.ru/v1/catalog',
        'https://api.vkvideo.ru/v1/feed',
        'https://api.vkvideo.ru/v1/home',
        'https://api.vkvideo.ru/api/method/video.getCatalog',
        'https://proxy.vkvideo.ru/api/method/video.getCatalog'
    ]
    for u in urls:
        try:
            req = urllib.request.Request(u, headers={'User-Agent': 'VKVideo/1.0 (SmartTV)'})
            res = urllib.request.urlopen(req, timeout=3)
            print(u, '=> STATUS:', res.status, 'BODY:', res.read()[:100])
        except Exception as e:
            print(u, '=> ERROR:', e)

if __name__ == '__main__':
    test_api_vkvideo()
