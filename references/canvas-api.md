# Canvas API details

## Authentication

The Python and Node clients send the token as `Authorization: Bearer <token>` to the official Canvas v1 API. They check an explicit `--token-file`, then `SJTU_CANVAS_TOKEN_FILE`, then `SJTU_CANVAS_TOKEN`, `CANVAS_API_TOKEN`, or `CANVAS_ACCESS_TOKEN`, then the default file `~/.config/sjtu-canvas/token`. The legacy `~/.jiaoxiaoai/config.json` token is used only as a final compatibility fallback. The token is never included in JSON output or error messages.

SJTU Canvas confirms token authentication by returning HTTP `401` for an unauthenticated request to `/api/v1/courses`. If the tenant disables personal access tokens, the user must obtain an approved token through the school's supported Canvas process.

## Endpoints

| Command | Method and path | Purpose |
| --- | --- | --- |
| `status` | `GET /api/v1/users/self/profile` | Verify the token and identify the current user |
| `courses` | `GET /api/v1/courses` | List active enrollments |
| `todo` | `GET /api/v1/users/self/todo` | List Canvas to-do items |
| `assignments` | `GET /api/v1/courses/{course_id}/assignments` | List a course's assignments |
| `announcements` | `GET /api/v1/courses/{course_id}/discussion_topics` | List announcements |

The `upcoming` command combines courses and their upcoming assignments, filters them to the requested date window, and sorts by due time. A permission error for one course becomes a warning; authentication failure aborts the request.

## Guardrails

- Only `GET` requests are implemented.
- Redirects are rejected, preventing a token from being forwarded to another host.
- Pagination follows links only when they remain on the configured origin and under `/api/v1/`.
- Responses are capped at 8 MiB, pagination is capped, and short or missing `Link` chains terminate normally.
- Canvas timestamps are normalized to `Asia/Shanghai` while the original timestamp is retained.
- Rich announcement text is converted to a short plain-text preview before output.

## Troubleshooting

`401`: The token is invalid, expired, or not accepted by the tenant.

`403`: The token is valid but lacks course-level access.

`404`: The course or resource does not exist, or the current account cannot see it.

`429`: Canvas rate-limited the account. Wait before retrying.

Connection failure: Check the campus network or VPN and confirm that `--base-url` still points to the official Canvas root.
