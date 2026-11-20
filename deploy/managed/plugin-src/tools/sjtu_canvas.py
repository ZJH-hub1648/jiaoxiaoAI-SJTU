"""
title: 上海交大 Canvas 学习助手
description: 使用当前用户自己的 Canvas 访问令牌，只读查询课程、待办和作业。
version: 0.1.0
managed_id: jiaoxiaoai_sjtu_canvas
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
from datetime import datetime, timezone
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

try:
    from pydantic import BaseModel, Field
except ImportError:  # Keep the file runnable as a standalone CLI during development.
    BaseModel = object

    def Field(default=None, **_: Any):
        return default


DEFAULT_BASE_URL = 'https://oc.sjtu.edu.cn'
DEFAULT_TIMEOUT_SECONDS = 15
DEFAULT_MAX_PAGES = 5
MAX_RESPONSE_BYTES = 8 * 1024 * 1024


class CanvasError(RuntimeError):
    """Base error for safe, user-facing Canvas failures."""


class CanvasConfigurationError(CanvasError):
    pass


class CanvasAuthenticationError(CanvasError):
    pass


class CanvasRateLimitError(CanvasError):
    pass


class CanvasRedirectError(CanvasError):
    pass


class CanvasAPIError(CanvasError):
    pass


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _normalize_base_url(value: str) -> str:
    raw = (value or DEFAULT_BASE_URL).strip().rstrip('/')
    parsed = urlsplit(raw)
    if parsed.username or parsed.password:
        raise CanvasConfigurationError('Canvas 地址不能包含用户名或密码。')
    if parsed.query or parsed.fragment:
        raise CanvasConfigurationError('Canvas 地址不能包含查询参数或片段。')
    if parsed.path not in ('', '/'):
        raise CanvasConfigurationError('Canvas 地址应填写平台根地址，例如 https://oc.sjtu.edu.cn。')

    hostname = (parsed.hostname or '').lower()
    is_loopback = hostname in {'localhost', '127.0.0.1', '::1'}
    if parsed.scheme != 'https' and not (parsed.scheme == 'http' and is_loopback):
        raise CanvasConfigurationError('Canvas 地址必须使用 HTTPS。')
    if not hostname:
        raise CanvasConfigurationError('Canvas 地址缺少主机名。')
    return urlunsplit((parsed.scheme, parsed.netloc, '', '', ''))


def _clamp(value: int, minimum: int, maximum: int) -> int:
    return max(minimum, min(maximum, int(value)))


def _next_link(header_value: str | None) -> str | None:
    if not header_value:
        return None
    for part in re.split(r',(?=\s*<)', header_value):
        match = re.search(r'<([^>]+)>\s*;(.*)', part)
        if match and re.search(r'(?:^|;)\s*rel="?next"?', match.group(2), re.IGNORECASE):
            return match.group(1).strip()
    return None


class CanvasClient:
    def __init__(
        self,
        *,
        base_url: str,
        api_token: str,
        timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
        max_pages: int = DEFAULT_MAX_PAGES,
        opener=None,
    ):
        token = (api_token or '').strip()
        if not token:
            raise CanvasConfigurationError('未配置 Canvas 访问令牌。')
        self.base_url = _normalize_base_url(base_url)
        self._token = token
        self.timeout_seconds = _clamp(timeout_seconds, 3, 60)
        self.max_pages = _clamp(max_pages, 1, 20)
        self._opener = opener or build_opener(_NoRedirect())

    def _validate_api_url(self, url: str) -> str:
        parsed = urlsplit(url)
        base = urlsplit(self.base_url)
        if (
            parsed.scheme != base.scheme
            or parsed.netloc.lower() != base.netloc.lower()
            or not parsed.path.startswith('/api/v1/')
        ):
            raise CanvasRedirectError('Canvas 返回了非预期地址，已停止读取。')
        return url

    def _build_url(self, path: str, params: dict[str, Any] | None = None) -> str:
        if not path.startswith('/api/v1/'):
            raise CanvasConfigurationError('仅允许调用 Canvas v1 API。')
        query_items = []
        for key, value in (params or {}).items():
            values = value if isinstance(value, list) else [value]
            query_items.extend((key, item) for item in values)
        query = urlencode(query_items)
        return self._validate_api_url(f'{self.base_url}{path}{"?" + query if query else ""}')

    def _request_json(self, url: str) -> tuple[Any, dict[str, str]]:
        request = Request(
            self._validate_api_url(url),
            headers={
                'Authorization': f'Bearer {self._token}',
                'Accept': 'application/json',
                'User-Agent': 'jiaoxiaoAI-SJTU-Canvas/0.1',
            },
            method='GET',
        )
        try:
            with self._opener.open(request, timeout=self.timeout_seconds) as response:
                payload = response.read(MAX_RESPONSE_BYTES + 1)
                if len(payload) > MAX_RESPONSE_BYTES:
                    raise CanvasAPIError('Canvas 响应过大，已停止读取。')
                headers = {key.lower(): value for key, value in response.headers.items()}
        except HTTPError as exc:
            if 300 <= exc.code < 400:
                raise CanvasRedirectError('Canvas 要求登录跳转，请检查令牌是否有效或是否需要校内网络。') from None
            if exc.code in {401, 403}:
                raise CanvasAuthenticationError('Canvas 拒绝了访问，请检查访问令牌和账号权限。') from None
            if exc.code == 429:
                raise CanvasRateLimitError('Canvas 请求过于频繁，请稍后重试。') from None
            if exc.code == 404:
                raise CanvasAPIError('请求的 Canvas 资源不存在或当前账号无权查看。') from None
            raise CanvasAPIError(f'Canvas 请求失败（HTTP {exc.code}）。') from None
        except (URLError, TimeoutError, OSError):
            raise CanvasAPIError('无法连接 Canvas，请检查网络、代理和平台地址。') from None

        try:
            return json.loads(payload), headers
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise CanvasAPIError('Canvas 返回了无法解析的响应。') from None

    def _get_paginated(self, path: str, *, params: dict[str, Any], limit: int) -> list[dict]:
        target_limit = _clamp(limit, 1, 100)
        url = self._build_url(path, {**params, 'per_page': min(100, target_limit)})
        items: list[dict] = []
        seen: set[str] = set()

        for _ in range(self.max_pages):
            if url in seen:
                raise CanvasAPIError('Canvas 分页出现循环，已停止读取。')
            seen.add(url)
            payload, headers = self._request_json(url)
            if not isinstance(payload, list):
                raise CanvasAPIError('Canvas 返回了非预期的数据结构。')
            items.extend(item for item in payload if isinstance(item, dict))
            if len(items) >= target_limit:
                return items[:target_limit]

            next_url = _next_link(headers.get('link'))
            if not next_url:
                break
            url = self._validate_api_url(next_url)

        return items[:target_limit]

    def profile(self) -> dict:
        payload, _ = self._request_json(self._build_url('/api/v1/users/self/profile'))
        if not isinstance(payload, dict):
            raise CanvasAPIError('Canvas 返回了非预期的用户数据结构。')
        return {
            'id': str(payload.get('id', '')),
            'name': payload.get('name') or payload.get('short_name') or '',
        }

    def courses(self, limit: int = 20) -> list[dict]:
        payload = self._get_paginated(
            '/api/v1/courses',
            params={'enrollment_state': 'active'},
            limit=limit,
        )
        result = []
        for course in payload:
            enrollments = course.get('enrollments') or []
            roles = [item.get('role') for item in enrollments if isinstance(item, dict) and item.get('role')]
            result.append(
                {
                    'id': str(course.get('id', '')),
                    'name': course.get('name') or course.get('course_code') or '',
                    'course_code': course.get('course_code') or '',
                    'role': ', '.join(dict.fromkeys(roles)),
                    'html_url': course.get('html_url') or '',
                }
            )
        return result

    def todo(self, limit: int = 20) -> list[dict]:
        payload = self._get_paginated(
            '/api/v1/users/self/todo',
            params={'include[]': ['ungraded_quizzes']},
            limit=limit,
        )
        result = []
        for item in payload:
            assignment = item.get('assignment') if isinstance(item.get('assignment'), dict) else {}
            quiz = item.get('quiz') if isinstance(item.get('quiz'), dict) else {}
            target = assignment or quiz
            course_id = item.get('course_id') or target.get('course_id')
            result.append(
                {
                    'type': item.get('type') or ('quiz' if quiz else 'assignment'),
                    'course_id': str(course_id or ''),
                    'title': target.get('name') or item.get('title') or item.get('context_name') or '',
                    'due_at': target.get('due_at') or item.get('due_at'),
                    'html_url': item.get('html_url') or target.get('html_url') or '',
                }
            )
        return result

    def assignments(self, course_id: int | str, *, upcoming_only: bool = True, limit: int = 30) -> list[dict]:
        try:
            normalized_course_id = str(int(course_id))
        except (TypeError, ValueError):
            raise CanvasConfigurationError('课程 ID 必须是数字。') from None
        params = {'bucket': 'upcoming'} if upcoming_only else {}
        payload = self._get_paginated(
            f'/api/v1/courses/{normalized_course_id}/assignments',
            params=params,
            limit=limit,
        )
        return [
            {
                'id': str(item.get('id', '')),
                'course_id': normalized_course_id,
                'name': item.get('name') or '',
                'due_at': item.get('due_at'),
                'points_possible': item.get('points_possible'),
                'submission_types': item.get('submission_types') or [],
                'html_url': item.get('html_url') or '',
            }
            for item in payload
        ]


def _json_result(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


class Tools:
    class UserValves(BaseModel):
        canvas_base_url: str = Field(
            default=DEFAULT_BASE_URL,
            description='上海交大 Canvas 平台根地址',
        )
        canvas_api_token: str = Field(
            default='',
            description='当前用户自己的 Canvas 访问令牌；不要发送到聊天中',
            repr=False,
            json_schema_extra={'input': {'type': 'password'}},
        )
        timeout_seconds: int = Field(
            default=DEFAULT_TIMEOUT_SECONDS,
            description='单次请求超时秒数，范围 3 至 60',
        )
        max_pages: int = Field(
            default=DEFAULT_MAX_PAGES,
            description='最多读取的 Canvas 分页数，范围 1 至 20',
        )

    @staticmethod
    def _client(values) -> CanvasClient:
        if values is None:
            raise CanvasConfigurationError('请先在工具设置中配置 Canvas。')
        token = getattr(values, 'canvas_api_token', '')
        if not token:
            raise CanvasConfigurationError(
                '请先在“上海交大 Canvas 学习助手”工具设置中填写自己的 Canvas 访问令牌。'
            )
        return CanvasClient(
            base_url=getattr(values, 'canvas_base_url', DEFAULT_BASE_URL),
            api_token=token,
            timeout_seconds=getattr(values, 'timeout_seconds', DEFAULT_TIMEOUT_SECONDS),
            max_pages=getattr(values, 'max_pages', DEFAULT_MAX_PAGES),
        )

    @staticmethod
    async def _emit(event_emitter, description: str) -> None:
        if event_emitter:
            await event_emitter(
                {
                    'type': 'status',
                    'data': {'description': description, 'done': False},
                }
            )

    async def canvas_status(self, __user__: dict = None, __event_emitter__=None) -> str:
        """检查当前用户的 Canvas 配置和连接状态，不返回访问令牌。"""
        try:
            client = self._client((__user__ or {}).get('valves'))
            await self._emit(__event_emitter__, '正在检查 Canvas 连接')
            profile = await asyncio.to_thread(client.profile)
            return _json_result(
                {
                    'status': 'ok',
                    'base_url': client.base_url,
                    'profile': profile,
                    'checked_at': datetime.now(timezone.utc).isoformat(),
                }
            )
        except CanvasError as exc:
            return _json_result({'error': str(exc)})

    async def list_canvas_courses(self, limit: int = 20, __user__: dict = None, __event_emitter__=None) -> str:
        """
        读取当前用户正在参与的 Canvas 课程。

        :param limit: 最多返回的课程数，范围 1 至 100
        """
        try:
            client = self._client((__user__ or {}).get('valves'))
            await self._emit(__event_emitter__, '正在读取 Canvas 课程')
            courses = await asyncio.to_thread(client.courses, limit)
            return _json_result({'courses': courses, 'count': len(courses)})
        except CanvasError as exc:
            return _json_result({'error': str(exc)})

    async def get_canvas_todo(self, limit: int = 20, __user__: dict = None, __event_emitter__=None) -> str:
        """
        读取当前用户 Canvas 中的待办事项和近期截止任务。

        :param limit: 最多返回的事项数，范围 1 至 100
        """
        try:
            client = self._client((__user__ or {}).get('valves'))
            await self._emit(__event_emitter__, '正在读取 Canvas 待办')
            items = await asyncio.to_thread(client.todo, limit)
            return _json_result({'todo': items, 'count': len(items)})
        except CanvasError as exc:
            return _json_result({'error': str(exc)})

    async def list_canvas_assignments(
        self,
        course_id: int,
        upcoming_only: bool = True,
        limit: int = 30,
        __user__: dict = None,
        __event_emitter__=None,
    ) -> str:
        """
        读取指定 Canvas 课程中的作业。

        :param course_id: Canvas 课程 ID，可从 list_canvas_courses 获取
        :param upcoming_only: 是否只读取尚未到期的作业
        :param limit: 最多返回的作业数，范围 1 至 100
        """
        try:
            client = self._client((__user__ or {}).get('valves'))
            await self._emit(__event_emitter__, '正在读取 Canvas 作业')
            assignments = await asyncio.to_thread(
                client.assignments,
                course_id,
                upcoming_only=upcoming_only,
                limit=limit,
            )
            return _json_result({'course_id': str(course_id), 'assignments': assignments, 'count': len(assignments)})
        except CanvasError as exc:
            return _json_result({'error': str(exc)})


def _cli_client() -> CanvasClient:
    return CanvasClient(
        base_url=os.getenv('CANVAS_BASE_URL', DEFAULT_BASE_URL),
        api_token=os.getenv('CANVAS_API_TOKEN', ''),
        timeout_seconds=int(os.getenv('CANVAS_TIMEOUT_SECONDS', DEFAULT_TIMEOUT_SECONDS)),
        max_pages=int(os.getenv('CANVAS_MAX_PAGES', DEFAULT_MAX_PAGES)),
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='Read-only SJTU Canvas client')
    parser.add_argument('command', choices=['status', 'courses', 'todo', 'assignments'])
    parser.add_argument('--limit', type=int, default=20)
    parser.add_argument('--course-id', type=int)
    parser.add_argument('--all-assignments', action='store_true')
    args = parser.parse_args(argv)

    try:
        client = _cli_client()
        if args.command == 'status':
            result = {'status': 'ok', 'base_url': client.base_url, 'profile': client.profile()}
        elif args.command == 'courses':
            result = {'courses': client.courses(args.limit)}
        elif args.command == 'todo':
            result = {'todo': client.todo(args.limit)}
        else:
            if args.course_id is None:
                parser.error('assignments 需要 --course-id')
            result = {
                'course_id': str(args.course_id),
                'assignments': client.assignments(
                    args.course_id,
                    upcoming_only=not args.all_assignments,
                    limit=args.limit,
                ),
            }
    except (CanvasError, ValueError) as exc:
        print(_json_result({'error': str(exc)}))
        return 2

    print(_json_result(result))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
