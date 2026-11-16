import socket
import time

s = socket.socket()
s.connect(('192.168.1.199', 23))
time.sleep(0.5)
s.recv(4096)

# 1. Close running app
s.sendall(b'luna-send -n 1 -f luna://com.webos.applicationManager/closeByAppId \'{"id":"org.webosbrew.vkvideo.adfree"}\'\n')
time.sleep(1.5)
out1 = s.recv(4096).decode('utf-8', errors='ignore')
print("Close response:", out1)

# 2. Re-launch fresh app
s.sendall(b'luna-send -n 1 -f luna://com.webos.applicationManager/launch \'{"id":"org.webosbrew.vkvideo.adfree"}\'\n')
time.sleep(2.5)
out2 = s.recv(4096).decode('utf-8', errors='ignore')
print("Launch response:", out2)

s.close()
