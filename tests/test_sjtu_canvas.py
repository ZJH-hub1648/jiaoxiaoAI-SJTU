from __future__ import annotations

import json
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
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


class RecordingOpener:
    def __init__(self, responses):
        self.responses = responses
        self.requests = []

    def open(self, request, timeout):
        self.requests.append((request.full_url, timeout))
        response = self.responses[request.full_url]
        if isinstance(response, Exception):
            raise response
        return response


class CanvasClientTests(unittest.TestCase):
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
            "?enrollment_state=active&include%5B%5D=term&per_page=2"
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
            "?enrollment_state=active&include%5B%5D=term&per_page=2"
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
        error = HTTPError(url, 401, "Unauthorized", {}, None)
        opener = RecordingOpener({url: error})

        with self.assertRaises(sjtu_canvas.CanvasAuthError) as caught:
            self.client(opener).profile()

        self.assertNotIn("test-token", str(caught.exception))

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
