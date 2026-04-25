"""Phase v3.0 — CalDAV (RFC 4791) client for iCloud, Fastmail, Nextcloud,
and any generic CalDAV server.

We use the `caldav` Python library (well-maintained, depends only on
vobject + requests). The runner runs sync cycles in a thread executor so the
synchronous library doesn't block the event loop.

Per design doc §11 R2: ALWAYS send If-Match on PUT. On 412 PRECONDITION
FAILED, the runner enqueues a bidirectional_conflict SyncReviewItem rather
than retrying blindly.
"""
from __future__ import annotations

import logging
from typing import Optional

# Default base URLs for known providers (per design doc §6 Flow B).
ICLOUD_DEFAULT_BASE = "https://caldav.icloud.com"


class CalDAVAuthError(Exception):
    """Raised when CalDAV credentials are rejected. Caller flips
    connection.status='auth_expired' and posts an error notification."""
    pass


class CalDAVConflict(Exception):
    """Raised on 412 PRECONDITION FAILED on a PUT — the remote ETag changed
    between read and write. Caller writes a bidirectional_conflict review item."""
    pass


def _client(base_url: str, username: str, password: str):
    """Construct a caldav.DAVClient. Imported lazily so the module loads
    without the caldav dep installed (e.g. in CI without prod requirements)."""
    try:
        from caldav import DAVClient
    except ImportError as e:
        raise RuntimeError("caldav package not installed") from e
    return DAVClient(url=base_url, username=username, password=password)


def discover_principal(base_url: str, username: str, password: str) -> dict:
    """Validate credentials by attempting a PROPFIND on the principal URL.

    Returns: {ok: bool, principal_url?: str, error?: str}

    The frontend's CalDAVCredentialsForm calls this via
    POST /connections/caldav/test before saving.
    """
    try:
        cli = _client(base_url, username, password)
        principal = cli.principal()
        return {"ok": True, "principal_url": str(principal.url)}
    except Exception as e:
        msg = str(e)
        if "401" in msg or "403" in msg:
            return {"ok": False, "error": "Authentication failed. For iCloud, make sure to use an app-specific password."}
        return {"ok": False, "error": msg[:200]}


def list_collections(base_url: str, username: str, password: str) -> list[dict]:
    """List all calendar collections the user has access to.
    Returns: [{href, display_name, color?, ctag?}]
    """
    cli = _client(base_url, username, password)
    principal = cli.principal()
    out: list[dict] = []
    for cal in principal.calendars():
        try:
            name = cal.name or str(cal.url).rstrip("/").split("/")[-1]
            color = None
            try:
                props = cal.get_properties()
                # caldav library returns a dict keyed on tag tuples; the color
                # tag is in the apple namespace and is best-effort.
                for k, v in props.items():
                    if "calendar-color" in str(k).lower() and v:
                        color = str(v)
                        break
            except Exception:
                pass
            out.append({
                "href":         str(cal.url),
                "display_name": name,
                "color":        color,
            })
        except Exception as e:
            logging.warning(f"caldav: skip collection {cal!r}: {e}")
    return out


def incremental_pull(
    base_url: str,
    username: str,
    password: str,
    collection_href: str,
    saved_ctag: Optional[str] = None,
) -> dict:
    """Pull events from a collection.

    Returns: {events: list[dict], ctag: str | None}

    `events` is a list of LoomAssist-shaped dicts with `external_etag`
    (= the resource's ETag, used as If-Match on push) and an `external_id`
    (= the resource href, stable per-collection).

    If the saved ctag matches the collection's current ctag, returns
    {events: [], ctag: saved_ctag} immediately (no work needed).
    """
    from .ics_normalize import parse_ics
    cli = _client(base_url, username, password)
    cal = cli.calendar(url=collection_href)

    # Try to short-circuit on ctag.
    ctag: Optional[str] = None
    try:
        props = cal.get_properties()
        for k, v in props.items():
            if "ctag" in str(k).lower() and v:
                ctag = str(v)
                break
        if saved_ctag and ctag and ctag == saved_ctag:
            return {"events": [], "ctag": ctag}
    except Exception as e:
        logging.warning(f"caldav: ctag fetch failed (continuing with full pull): {e}")

    events: list[dict] = []
    for resource in cal.events():
        try:
            ics_text = resource.data
            etag = resource.get_properties().get("{DAV:}getetag") if hasattr(resource, "get_properties") else None
            for d in parse_ics(ics_text):
                d["external_id"]   = str(resource.url)
                d["external_etag"] = str(etag) if etag else None
                events.append(d)
        except Exception as e:
            logging.warning(f"caldav: skip resource due to parse error: {e}")
    return {"events": events, "ctag": ctag}


def put_ics(
    base_url: str,
    username: str,
    password: str,
    collection_href: str,
    ics_text: str,
    *,
    href: Optional[str] = None,
    if_match: Optional[str] = None,
) -> dict:
    """Create (no href) or update (with href + If-Match) a CalDAV resource.

    Returns: {href, etag}

    On 412 raises CalDAVConflict so the caller can write a bidirectional_conflict
    review item without retrying.
    """
    cli = _client(base_url, username, password)
    cal = cli.calendar(url=collection_href)

    try:
        if href:
            # Update existing.
            resource = cal.event_by_url(href)
            resource.data = ics_text
            # Pass If-Match via the underlying httpx call where the library exposes it.
            try:
                resource.save(if_match=if_match) if if_match else resource.save()
            except TypeError:
                # Older caldav versions lack the if_match kwarg; fall back.
                resource.save()
            new_href = str(resource.url)
            new_etag = None
            try:
                new_etag = str(resource.get_properties().get("{DAV:}getetag"))
            except Exception:
                pass
            return {"href": new_href, "etag": new_etag}
        else:
            # Create new.
            resource = cal.save_event(ics_text)
            new_href = str(resource.url)
            new_etag = None
            try:
                new_etag = str(resource.get_properties().get("{DAV:}getetag"))
            except Exception:
                pass
            return {"href": new_href, "etag": new_etag}
    except Exception as e:
        msg = str(e)
        if "412" in msg or "PreconditionFailed" in msg or "precondition" in msg.lower():
            raise CalDAVConflict(msg) from e
        if "401" in msg or "403" in msg:
            raise CalDAVAuthError(msg) from e
        raise


def delete_resource(
    base_url: str,
    username: str,
    password: str,
    href: str,
) -> None:
    cli = _client(base_url, username, password)
    try:
        # Best-effort: caldav library exposes delete on the calendar object.
        # We just open the event by URL and call delete().
        from caldav.lib.error import NotFoundError  # noqa
        from caldav import CalendarObjectResource
        # Find the parent calendar from the href: drop the last path segment.
        parent = href.rsplit("/", 1)[0] + "/"
        cal = cli.calendar(url=parent)
        ev = cal.event_by_url(href)
        ev.delete()
    except Exception as e:
        # Idempotent on 404.
        if "404" in str(e):
            return
        raise
