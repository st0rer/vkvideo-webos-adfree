import socket, time
s = socket.socket()
s.connect(('192.168.1.199', 23))
s.recv(1024)
s.sendall(b"luna-send -n 1 -f luna://com.webos.applicationManager/launch '{\"id\":\"org.webosbrew.vkvideo.adfree\"}'\n")
time.sleep(2.0)
print(s.recv(4096).decode('utf-8', errors='ignore'))
s.close()
