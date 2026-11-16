import socket
import time

s = socket.socket()
s.connect(('192.168.1.199', 23))
time.sleep(0.5)
s.recv(4096)

cmd = 'find /home/root /var /tmp /media -name "*org.webosbrew.vkvideo.adfree*" 2>/dev/null\n'
s.sendall(cmd.encode('utf-8'))
time.sleep(2.0)
out = s.recv(8192).decode('utf-8', errors='ignore')
print("Find result:")
print(out)

# Check chromium app data
cmd2 = 'ls -la /var/luna/preferences/ 2>/dev/null; find /var -name "*leveldb*" 2>/dev/null\n'
s.sendall(cmd2.encode('utf-8'))
time.sleep(2.0)
out2 = s.recv(8192).decode('utf-8', errors='ignore')
print("Preferences/leveldb:")
print(out2)

s.close()
