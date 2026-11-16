import socket
try:
    s = socket.socket()
    s.settimeout(2.0)
    s.connect(('192.168.1.199', 9998))
    print('Port 9998 connected successfully!')
    s.close()
except Exception as e:
    print('Connect failed:', e)
