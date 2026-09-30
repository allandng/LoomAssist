"""mDNS service advertisement + peer discovery.

Owns `_zeroconf_instance` and `_discovered_peers` (module-level state). The
lifespan in main.py interacts with this module via `_maybe_start_mdns()`
(startup) and `stop_mdns()` (shutdown) — it never pokes the globals directly.

Also owns `get_lan_ip()`: the address other devices on the LAN should use to
reach this backend. On Windows the hostname often resolves to a virtual
adapter (Hyper-V / WSL / VMware / Docker NAT), so we ask the OS routing table
which interface it would use for an outbound packet (no traffic is sent) and
only fall back to hostname resolution when that fails.

Every failure path here is non-fatal and logged; startup never blocks on
mDNS.

Extracted from main.py in Stage 1 (substep 1A.5). No LLM dependency.
"""
from __future__ import annotations

import ipaddress
import socket
from typing import Optional

from loom_logger import get_logger

from services.lan import certs as _certs


logger = get_logger("lan.discovery")


_zeroconf_instance = None
_discovered_peers: list[dict] = []
_lan_ip_cache: Optional[str] = None
_own_fingerprint: Optional[str] = None


# ── LAN IP selection ─────────────────────────────────────────────────────────

def _is_usable(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return not (addr.is_loopback or addr.is_link_local or addr.is_multicast
                or addr.is_unspecified or addr.is_reserved)


def _udp_probe_ip() -> Optional[str]:
    """Source IP the OS would use to reach a public address. Connecting a UDP
    socket does not transmit anything; it just selects a route. Virtual
    adapters (NAT switches, WSL, VMware host-only) normally carry no default
    route, so this naturally prefers the real Wi-Fi/Ethernet NIC."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.settimeout(0.2)
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
        finally:
            s.close()
        return ip if _is_usable(ip) else None
    except OSError:
        return None


def _hostname_candidates() -> list[str]:
    out: list[str] = []
    try:
        for fam, _t, _p, _c, sockaddr in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = sockaddr[0]
            if _is_usable(ip) and ip not in out:
                out.append(ip)
    except OSError:
        pass
    return out


def _rank(ip: str) -> int:
    """Lower is better. 192.168/16 and 10/8 first; 172.16/12 last because on
    Windows that range is almost always a WSL / Docker / Hyper-V NAT switch."""
    if ip.startswith("192.168."):
        return 0
    if ip.startswith("10."):
        return 1
    try:
        if ipaddress.ip_address(ip).is_private:
            return 2  # 172.16–31.x.x
    except ValueError:
        pass
    return 3


def get_lan_ip(refresh: bool = False) -> Optional[str]:
    """Best-guess LAN IPv4 for this machine, or None when offline."""
    global _lan_ip_cache
    if _lan_ip_cache and not refresh:
        return _lan_ip_cache
    ip = _udp_probe_ip()
    if not ip:
        cands = sorted(_hostname_candidates(), key=_rank)
        ip = cands[0] if cands else None
    _lan_ip_cache = ip
    return ip


# ── mDNS ─────────────────────────────────────────────────────────────────────

def _start_mdns(fingerprint: str, port: int = 8000):
    global _zeroconf_instance, _own_fingerprint
    _own_fingerprint = fingerprint
    try:
        from zeroconf import Zeroconf, ServiceInfo, ServiceBrowser

        local_ip = get_lan_ip()
        if not local_ip:
            logger.warning("mDNS: no LAN IPv4 address found; advertisement skipped (non-fatal)")
            return

        info = ServiceInfo(
            "_loomassist._tcp.local.",
            f"LoomAssist-{fingerprint[:8]}._loomassist._tcp.local.",
            addresses=[socket.inet_aton(local_ip)],
            port=port,
            properties={"fingerprint": fingerprint},
        )
        zc = Zeroconf()
        zc.register_service(info)
        _zeroconf_instance = zc

        class Listener:
            def add_service(self, zc_inner, type_, name):
                try:
                    info_found = zc_inner.get_service_info(type_, name)
                    if not info_found or not info_found.addresses:
                        return
                    fp = info_found.properties.get(b"fingerprint", b"") or b""
                    fp_str = fp.decode() if isinstance(fp, (bytes, bytearray)) else str(fp)
                    if _own_fingerprint and fp_str == _own_fingerprint:
                        return  # that's us
                    entry = {
                        "name": name,
                        "host": socket.inet_ntoa(info_found.addresses[0]),
                        "port": info_found.port,
                        "fingerprint": fp_str,
                    }
                    for i, existing in enumerate(_discovered_peers):
                        if existing.get("name") == name or (fp_str and existing.get("fingerprint") == fp_str):
                            _discovered_peers[i] = entry
                            return
                    _discovered_peers.append(entry)
                except Exception as e:  # never let a bad packet kill the browser thread
                    logger.debug("mDNS add_service ignored: %s", e or type(e).__name__)

            def remove_service(self, zc_inner, type_, name):
                _discovered_peers[:] = [p for p in _discovered_peers if p.get("name") != name]

            def update_service(self, zc_inner, type_, name):
                self.add_service(zc_inner, type_, name)

        ServiceBrowser(zc, "_loomassist._tcp.local.", Listener())
        logger.info("mDNS: advertising LoomAssist service on %s:%s", local_ip, port)
    except Exception as e:
        # `%s` formatting (not an f-string) so a weird exception repr can't
        # break the log call itself; fall back to the class name when the
        # exception carries no message.
        logger.warning("mDNS init failed (non-fatal): %s", str(e) or type(e).__name__)


def find_discovered_peer(fingerprint: str) -> Optional[dict]:
    """Return the mDNS record for a peer we've seen, matched by fingerprint."""
    if not fingerprint:
        return None
    for p in _discovered_peers:
        if p.get("fingerprint") == fingerprint:
            return p
    return None


def _maybe_start_mdns():
    """Start mDNS service advertisement if a cert exists. Called from lifespan."""
    try:
        cert_file = _certs.cert_file_path()
        if cert_file.exists():
            fp = _certs._cert_fingerprint(cert_file.read_text(encoding="utf-8"))
            _start_mdns(fp)
    except Exception as e:
        logger.warning("mDNS not started (non-fatal): %s", str(e) or type(e).__name__)


def stop_mdns() -> None:
    """Tear down the mDNS instance if running. Called from lifespan shutdown.

    Idempotent — safe to call when no instance was started or after a previous
    stop. Replaces the inline `_zeroconf_instance` poke that previously lived
    in main.py's lifespan finally block.
    """
    global _zeroconf_instance
    if _zeroconf_instance is None:
        return
    try:
        _zeroconf_instance.unregister_all_services()
        _zeroconf_instance.close()
    except Exception:
        pass
    _zeroconf_instance = None
