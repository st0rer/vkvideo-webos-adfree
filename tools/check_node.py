import socket, time
s = socket.socket()
s.connect(('192.168.1.199', 23))
s.recv(1024)
s.sendall(b"node --version\n")
time.sleep(0.5)
print(s.recv(1024).decode('utf-8', errors='ignore'))
s.close()
