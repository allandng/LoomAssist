"""mDNS service advertisement + peer discovery.

Owns `_zeroconf_instance` and `_discovered_peers` (module-level state). The
lifespan in main.py interacts with this module via `_maybe_start_mdns()`
(startup) and `stop_mdns()` (shutdown) — it never pokes the globals directly.

Extracted from main.py in Stage 1 (substep 1A.5). No LLM dependency.
"""
from __future__ import annotations

from pathlib import Path

from loom_logger import get_logger

from services.lan.certs import _cert_fingerprint


logger = get_logger("lan.discovery")


_zeroconf_instance = None
_discovered_peers: list[dict] = []


def _start_mdns(fingerprint: str, port: int = 8000):
    global _zeroconf_instance
    try:
        from zeroconf import Zeroconf, ServiceInfo, ServiceBrowser
        import socket as _socket

        local_ip = _socket.gethostbyname(_socket.gethostname())
        info = ServiceInfo(
            "_loomassist._tcp.local.",
            f"LoomAssist-{fingerprint[:8]}._loomassist._tcp.local.",
            addresses=[_socket.inet_aton(local_ip)],
            port=port,
            properties={"fingerprint": fingerprint},
        )
        zc = Zeroconf()
        zc.register_service(info)
        _zeroconf_instance = zc

        class Listener:
            def add_service(self, zc_inner, type_, name):
                info_found = zc_inner.get_service_info(type_, name)
                if info_found:
                    _discovered_peers.append({
                        "name": name,
                        "host": _socket.inet_ntoa(info_found.addresses[0]),
                        "port": info_found.port,
                        "fingerprint": info_found.properties.get(b"fingerprint", b"").decode(),
                    })
            def remove_service(self, zc_inner, type_, name):
                pass
            def update_service(self, zc_inner, type_, name):
                pass

        ServiceBrowser(zc, "_loomassist._tcp.local.", Listener())
        logger.info("mDNS: advertising LoomAssist service")
    except Exception as e:
        logger.warning(f"mDNS init failed (non-fatal): {e}")


def _maybe_start_mdns():
    """Start mDNS service advertisement if a cert exists. Called from lifespan."""
    try:
        cert_file = Path("./certs/loom.crt")
        if cert_file.exists():
            fp = _cert_fingerprint(cert_file.read_text())
            _start_mdns(fp)
    except Exception:
        pass


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
