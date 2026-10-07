import ipaddress
import socket
from urllib.parse import urlparse


def url_allowed(url: str) -> tuple[bool, str]:
    """Ochrona przed SSRF: tylko http(s) na publiczne adresy (wyjątek: sklep demo)."""
    u = urlparse(url)
    if u.scheme not in ("http", "https") or not u.hostname:
        return False, "Dozwolone są tylko linki http(s)."
    if u.hostname in ("localhost", "127.0.0.1") and u.path.startswith("/demo-shop/"):
        return True, ""
    try:
        for info in socket.getaddrinfo(u.hostname, None):
            ip = ipaddress.ip_address(info[4][0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
                return False, "Adres prywatny jest zablokowany."
    except socket.gaierror:
        return False, "Nie można rozpoznać domeny."
    return True, ""
