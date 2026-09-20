"""Enforce total request size during reception, before multipart spooling."""

from uuid import uuid4

from starlette.responses import JSONResponse


def error_response(code, message, request_id, status=400, retryable=False):
    return JSONResponse(
        {
            "error": {
                "code": code,
                "message": message,
                "retryable": retryable,
                "request_id": request_id,
            }
        },
        status_code=status,
        headers={"X-Request-ID": request_id},
    )


class BodyTooLarge(Exception):
    pass


class InboundGuard:
    def __init__(self, app, max_bytes: int):
        self.app, self.max_bytes = app, max_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        request_id = str(uuid4())
        scope.setdefault("state", {})["request_id"] = request_id
        dev = scope["path"].startswith("/api/v1/dev/")
        limited = dev and scope["method"] == "POST"
        headers = dict(scope["headers"])
        if limited and b"content-length" in headers:
            try:
                length = int(headers[b"content-length"])
                if length < 0:
                    raise ValueError()
            except ValueError:
                response = error_response("INVALID_LENGTH", "Invalid request length.", request_id)
                return await response(scope, receive, send)
            if length > self.max_bytes:
                response = error_response(
                    "REQUEST_TOO_LARGE",
                    "The request exceeds the development limit.",
                    request_id,
                    413,
                )
                return await response(scope, receive, send)
        received = 0
        started = False

        async def bounded_receive():
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if limited and received > self.max_bytes:
                    raise BodyTooLarge()
            return message

        async def tagged_send(message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
                response_headers = message.setdefault("headers", [])
                response_headers[:] = [
                    (key, value)
                    for key, value in response_headers
                    if key.lower() != b"x-request-id"
                    and not (dev and key.lower() == b"cache-control")
                ]
                response_headers.append((b"x-request-id", request_id.encode()))
                if dev:
                    message["headers"].append((b"cache-control", b"no-store"))
            await send(message)

        try:
            await self.app(scope, bounded_receive, tagged_send)
        except BodyTooLarge:
            if started:
                raise
            response = error_response(
                "REQUEST_TOO_LARGE", "The request exceeds the development limit.", request_id, 413
            )
            await response(scope, receive, send)
