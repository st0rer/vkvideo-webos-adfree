import socket, time
s = socket.socket()
s.connect(('192.168.1.199', 23))
s.recv(1024)
s.sendall(b"curl -s http://127.0.0.1:9998/json\n")
time.sleep(1.0)
print(s.recv(4096).decode('utf-8', errors='ignore'))
s.close()
