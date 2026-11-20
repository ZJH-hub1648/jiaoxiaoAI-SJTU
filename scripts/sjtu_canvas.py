#!/usr/bin/env python3
"""Read-only command-line client for Shanghai Jiao Tong University Canvas."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Iterable, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


DEFAULT_BASE_URL = "https://oc.sjtu.edu.cn"
DEFAULT_TIMEOUT_SECONDS = 20
DEFAULT_MAX_PAGES = 20
MAX_PAGES = 50
MAX_RESPONSE_BYTES = 8 * 1024 * 1024
MAX_TOKEN_FILE_BYTES = 4096
SHANGHAI_TIMEZONE = timezone(timedelta(hours=8), name="Asia/Shanghai")
USER_AGENT = "sjtu-canvas-skill/1.0"


class CanvasError(RuntimeError):
    code = "canvas_error"


class CanvasConfigError(CanvasError):
    code = "configuration_error"


class CanvasAuthError(CanvasError):
    code = "authentication_error"


class CanvasPermissionError(CanvasError):
    code = "permission_error"


class CanvasRateLimitError(CanvasError):
    code = "rate_limited"


class CanvasNetworkError(CanvasError):
    code = "network_error"


class CanvasResponseError(CanvasError):
    code = "response_error"


class CanvasRedirectError(CanvasError):
    code = "unsafe_redirect"


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._ignored_depth = 0

    def handle_data(self, data: str) -> None:
        if not self._ignored_depth:
            self.parts.append(data)

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag.lower() in {"script", "style", "template"}:
            self._ignored_depth += 1

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in {"script", "style", "template"} and self._ignored_depth:
            self._ignored_depth -= 1

    def text(self) -> str:
        return " ".join(" ".join(self.parts).split())


def _clamp(value: int, minimum: int, maximum: int) -> int:
    return max(minimum, min(maximum, int(value)))


def _normalize_base_url(value: Optional[str]) -> str:
    raw = (value or DEFAULT_BASE_URL).strip().rstrip("/")
    parsed = urlsplit(raw)
    hostname = (parsed.hostname or "").lower()
    loopback = hostname in {"localhost", "127.0.0.1", "::1"}

    if parsed.username or parsed.password:
        raise CanvasConfigError("Canvas 地址不能包含用户名或密码。")
    if parsed.query or parsed.fragment:
        raise CanvasConfigError("Canvas 地址不能包含查询参数或片段。")
    if parsed.path:
        raise CanvasConfigError("Canvas 地址必须是平台根地址，不能包含路径。")
    if parsed.scheme != "https" and not (parsed.scheme == "http" and loopback):
        raise CanvasConfigError("Canvas 地址必须使用 HTTPS。")
    if not hostname:
        raise CanvasConfigError("Canvas 地址缺少主机名。")

    return urlunsplit((parsed.scheme, parsed.netloc, "", "", ""))


def _load_token(token_file: Optional[str]) -> str:
    if token_file:
        path = Path(token_file).expanduser()
        try:
            if path.stat().st_size > MAX_TOKEN_FILE_BYTES:
                raise CanvasConfigError("令牌文件过大，请只保存令牌本身。")
            lines = path.read_text(encoding="utf-8-sig").splitlines()
        except OSError as exc:
            raise CanvasConfigError("无法读取令牌文件。") from exc
        token = next((line.strip() for line in lines if line.strip()), "")
    else:
        token = (
            os.getenv("SJTU_CANVAS_TOKEN", "").strip()
            or os.getenv("CANVAS_API_TOKEN", "").strip()
        )

    if not token:
        raise CanvasConfigError(
            "未配置 Canvas 令牌。请设置 SJTU_CANVAS_TOKEN，或使用 --token-file。"
        )
    if any(character.isspace() for character in token):
        raise CanvasConfigError("Canvas 令牌格式无效，不能包含空白字符。")
    return token


def _next_link(header_value: Optional[str]) -> Optional[str]:
    if not header_value:
        return None
    for part in re.split(r",(?=\s*<)", header_value):
        match = re.search(r"<([^>]+)>\s*;(.*)", part)
        if match and re.search(r'(?:^|;)\s*rel="?next"?', match.group(2), re.IGNORECASE):
            return match.group(1).strip()
    return None


def _parse_timestamp(value: Any) -> Optional[datetime]:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _timestamp_fields(value: Any, source_name: str = "due_at") -> dict[str, Optional[str]]:
    parsed = _parse_timestamp(value)
    return {
        source_name: value if isinstance(value, str) else None,
        f"{source_name}_shanghai": (
            parsed.astimezone(SHANGHAI_TIMEZONE).isoformat(timespec="seconds")
            if parsed
            else None
        ),
    }


def _plain_text(value: Any, limit: int = 600) -> str:
    if not isinstance(value, str):
        return ""
    parser = _TextExtractor()
    try:
        parser.feed(value)
        text = parser.text()
    except Exception:
        text = re.sub(r"<[^>]+>", " ", value)
        text = " ".join(text.split())
    if len(text) <= limit:
        return text
    return f"{text[:limit].rstrip()}..."


def _flatten_params(params: dict[str, Any]) -> list[tuple[str, Any]]:
    flattened: list[tuple[str, Any]] = []
    for key, value in params.items():
        values: Iterable[Any] = value if isinstance(value, list) else [value]
        flattened.extend((key, item) for item in values if item is not None)
    return flattened


class CanvasClient:
    def __init__(
        self,
        *,
        base_url: str,
        token: str,
        timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
        max_pages: int = DEFAULT_MAX_PAGES,
        opener=None,
    ) -> None:
        if not token.strip():
            raise CanvasConfigError("未配置 Canvas 令牌。")
        self.base_url = _normalize_base_url(base_url)
        self._token = token.strip()
        self.timeout_seconds = _clamp(timeout_seconds, 3, 60)
        self.max_pages = _clamp(max_pages, 1, MAX_PAGES)
        self._opener = opener or build_opener(_NoRedirect())

    def _validate_api_url(self, url: str) -> str:
        parsed = urlsplit(url)
        base = urlsplit(self.base_url)
        same_origin = (
            parsed.scheme == base.scheme
            and parsed.netloc.lower() == base.netloc.lower()
        )
        if not same_origin or not parsed.path.startswith("/api/v1/"):
            raise CanvasRedirectError(
                "Canvas 返回了非预期地址，已停止请求以避免泄露令牌。"
            )
        return url

    def _build_url(self, path: str, params: Optional[dict[str, Any]] = None) -> str:
        if not path.startswith("/api/v1/"):
            raise CanvasConfigError("只允许访问 Canvas v1 API。")
        query = urlencode(_flatten_params(params or {}), doseq=True)
        return self._validate_api_url(
            f"{self.base_url}{path}{'?' + query if query else ''}"
        )

    def _request_json(self, url: str) -> tuple[Any, dict[str, str]]:
        request = Request(
            self._validate_api_url(url),
            method="GET",
            headers={
                "Authorization": f"Bearer {self._token}",
                "Accept": "application/json",
                "User-Agent": USER_AGENT,
            },
        )
        try:
            with self._opener.open(request, timeout=self.timeout_seconds) as response:
                payload = response.read(MAX_RESPONSE_BYTES + 1)
                headers = {
                    key.lower(): value for key, value in response.headers.items()
                }
        except HTTPError as exc:
            if 300 <= exc.code < 400:
                raise CanvasRedirectError(
                    "Canvas 要求跳转登录。请确认令牌有效；学校要求登录跳转时，"
                    "个人访问令牌无法替代浏览器会话。"
                ) from None
            if exc.code == 401:
                raise CanvasAuthError(
                    "Canvas 拒绝了令牌。请重新生成个人访问令牌并确认它仍有效。"
                ) from None
            if exc.code == 403:
                raise CanvasPermissionError(
                    "当前 Canvas 账号或令牌无权读取这个资源。"
                ) from None
            if exc.code == 404:
                raise CanvasResponseError(
                    "请求的 Canvas 资源不存在，或当前账号无权查看。"
                ) from None
            if exc.code == 429:
                raise CanvasRateLimitError(
                    "Canvas 请求过于频繁，请稍后再试。"
                ) from None
            if 500 <= exc.code:
                raise CanvasResponseError(
                    f"Canvas 服务暂时不可用（HTTP {exc.code}）。"
                ) from None
            raise CanvasResponseError(
                f"Canvas 请求失败（HTTP {exc.code}）。"
            ) from None
        except (URLError, TimeoutError, OSError):
            raise CanvasNetworkError(
                "无法连接 Canvas。请检查网络、学校 VPN 和平台地址。"
            ) from None

        if len(payload) > MAX_RESPONSE_BYTES:
            raise CanvasResponseError("Canvas 响应过大，已停止读取。")
        try:
            return json.loads(payload), headers
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise CanvasResponseError("Canvas 返回了无法解析的响应。") from None

    def _get_object(self, path: str, params: Optional[dict[str, Any]] = None) -> dict:
        payload, _ = self._request_json(self._build_url(path, params))
        if not isinstance(payload, dict):
            raise CanvasResponseError("Canvas 返回了非预期的数据结构。")
        return payload

    def _get_list(
        self,
        path: str,
        *,
        params: Optional[dict[str, Any]] = None,
        limit: int = 20,
    ) -> list[dict]:
        target_limit = _clamp(limit, 1, 100)
        url = self._build_url(
            path,
            {**(params or {}), "per_page": min(target_limit, 100)},
        )
        items: list[dict] = []
        seen: set[str] = set()

        for _ in range(self.max_pages):
            if url in seen:
                raise CanvasResponseError("Canvas 分页出现循环，已停止读取。")
            seen.add(url)
            payload, headers = self._request_json(url)
            if not isinstance(payload, list):
                raise CanvasResponseError("Canvas 返回了非预期的列表结构。")
            items.extend(item for item in payload if isinstance(item, dict))
            if len(items) >= target_limit:
                return items[:target_limit]

            next_url = _next_link(headers.get("link"))
            if not next_url:
                break
            url = self._validate_api_url(next_url)

        return items[:target_limit]

    def profile(self) -> dict:
        data = self._get_object("/api/v1/users/self/profile")
        return {
            "id": str(data.get("id", "")),
            "name": data.get("name") or data.get("short_name") or "",
            "short_name": data.get("short_name") or "",
            "time_zone": data.get("time_zone") or "",
        }

    def courses(self, limit: int = 30) -> list[dict]:
        rows = self._get_list(
            "/api/v1/courses",
            params={"enrollment_state": "active", "include[]": ["term"]},
            limit=limit,
        )
        return [self._course_record(item) for item in rows]

    @staticmethod
    def _course_record(item: dict) -> dict:
        roles = [
            enrollment.get("role")
            for enrollment in item.get("enrollments") or []
            if isinstance(enrollment, dict) and enrollment.get("role")
        ]
        term = item.get("term") if isinstance(item.get("term"), dict) else {}
        return {
            "id": str(item.get("id", "")),
            "name": item.get("name") or item.get("course_code") or "",
            "course_code": item.get("course_code") or "",
            "term": term.get("name") or "",
            "workflow_state": item.get("workflow_state") or "",
            "roles": list(dict.fromkeys(roles)),
            "html_url": item.get("html_url") or "",
        }

    def todo(self, limit: int = 50) -> list[dict]:
        rows = self._get_list(
            "/api/v1/users/self/todo",
            params={"include[]": ["ungraded_quizzes"]},
            limit=limit,
        )
        records = []
        for item in rows:
            assignment = item.get("assignment") if isinstance(item.get("assignment"), dict) else {}
            quiz = item.get("quiz") if isinstance(item.get("quiz"), dict) else {}
            target = assignment or quiz
            due_at = target.get("due_at") or item.get("due_at")
            records.append(
                {
                    "type": item.get("type") or ("quiz" if quiz else "assignment"),
                    "course_id": str(item.get("course_id") or target.get("course_id") or ""),
                    "title": (
                        target.get("name")
                        or item.get("title")
                        or item.get("context_name")
                        or ""
                    ),
                    "html_url": item.get("html_url") or target.get("html_url") or "",
                    **_timestamp_fields(due_at),
                }
            )
        return records

    def assignments(
        self,
        course_id: int,
        *,
        upcoming_only: bool = True,
        limit: int = 50,
    ) -> list[dict]:
        normalized_course_id = str(int(course_id))
        params: dict[str, Any] = {"order_by": "due_at"}
        if upcoming_only:
            params["bucket"] = "upcoming"
        rows = self._get_list(
            f"/api/v1/courses/{normalized_course_id}/assignments",
            params=params,
            limit=limit,
        )
        records = []
        for item in rows:
            records.append(
                {
                    "id": str(item.get("id", "")),
                    "course_id": normalized_course_id,
                    "name": item.get("name") or "",
                    "points_possible": item.get("points_possible"),
                    "submission_types": item.get("submission_types") or [],
                    "published": item.get("published"),
                    "html_url": item.get("html_url") or "",
                    **_timestamp_fields(item.get("due_at")),
                }
            )
        return records

    def announcements(self, course_id: int, limit: int = 20) -> list[dict]:
        normalized_course_id = str(int(course_id))
        rows = self._get_list(
            f"/api/v1/courses/{normalized_course_id}/discussion_topics",
            params={"only_announcements": "true", "order_by": "recent_activity"},
            limit=limit,
        )
        records = []
        for item in rows:
            author = item.get("author") if isinstance(item.get("author"), dict) else {}
            records.append(
                {
                    "id": str(item.get("id", "")),
                    "course_id": normalized_course_id,
                    "title": item.get("title") or "",
                    "author": author.get("display_name") or "",
                    "html_url": item.get("html_url") or "",
                    "preview": _plain_text(item.get("message")),
                    **_timestamp_fields(item.get("posted_at"), "posted_at"),
                }
            )
        return records

    def upcoming(
        self,
        *,
        days: int = 30,
        limit: int = 100,
        now: Optional[datetime] = None,
    ) -> dict:
        normalized_days = _clamp(days, 1, 365)
        target_limit = _clamp(limit, 1, 500)
        current = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
        horizon = current + timedelta(days=normalized_days)
        warnings = []
        assignments = []

        for course in self.courses(limit=100):
            try:
                candidates = self.assignments(
                    int(course["id"]),
                    upcoming_only=True,
                    limit=100,
                )
            except CanvasAuthError:
                raise
            except CanvasError as exc:
                warnings.append(
                    {
                        "course_id": course["id"],
                        "course_name": course["name"],
                        "message": str(exc),
                    }
                )
                continue

            for assignment in candidates:
                due = _parse_timestamp(assignment.get("due_at"))
                if due is None or due < current or due > horizon:
                    continue
                assignments.append(
                    {
                        **assignment,
                        "course_name": course["name"],
                        "course_code": course["course_code"],
                    }
                )

        assignments.sort(
            key=lambda item: (
                _parse_timestamp(item.get("due_at"))
                or datetime.max.replace(tzinfo=timezone.utc)
            )
        )
        assignments = assignments[:target_limit]
        return {
            "assignments": assignments,
            "count": len(assignments),
            "window": {
                "from": current.astimezone(SHANGHAI_TIMEZONE).isoformat(timespec="seconds"),
                "to": horizon.astimezone(SHANGHAI_TIMEZONE).isoformat(timespec="seconds"),
                "days": normalized_days,
            },
            "warnings": warnings,
        }


def _add_connection_options(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--base-url",
        default=(
            os.getenv("SJTU_CANVAS_BASE_URL", "").strip()
            or os.getenv("CANVAS_BASE_URL", "").strip()
            or DEFAULT_BASE_URL
        ),
        help=f"Canvas 平台根地址（默认 {DEFAULT_BASE_URL}）",
    )
    parser.add_argument(
        "--token-file",
        default=os.getenv("SJTU_CANVAS_TOKEN_FILE", "").strip() or None,
        help="仅包含 Canvas 令牌的本机私有文件",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=DEFAULT_TIMEOUT_SECONDS,
        help="单次请求超时秒数，3-60",
    )
    parser.add_argument(
        "--max-pages",
        type=int,
        default=DEFAULT_MAX_PAGES,
        help=f"最多读取的分页数，1-{MAX_PAGES}",
    )
    parser.add_argument("--pretty", action="store_true", help="格式化输出 JSON")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="只读查询上海交通大学 Canvas 学习平台。",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    status = subparsers.add_parser("status", help="检查令牌并读取当前用户资料")
    _add_connection_options(status)

    courses = subparsers.add_parser("courses", help="列出当前课程")
    _add_connection_options(courses)
    courses.add_argument("--limit", type=int, default=30)

    todo = subparsers.add_parser("todo", help="读取 Canvas 待办事项")
    _add_connection_options(todo)
    todo.add_argument("--limit", type=int, default=50)

    upcoming = subparsers.add_parser("upcoming", help="汇总近期作业")
    _add_connection_options(upcoming)
    upcoming.add_argument("--days", type=int, default=30)
    upcoming.add_argument("--limit", type=int, default=100)

    assignments = subparsers.add_parser("assignments", help="读取指定课程作业")
    _add_connection_options(assignments)
    assignments.add_argument("--course-id", type=int, required=True)
    assignments.add_argument("--upcoming", action="store_true", help="只读取即将到期的作业")
    assignments.add_argument("--limit", type=int, default=50)

    announcements = subparsers.add_parser("announcements", help="读取指定课程公告")
    _add_connection_options(announcements)
    announcements.add_argument("--course-id", type=int, required=True)
    announcements.add_argument("--limit", type=int, default=20)

    return parser


def _emit(payload: dict, pretty: bool) -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    print(
        json.dumps(
            payload,
            ensure_ascii=False,
            indent=2 if pretty else None,
            separators=None if pretty else (",", ":"),
        )
    )


def main(argv: Optional[list[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        client = CanvasClient(
            base_url=args.base_url,
            token=_load_token(args.token_file),
            timeout_seconds=args.timeout,
            max_pages=args.max_pages,
        )

        if args.command == "status":
            payload = {
                "ok": True,
                "command": "status",
                "base_url": client.base_url,
                "profile": client.profile(),
                "checked_at": datetime.now(SHANGHAI_TIMEZONE).isoformat(timespec="seconds"),
            }
        elif args.command == "courses":
            rows = client.courses(limit=args.limit)
            payload = {
                "ok": True,
                "command": "courses",
                "courses": rows,
                "count": len(rows),
            }
        elif args.command == "todo":
            rows = client.todo(limit=args.limit)
            payload = {
                "ok": True,
                "command": "todo",
                "todo": rows,
                "count": len(rows),
            }
        elif args.command == "upcoming":
            payload = {"ok": True, "command": "upcoming", **client.upcoming(days=args.days, limit=args.limit)}
        elif args.command == "assignments":
            rows = client.assignments(
                args.course_id,
                upcoming_only=args.upcoming,
                limit=args.limit,
            )
            payload = {
                "ok": True,
                "command": "assignments",
                "course_id": str(args.course_id),
                "assignments": rows,
                "count": len(rows),
            }
        else:
            rows = client.announcements(args.course_id, limit=args.limit)
            payload = {
                "ok": True,
                "command": "announcements",
                "course_id": str(args.course_id),
                "announcements": rows,
                "count": len(rows),
            }
    except CanvasError as exc:
        _emit(
            {
                "ok": False,
                "error": {
                    "code": exc.code,
                    "message": str(exc),
                },
            },
            args.pretty,
        )
        return 2

    _emit(payload, args.pretty)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
