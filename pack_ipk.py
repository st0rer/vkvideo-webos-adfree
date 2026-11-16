import os
import tarfile
import io
import time
import struct

def build_ipk(src_dir, output_ipk, package_id="org.webosbrew.vkvideo.adfree", version="1.0.0"):
    print(f"Building {output_ipk} from {src_dir}...")
    
    # 1. debian-binary
    debian_binary = b"2.0\n"

    # 2. control.tar.gz
    control_content = f"""Package: {package_id}
Version: {version}
Section: misc
Priority: optional
Architecture: all
Maintainer: WebOSBrew Community
Description: Ultra-fast 4K AdFree VK Video Client for LG webOS TV (LG C1 OLED)
""".encode('utf-8')

    control_tar_io = io.BytesIO()
    with tarfile.open(fileobj=control_tar_io, mode="w:gz") as tar:
        ti = tarfile.TarInfo(name="./control")
        ti.size = len(control_content)
        ti.mtime = int(time.time())
        ti.mode = 0o644
        tar.addfile(ti, io.BytesIO(control_content))
    control_tar_gz = control_tar_io.getvalue()

    # 3. data.tar.gz
    # webOS apps are installed into /media/developer/apps/usr/palm/applications/<package_id> or /usr/palm/applications/<package_id>
    data_tar_io = io.BytesIO()
    app_base_path = f"./usr/palm/applications/{package_id}"
    
    with tarfile.open(fileobj=data_tar_io, mode="w:gz") as tar:
        # Add directories and files
        for root, dirs, files in os.walk(src_dir):
            rel_dir = os.path.relpath(root, src_dir)
            if rel_dir == ".":
                target_dir = app_base_path
            else:
                target_dir = f"{app_base_path}/{rel_dir.replace(os.sep, '/')}"
            
            d_info = tarfile.TarInfo(name=target_dir)
            d_info.type = tarfile.DIRTYPE
            d_info.mode = 0o755
            d_info.mtime = int(time.time())
            tar.addfile(d_info)

            for f in files:
                file_path = os.path.join(root, f)
                target_file = f"{target_dir}/{f}"
                with open(file_path, "rb") as fp:
                    content = fp.read()
                f_info = tarfile.TarInfo(name=target_file)
                f_info.size = len(content)
                f_info.mode = 0o644
                f_info.mtime = int(time.time())
                tar.addfile(f_info, io.BytesIO(content))

    data_tar_gz = data_tar_io.getvalue()

    # 4. Pack into AR archive (standard format for IPK / DEB)
    # AR Header: 8 bytes magic "!<arch>\n"
    # Each entry: 60 bytes header
    # File name: 16 bytes
    # Modification timestamp: 12 bytes
    # Owner ID: 6 bytes
    # Group ID: 6 bytes
    # File mode: 8 bytes
    # File size: 10 bytes
    # Trailer: 2 bytes "`\n"
    # File content (padded to 2 bytes if odd)
    
    def make_ar_header(name, size):
        # Format string: 16s 12s 6s 6s 8s 10s 2s
        hdr = (
            f"{name:<16}"
            f"{int(time.time()):<12}"
            f"{'0':<6}"
            f"{'0':<6}"
            f"{'100644':<8}"
            f"{size:<10}"
            f"`\n"
        ).encode('ascii')
        return hdr

    with open(output_ipk, "wb") as out:
        out.write(b"!<arch>\n")
        
        # debian-binary
        out.write(make_ar_header("debian-binary", len(debian_binary)))
        out.write(debian_binary)
        if len(debian_binary) % 2 != 0:
            out.write(b"\n")
            
        # control.tar.gz
        out.write(make_ar_header("control.tar.gz", len(control_tar_gz)))
        out.write(control_tar_gz)
        if len(control_tar_gz) % 2 != 0:
            out.write(b"\n")
            
        # data.tar.gz
        out.write(make_ar_header("data.tar.gz", len(data_tar_gz)))
        out.write(data_tar_gz)
        if len(data_tar_gz) % 2 != 0:
            out.write(b"\n")

    print(f"Successfully generated {output_ipk} ({os.path.getsize(output_ipk)} bytes)")

if __name__ == "__main__":
    src = r"C:\Users\Storer\.gemini\antigravity\scratch\vkvideo-adfree\src"
    out = r"C:\Users\Storer\.gemini\antigravity\scratch\vkvideo-adfree\build\org.webosbrew.vkvideo.adfree_1.0.0_all.ipk"
    build_ipk(src, out)
