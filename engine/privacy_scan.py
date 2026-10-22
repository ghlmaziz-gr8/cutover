"""Finds text that looks like personal data before it leaves Cutover or is saved. Standard library only.

The scanner reports only the kind of pattern it found, never the value itself, so its result is safe to log and show.
It supports human review and does not replace it. Patterns are deliberately broad: a false alarm blocks a save,
a miss lets personal data through.
"""
import re

PATTERNS = {
    "email address": re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}"),
    "phone number": re.compile(r"(?<![\w.])\(?\b\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b(?![\w.])"),
    "national ID number": re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),
    "record number": re.compile(r"\b(?:MRN|patient|record|chart)[ _-]?(?:no|num|number|id)?\s*[:=#]\s*[A-Za-z0-9-]{4,}\b",
                                re.IGNORECASE),
    "card number": re.compile(r"\b(?:\d[ -]?){13,19}\b"),
}


def _luhn(digits: str) -> bool:
    total, double = 0, False
    for ch in reversed(digits):
        d = int(ch)
        if double:
            d *= 2
            if d > 9:
                d -= 9
        total += d
        double = not double
    return total % 10 == 0


def scan(text: str) -> list[str]:
    """The kinds of personal data pattern found in the text, sorted. Empty when nothing was found."""
    found = set()
    for kind, pattern in PATTERNS.items():
        for match in pattern.finditer(text or ""):
            if kind == "card number":
                digits = re.sub(r"\D", "", match.group(0))
                if not (13 <= len(digits) <= 19 and _luhn(digits)):
                    continue
            found.add(kind)
            break
    return sorted(found)


def is_clean(text: str) -> bool:
    return not scan(text)
