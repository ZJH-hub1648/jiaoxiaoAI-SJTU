from __future__ import annotations

import io
import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError


SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import sjtu_canvas  # noqa: E402


class FakeResponse:
    def __init__(self, payload, headers=None):
        self._payload = json.dumps(payload).encode("utf-8")
        self.headers = headers or {}

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def read(self, _size):
        return self._payload


class RawResponse(FakeResponse):
    def __init__(self, payload, headers=None):
        self._payload = payload
        self.headers = headers or {}


class RecordingOpener:
    def __init__(self, responses):
        self.responses = responses
        self.requests = []

    def open(self, request, timeout):
        self.requests.append((request.full_url, timeout))
        self.last_request = request
        response = self.responses[request.full_url]
        if isinstance(response, Exception):
            raise response
        return response


class CanvasClientTests(unittest.TestCase):
    def test_legacy_token_fallback_and_default_file_precedence(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            legacy = home / "legacy.json"
            legacy.write_text(json.dumps({"canvasToken": "legacy-token"}), encoding="utf-8")
            with patch.dict(os.environ, {"JIAOXIAOAI_CONFIG": str(legacy)}, clear=True), patch.object(Path, "home", return_value=home):
                self.assertEqual(sjtu_canvas._load_token(None), "legacy-token")
                token = home / ".config" / "sjtu-canvas" / "token"
                token.parent.mkdir(parents=True)
                token.write_text("default-token", encoding="utf-8")
                self.assertEqual(sjtu_canvas._load_token(None), "default-token")

    def test_environment_token_file_precedes_environment_token(self):
        with tempfile.TemporaryDirectory() as directory:
            token = Path(directory) / "token"
            token.write_text("file-token", encoding="utf-8")
            with patch.dict(os.environ, {"SJTU_CANVAS_TOKEN_FILE": str(token), "SJTU_CANVAS_TOKEN": "env-token"}, clear=True):
                self.assertEqual(sjtu_canvas._load_token(None), "file-token")

    def test_malformed_legacy_config_is_ignored_without_exposing_content(self):
        with tempfile.TemporaryDirectory() as directory:
            legacy = Path(directory) / "legacy.json"
            with patch.dict(os.environ, {"JIAOXIAOAI_CONFIG": str(legacy)}, clear=True), patch.object(Path, "home", return_value=Path(directory)):
                for content in ['{secret', '[]', '{"canvasToken": 123}']:
                    legacy.write_text(content, encoding="utf-8")
                    with self.assertRaises(sjtu_canvas.CanvasConfigError) as caught:
                        sjtu_canvas._load_token(None)
                    self.assertNotIn(content, str(caught.exception))

    def test_non_utf8_token_file_returns_configuration_error(self):
        with tempfile.TemporaryDirectory() as directory:
            token = Path(directory) / "token"
            token.write_bytes(b'\xff\xfe\x00')
            with self.assertRaises(sjtu_canvas.CanvasConfigError):
                sjtu_canvas._load_token(str(token))

    def client(self, opener=None):
        return sjtu_canvas.CanvasClient(
            base_url="https://oc.sjtu.edu.cn",
            token="test-token",
            timeout_seconds=10,
            max_pages=5,
            opener=opener,
        )

    def test_base_url_requires_https(self):
        with self.assertRaises(sjtu_canvas.CanvasConfigError):
            sjtu_canvas._normalize_base_url("http://oc.sjtu.edu.cn")

    def test_base_url_rejects_paths_and_credentials(self):
        for value in (
            "https://oc.sjtu.edu.cn/canvas",
            "https://user:pass@oc.sjtu.edu.cn",
            "https://oc.sjtu.edu.cn?x=1",
        ):
            with self.subTest(value=value):
                with self.assertRaises(sjtu_canvas.CanvasConfigError):
                    sjtu_canvas._normalize_base_url(value)

    def test_courses_follow_same_origin_pagination(self):
        first_url = (
            "https://oc.sjtu.edu.cn/api/v1/courses"
            "?enrollment_state=active"
            "&include%5B%5D=term"
            "&include%5B%5D=enrollments"
            "&per_page=2"
        )
        second_url = "https://oc.sjtu.edu.cn/api/v1/courses?page=2"
        opener = RecordingOpener(
            {
                first_url: FakeResponse(
                    [
                        {
                            "id": 1,
                            "name": "线性代数",
                            "course_code": "MATH1205H",
                            "workflow_state": "available",
                            "html_url": "https://oc.sjtu.edu.cn/courses/1",
                            "enrollments": [{"role": "StudentEnrollment"}],
                        }
                    ],
                    {"Link": f'<{second_url}>; rel="next"'},
                ),
                second_url: FakeResponse(
                    [
                        {
                            "id": 2,
                            "name": "高等数学",
                            "course_code": "MATH1201",
                            "workflow_state": "available",
                            "html_url": "https://oc.sjtu.edu.cn/courses/2",
                            "enrollments": [{"role": "StudentEnrollment"}],
                        }
                    ]
                ),
            }
        )

        rows = self.client(opener).courses(limit=2)

        self.assertEqual([row["id"] for row in rows], ["1", "2"])
        self.assertEqual(len(opener.requests), 2)

    def test_cross_origin_pagination_is_rejected_before_second_request(self):
        first_url = (
            "https://oc.sjtu.edu.cn/api/v1/courses"
            "?enrollment_state=active"
            "&include%5B%5D=term"
            "&include%5B%5D=enrollments"
            "&per_page=2"
        )
        opener = RecordingOpener(
            {
                first_url: FakeResponse(
                    [{"id": 1, "name": "课程"}],
                    {
                        "Link": (
                            '<https://example.com/api/v1/courses?page=2>; '
                            'rel="next"'
                        )
                    },
                )
            }
        )

        with self.assertRaises(sjtu_canvas.CanvasRedirectError):
            self.client(opener).courses(limit=2)

        self.assertEqual(len(opener.requests), 1)

    def test_authentication_error_does_not_echo_token(self):
        url = "https://oc.sjtu.edu.cn/api/v1/users/self/profile"
        error = HTTPError(url, 401, "Unauthorized", {}, io.BytesIO(b""))
        self.addCleanup(error.close)
        opener = RecordingOpener({url: error})

        with self.assertRaises(sjtu_canvas.CanvasAuthError) as caught:
            self.client(opener).profile()

        self.assertNotIn("test-token", str(caught.exception))

    def test_request_is_get_and_uses_bearer_header(self):
        url = "https://oc.sjtu.edu.cn/api/v1/users/self/profile"
        opener = RecordingOpener(
            {
                url: FakeResponse(
                    {
                        "id": 7,
                        "name": "测试用户",
                        "short_name": "测试",
                        "time_zone": "Asia/Shanghai",
                    }
                )
            }
        )

        profile = self.client(opener).profile()

        self.assertEqual(profile["id"], "7")
        self.assertEqual(opener.last_request.get_method(), "GET")
        self.assertEqual(
            opener.last_request.get_header("Authorization"),
            "Bearer test-token",
        )

    def test_rate_limit_is_reported_without_raw_response(self):
        url = "https://oc.sjtu.edu.cn/api/v1/users/self/profile"
        error = HTTPError(url, 429, "Too Many Requests", {}, io.BytesIO(b""))
        self.addCleanup(error.close)
        opener = RecordingOpener({url: error})

        with self.assertRaises(sjtu_canvas.CanvasRateLimitError):
            self.client(opener).profile()

    def test_malformed_json_is_rejected(self):
        url = "https://oc.sjtu.edu.cn/api/v1/users/self/profile"
        opener = RecordingOpener({url: RawResponse(b"not-json")})

        with self.assertRaises(sjtu_canvas.CanvasResponseError):
            self.client(opener).profile()

    def test_default_token_file_is_used_when_environment_is_empty(self):
        token_path = MagicMock()
        token_path.is_file.return_value = True
        with patch.dict(
            os.environ,
            {
                "SJTU_CANVAS_TOKEN": "",
                "CANVAS_API_TOKEN": "",
                "CANVAS_ACCESS_TOKEN": "",
            },
            clear=False,
        ):
            with patch.object(
                sjtu_canvas,
                "_default_token_path",
                return_value=token_path,
            ):
                with patch.object(
                    sjtu_canvas,
                    "_read_token_file",
                    return_value="file-token",
                ):
                    self.assertEqual(sjtu_canvas._load_token(None), "file-token")

    def test_access_token_environment_is_supported(self):
        with patch.dict(
            os.environ,
            {
                "SJTU_CANVAS_TOKEN": "",
                "CANVAS_API_TOKEN": "",
                "CANVAS_ACCESS_TOKEN": "access-token",
            },
            clear=False,
        ):
            self.assertEqual(sjtu_canvas._load_token(None), "access-token")

    def test_sjtu_token_takes_precedence_over_legacy_environment(self):
        with patch.dict(
            os.environ,
            {
                "SJTU_CANVAS_TOKEN": "preferred-token",
                "CANVAS_ACCESS_TOKEN": "legacy-token",
            },
            clear=False,
        ):
            self.assertEqual(sjtu_canvas._load_token(None), "preferred-token")

    def test_explicit_token_file_takes_precedence_over_environment(self):
        with patch.dict(
            os.environ,
            {"SJTU_CANVAS_TOKEN": "environment-token"},
            clear=False,
        ):
            with patch.object(
                sjtu_canvas,
                "_read_token_file",
                return_value="file-token",
            ):
                self.assertEqual(
                    sjtu_canvas._load_token("custom-token-file"),
                    "file-token",
                )

    def test_explicit_missing_token_file_is_an_actionable_error(self):
        with self.assertRaises(sjtu_canvas.CanvasConfigError) as caught:
            sjtu_canvas._load_token("C:\\definitely-missing\\canvas-token")

        self.assertIn("无法读取令牌文件", str(caught.exception))

    def test_upcoming_filters_window_and_marks_shanghai_time(self):
        class UpcomingClient(sjtu_canvas.CanvasClient):
            def courses(self, limit=30):
                return [
                    {
                        "id": "10",
                        "name": "线性代数",
                        "course_code": "MATH1205H",
                    }
                ]

            def assignments(self, course_id, *, upcoming_only=True, limit=50):
                return [
                    {
                        "id": "1",
                        "course_id": str(course_id),
                        "name": "近期作业",
                        "due_at": "2026-11-22T15:59:59Z",
                        "due_at_shanghai": "2026-11-22T23:59:59+08:00",
                        "html_url": "",
                    },
                    {
                        "id": "2",
                        "course_id": str(course_id),
                        "name": "远期作业",
                        "due_at": "2027-11-22T15:59:59Z",
                        "due_at_shanghai": "2027-11-22T23:59:59+08:00",
                        "html_url": "",
                    },
                ]

        client = UpcomingClient(
            base_url="https://oc.sjtu.edu.cn",
            token="test-token",
        )
        result = client.upcoming(
            days=7,
            now=datetime(2026, 11, 20, 0, 0, tzinfo=timezone.utc),
        )

        self.assertEqual(result["count"], 1)
        self.assertEqual(result["assignments"][0]["id"], "1")
        self.assertEqual(result["assignments"][0]["course_name"], "线性代数")
        self.assertEqual(
            result["assignments"][0]["due_at_shanghai"],
            "2026-11-22T23:59:59+08:00",
        )

    def test_announcement_html_is_reduced_to_plain_text(self):
        text = sjtu_canvas._plain_text(
            "<p>第一段</p><script>bad()</script><p>第二段</p>",
            limit=100,
        )

        self.assertIn("第一段", text)
        self.assertNotIn("bad()", text)
        self.assertNotIn("<p>", text)


if __name__ == "__main__":
    unittest.main()
