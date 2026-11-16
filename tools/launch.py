import socket
import time

s = socket.socket()
s.connect(('192.168.1.199', 23))
time.sleep(0.5)
s.recv(4096)

cmd = 'luna-send -n 1 -f luna://com.webos.applicationManager/launch \'{"id":"org.webosbrew.vkvideo.adfree"}\'\n'
s.sendall(cmd.encode('utf-8'))
time.sleep(2.0)
out = s.recv(4096).decode('utf-8', errors='ignore')
print(out)
s.close()
