#!/usr/bin/env python3
"""Local dev server that mirrors the production /cam/ path prefix."""
import http.server
import os

PORT = 8080
PREFIX = '/cam'

class Handler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        # Strip /cam prefix so requests for /cam/foo.js serve ./foo.js
        if path == PREFIX or path.startswith(PREFIX + '/'):
            path = path[len(PREFIX):] or '/'
        return super().translate_path(path)

    def log_message(self, fmt, *args):
        print(fmt % args)

os.chdir(os.path.dirname(os.path.abspath(__file__)))
print(f'Serving at http://localhost:{PORT}/cam/')
with http.server.HTTPServer(('', PORT), Handler) as httpd:
    httpd.serve_forever()
