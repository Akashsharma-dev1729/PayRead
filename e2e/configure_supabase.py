"""Make the local Supabase stack behave like the hosted project for the E2E run:
email confirmation on, emailed links may return to the app, and a mail rate
limit high enough for the test run."""
import re
import sys

path = sys.argv[1]
s = open(path).read()
s = re.sub(r'(?m)^site_url = .*$', 'site_url = "http://localhost:3000"', s, count=1)
s = re.sub(r'(?m)^additional_redirect_urls = .*$', 'additional_redirect_urls = ["http://localhost:3000/**"]', s, count=1)


def setkey(text, section, key, value):
    m = re.search(r'(?m)^\[' + re.escape(section) + r'\]\s*$', text)
    if not m:
        return text + f'\n[{section}]\n{key} = {value}\n'
    start = m.end()
    nxt = re.search(r'(?m)^\[', text[start:])
    end = start + (nxt.start() if nxt else len(text) - start)
    body, count = re.subn(r'(?m)^' + key + r' = .*$', f'{key} = {value}', text[start:end])
    if count == 0:
        body = f'\n{key} = {value}' + body
    return text[:start] + body + text[end:]


s = setkey(s, 'auth.email', 'enable_confirmations', 'true')
s = setkey(s, 'auth.rate_limit', 'email_sent', '200')
open(path, 'w').write(s)
for line in s.splitlines():
    if re.match(r'(site_url|additional_redirect_urls|enable_confirmations|email_sent) =', line):
        print(line)
