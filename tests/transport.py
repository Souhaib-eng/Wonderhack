"""Exercise actual HTTP handlers without binding sockets (restricted runners)."""
import http.client
import io
import urllib.error
import urllib.request
import urllib.response
from types import SimpleNamespace

HANDLER = None


class MemorySocket:
    def __init__(self, request):
        self.input = io.BytesIO(request)
        self.output = io.BytesIO()

    def makefile(self, *_args, **_kwargs):
        return self.input

    def sendall(self, data):
        self.output.write(data)

    def settimeout(self, _timeout):
        pass


def exchange(request):
    sock = MemorySocket(request)
    HANDLER(sock, ('127.0.0.1', 10000),
            SimpleNamespace(server_name='wonderhack.test', server_port=8080))
    return sock.output.getvalue()


class MemoryOpener:
    def __init__(self, jar):
        self.jar = jar

    def open(self, request, timeout=10):
        self.jar.add_cookie_header(request)
        headers = dict(request.header_items())
        headers['Host'] = 'wonderhack.test'
        if request.data is not None:
            headers['Content-Length'] = str(len(request.data))
        raw = f'{request.method} {request.selector} HTTP/1.1\r\n'
        raw += ''.join(f'{key}: {value}\r\n' for key, value in headers.items())
        raw = raw.encode() + b'\r\n' + (request.data or b'')
        response = http.client.HTTPResponse(MemorySocket(exchange(raw)))
        response.begin()
        result = urllib.response.addinfourl(
            io.BytesIO(response.read()), response.headers, request.full_url, response.status,
        )
        self.jar.extract_cookies(result, request)
        if response.status >= 400:
            raise urllib.error.HTTPError(request.full_url, response.status,
                                         response.reason, response.headers, result)
        return result
