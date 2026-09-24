"""Field validation for job writes.

Model.objects.create() does not check max_length, so without these an oversized
string from a scraped page would reach Postgres, which rejects it with a DataError
(a 500) instead of a clean 400 or a truncated value.
"""

import re
from urllib.parse import urlsplit

WHITESPACE_RE = re.compile(r'\s+')
CONTROL_RE = re.compile(r'[\x00-\x1f\x7f]')

MAX_NAME = 200
MAX_COMPANY = 200
MAX_SALARY = 100
MAX_LINK = 500


def clean_text(value, max_len):
    """Trimmed, whitespace-collapsed, length-capped text -- or None if empty."""
    if not isinstance(value, str):
        return None
    # Collapse first, strip control characters second: doing it the other way
    # round deletes the newlines and tabs holding words apart, turning a scraped
    # "Senior\n\tEngineer" into "SeniorEngineer".
    value = CONTROL_RE.sub('', WHITESPACE_RE.sub(' ', value)).strip()
    return value[:max_len] or None


def clean_link(value):
    """(link, error). Only absolute http(s) URLs are accepted."""
    if not isinstance(value, str):
        return None, None
    value = value.strip()
    if not value:
        return None, None
    if CONTROL_RE.search(value) or WHITESPACE_RE.search(value):
        return None, 'Job link must be a valid http(s) URL.'
    if len(value) > MAX_LINK:
        return None, f'Job link must be at most {MAX_LINK} characters.'
    try:
        parts = urlsplit(value)
    except ValueError:
        return None, 'Job link must be a valid http(s) URL.'
    if parts.scheme not in ('http', 'https') or not parts.netloc:
        return None, 'Job link must be a valid http(s) URL.'
    return value, None


def clean_link_for_update(value, current):
    """As clean_link, but tolerates an existing non-URL value being echoed back.

    Some rows predate validation and hold notes like 'easy apply' in this field.
    The edit form submits every field on every save, so rejecting those outright
    would make those rows permanently uneditable. Anything *new* still has to be
    a real URL, so 'javascript:' can never enter the table this way.
    """
    if isinstance(value, str) and current is not None and value.strip() == current:
        return current, None
    return clean_link(value)
