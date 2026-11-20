import asyncio
import importlib.util
import io
import json
import unittest
from pathlib import Path
from urllib.error import HTTPError

PLUGIN_PATH = (
    Path(__file__).resolve().parents[2]
    / 'deploy'
    / 'managed'
    / 'plugin-src'
    / 'tools'
    / 'sjtu_canvas.py'
)


def _load_plugin():
    spec = importlib.util.spec_from_file_location('sjtu_canvas_plugin', PLUGIN_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class _Response:
    def __init__(self, payload, headers=None):
        self._payload = json.dumps(payload).encode()
        self.headers = headers or {}
        self.status = 200

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self, size=-1):
        return self._payload if size < 0 else self._payload[:size]


class _Opener:
    def __init__(self, responses):
        self.responses = list(responses)
        self.requests = []

    def open(self, request, timeout):
        self.requests.append(request)
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


class SjtuCanvasPluginTests(unittest.TestCase):
    def test_courses_follows_same_origin_pagination(self):
        plugin = _load_plugin()
        opener = _Opener(
            [
                _Response(
                    [
                        {
                            'id': 101,
                            'name': '线性代数',
                            'course_code': 'MATH1201',
                            'enrollments': [{'role': 'StudentEnrollment'}],
                        }
                    ],
                    {
                        'Link': (
                            '<https://oc.sjtu.edu.cn/api/v1/courses?page=2&per_page=2>; '
                            'rel="next", <https://oc.sjtu.edu.cn/api/v1/courses?page=2>; '
                            'rel="last"'
                        )
                    },
                ),
                _Response(
                    [
                        {
                            'id': 202,
                            'name': '大学物理',
                            'course_code': 'PHYS1201',
                            'enrollments': [{'role': 'StudentEnrollment'}],
                        }
                    ]
                ),
            ]
        )
        client = plugin.CanvasClient(
            base_url='https://oc.sjtu.edu.cn',
            api_token='secret-token',
            opener=opener,
        )

        courses = client.courses(limit=2)

        self.assertEqual([course['id'] for course in courses], ['101', '202'])
        self.assertEqual(courses[0]['role'], 'StudentEnrollment')
        self.assertEqual(
            opener.requests[0].get_header('Authorization'),
            'Bearer secret-token',
        )
        self.assertIn('enrollment_state=active', opener.requests[0].full_url)

    def test_cross_origin_pagination_is_rejected_without_sending_token(self):
        plugin = _load_plugin()
        opener = _Opener(
            [
                _Response(
                    [{'id': 101, 'name': '课程'}],
                    {'Link': '<https://attacker.example/api/v1/courses?page=2>; rel="next"'},
                )
            ]
        )
        client = plugin.CanvasClient(
            base_url='https://oc.sjtu.edu.cn',
            api_token='secret-token',
            opener=opener,
        )

        with self.assertRaises(plugin.CanvasRedirectError):
            client.courses(limit=2)

        self.assertEqual(len(opener.requests), 1)

    def test_authentication_error_does_not_echo_token(self):
        plugin = _load_plugin()
        token = 'do-not-print-this-token'
        error = HTTPError(
            'https://oc.sjtu.edu.cn/api/v1/users/self/profile',
            401,
            'Unauthorized',
            {},
            io.BytesIO(),
        )
        client = plugin.CanvasClient(
            base_url='https://oc.sjtu.edu.cn',
            api_token=token,
            opener=_Opener([error]),
        )

        try:
            with self.assertRaises(plugin.CanvasAuthenticationError) as caught:
                client.profile()
        finally:
            error.close()

        self.assertNotIn(token, str(caught.exception))

    def test_base_url_requires_https(self):
        plugin = _load_plugin()

        with self.assertRaisesRegex(plugin.CanvasConfigurationError, 'HTTPS'):
            plugin.CanvasClient(base_url='http://oc.sjtu.edu.cn', api_token='token')

    def test_unconfigured_tool_returns_actionable_error(self):
        plugin = _load_plugin()

        result = json.loads(asyncio.run(plugin.Tools().canvas_status(__user__={})))

        self.assertIn('工具设置', result['error'])


if __name__ == '__main__':
    unittest.main()
