"""Polite HTTP: one request at a time, a named User-Agent, retries with backoff."""

import json
import time
import urllib.error
import urllib.request
import http.cookiejar

USER_AGENT = (
    'Mozilla/5.0 (compatible; HandlaPriceBot/1.0; '
    '+https://github.com/betokasa1982-del/handla; personal grocery prices)'
)

RETRY_STATUS = {429, 500, 502, 503, 504}


class HttpError(RuntimeError):
    def __init__(self, message, status=None):
        super().__init__(message)
        self.status = status


class Client:
    def __init__(self, min_interval=0.45, retries=3, timeout=30, user_agent=USER_AGENT):
        self.min_interval = min_interval
        self.retries = retries
        self.timeout = timeout
        self.user_agent = user_agent
        self._next = 0.0
        jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

    def request(self, url, method='GET', headers=None, body=None, accept='application/json'):
        last = None
        for attempt in range(self.retries):
            self._wait()
            hdrs = {
                'User-Agent': self.user_agent,
                'Accept': accept,
                'Accept-Language': 'sv-SE,sv;q=0.9,en;q=0.5',
            }
            if headers:
                hdrs.update(headers)
            data = None
            if body is not None:
                if isinstance(body, (dict, list)):
                    data = json.dumps(body).encode()
                    hdrs.setdefault('Content-Type', 'application/json')
                elif isinstance(body, str):
                    data = body.encode()
                else:
                    data = body
            req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
            try:
                with self.opener.open(req, timeout=self.timeout) as res:
                    raw = res.read()
                    ctype = res.headers.get('Content-Type', '')
                    text = raw.decode('utf-8', 'replace')
                    if 'json' in ctype or (text[:1] in '{['):
                        try:
                            return json.loads(text)
                        except json.JSONDecodeError as e:
                            raise HttpError('response was not JSON') from e
                    return text
            except urllib.error.HTTPError as e:
                last = HttpError(f'HTTP {e.code} for {url.split("?")[0]}', e.code)
                if e.code in RETRY_STATUS and attempt + 1 < self.retries:
                    time.sleep(min(8, 2 ** attempt))
                    continue
                raise last
            except (urllib.error.URLError, TimeoutError, OSError) as e:
                last = HttpError(str(e) or e.__class__.__name__)
                if attempt + 1 < self.retries:
                    time.sleep(min(8, 2 ** attempt))
                    continue
                raise last
        raise last or HttpError('request failed')

    def _wait(self):
        now = time.monotonic()
        if now < self._next:
            time.sleep(self._next - now)
        self._next = time.monotonic() + self.min_interval
