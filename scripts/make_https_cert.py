#!/usr/bin/env python3
"""Create a self-signed HTTPS certificate for local network / Android PWA."""
from __future__ import annotations

import ipaddress
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CERT_DIR = ROOT / "cert"
KEY = CERT_DIR / "key.pem"
CERT = CERT_DIR / "cert.pem"


def main() -> None:
    CERT_DIR.mkdir(exist_ok=True)
    if KEY.exists() and CERT.exists():
        print(f"Sertifikaatti on jo olemassa: {CERT}")
        return

    try:
        subprocess.run(["openssl", "version"], capture_output=True, check=True)
    except (FileNotFoundError, subprocess.CalledProcessError):
        print("OpenSSL puuttuu. Asenna OpenSSL tai Git for Windows (sisältää openssl).")
        print("Vaihtoehto: käytä HTTP-versiota (run-network.bat) ja Lisää aloitusnäytölle.")
        sys.exit(1)

    san = "DNS:localhost,IP:127.0.0.1"
    try:
        import re
        import socket

        hostname = socket.gethostname()
        san += f",DNS:{hostname}"

        if sys.platform == "win32":
            out = subprocess.check_output(["ipconfig"], text=True, errors="ignore")
            for line in out.splitlines():
                if "IPv4" in line or "IPv4-osoite" in line:
                    match = re.search(r"(\d+\.\d+\.\d+\.\d+)", line)
                    if match and not match.group(1).startswith("127."):
                        san += f",IP:{match.group(1)}"
                        break
        else:
            local_ip = subprocess.check_output(["hostname", "-I"], text=True).split()[0]
            ipaddress.ip_address(local_ip)
            san += f",IP:{local_ip}"
    except Exception:
        pass

    cmd = [
        "openssl",
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-keyout",
        str(KEY),
        "-out",
        str(CERT),
        "-days",
        "825",
        "-nodes",
        "-subj",
        "/CN=varasto.local",
        "-addext",
        f"subjectAltName={san}",
    ]
    subprocess.run(cmd, check=True)
    print(f"Luotu: {CERT}")
    print("Android: hyväksy varoitus selaimessa ensimmäisellä kerralla (ei luotettu sertifikaatti).")


if __name__ == "__main__":
    main()
