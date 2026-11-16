import socket, time
s = socket.socket()
s.connect(('192.168.1.199', 23))
s.recv(1024)
s.sendall(b"ls -la /tmp\n")
time.sleep(1.0)
print(s.recv(4096).decode('utf-8', errors='ignore'))
s.close()
