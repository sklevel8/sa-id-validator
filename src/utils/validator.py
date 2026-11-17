"""Mathematical validation of South African identity numbers.

A 13 digit SA ID has the structure::

    YYMMDD SSSS C A Z
    |      |    | | +-- Z : Luhn (modulus 10) check digit
    |      |    | +---- A : legacy race digit, currently 8 or 9 (unused)
    |      |    +------ C : 0 = SA citizen, 1 = permanent resident
    |      +----------- SSSS : 0000-4999 female, 5000-9999 male
    +------------------ YYMMDD : date of birth, century omitted

The check digit is a standard Luhn checksum computed over the first twelve
digits.  Everything in this module is pure and side effect free so that it can
be unit tested without touching a PDF.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from enum import Enum

ID_LENGTH = 13
MAX_AGE_YEARS = 120
ID_PATTERN = re.compile(r"^\d{13}$")


class RejectionReason(str, Enum):
    """Machine readable reasons an identity number failed verification."""

    LENGTH = "ID_LENGTH_INVALID"
    NON_NUMERIC = "ID_NON_NUMERIC"
    CHECKSUM = "LUHN_FAILED"
    INVALID_DATE = "ID_DATE_INVALID"
    FUTURE_DATE = "ID_DATE_IN_FUTURE"
    IMPLAUSIBLE_DATE = "ID_DATE_IMPLAUSIBLE"
    CITIZENSHIP = "ID_CITIZENSHIP_INVALID"


class Gender(str, Enum):
    FEMALE = "female"
    MALE = "male"


class Citizenship(str, Enum):
    SA_CITIZEN = "sa_citizen"
    PERMANENT_RESIDENT = "permanent_resident"


@dataclass(frozen=True, slots=True)
class IdAnalysis:
    """Outcome of validating a single identity number."""

    value: str
    valid: bool
    reason: RejectionReason | None = None
    date_of_birth: date | None = None
    gender: Gender | None = None
    citizenship: Citizenship | None = None


def luhn_check_digit(payload: str) -> int:
    """Return the Luhn check digit that should follow ``payload``.

    ``payload`` must contain only digits.  The rightmost payload digit is
    doubled, then every second digit moving left, which is exactly how the SA
    ID checksum is defined.
    """
    if not payload or not payload.isdigit():
        raise ValueError("payload must be a non-empty string of digits")

    total = 0
    for index, char in enumerate(reversed(payload)):
        digit = int(char)
        if index % 2 == 0:
            digit *= 2
            if digit > 9:
                digit -= 9
        total += digit
    return (10 - total % 10) % 10


def is_luhn_valid(number: str) -> bool:
    """True when the final digit of ``number`` is a correct Luhn checksum."""
    if len(number) < 2 or not number.isdigit():
        return False
    return luhn_check_digit(number[:-1]) == int(number[-1])


def _birthdate_candidates(yy: int, mm: int, dd: int) -> list[date]:
    candidates: list[date] = []
    for year in (1900 + yy, 2000 + yy):
        try:
            candidates.append(date(year, mm, dd))
        except ValueError:
            # 31 February and friends simply do not exist.
            continue
    return candidates


def _resolve_birthdate(yy: int, mm: int, dd: int, today: date) -> tuple[date | None, RejectionReason | None]:
    if not 1 <= mm <= 12 or not 1 <= dd <= 31:
        return None, RejectionReason.INVALID_DATE

    candidates = _birthdate_candidates(yy, mm, dd)
    if not candidates:
        return None, RejectionReason.INVALID_DATE

    plausible: list[date] = []
    for candidate in candidates:
        age_days = (today - candidate).days
        if age_days < 0:
            continue
        if age_days > MAX_AGE_YEARS * 365.25:
            continue
        plausible.append(candidate)

    if not plausible:
        if all(candidate > today for candidate in candidates):
            return None, RejectionReason.FUTURE_DATE
        return None, RejectionReason.IMPLAUSIBLE_DATE

    # The century pivot: when both 19YY and 20YY are plausible prefer the
    # younger candidate, which is what every other SA ID validator does.
    return max(plausible), None


def analyse_id_number(value: str, *, today: date | None = None) -> IdAnalysis:
    """Validate ``value`` and return the parsed demographic attributes.

    This never raises: every failure path is reported through
    :attr:`IdAnalysis.reason`.
    """
    today = today or date.today()
    cleaned = value.strip()

    if len(cleaned) != ID_LENGTH:
        return IdAnalysis(cleaned, False, RejectionReason.LENGTH)
    if not ID_PATTERN.match(cleaned):
        return IdAnalysis(cleaned, False, RejectionReason.NON_NUMERIC)
    if not is_luhn_valid(cleaned):
        return IdAnalysis(cleaned, False, RejectionReason.CHECKSUM)

    birthdate, date_reason = _resolve_birthdate(
        int(cleaned[0:2]), int(cleaned[2:4]), int(cleaned[4:6]), today
    )
    if birthdate is None:
        return IdAnalysis(cleaned, False, date_reason)

    citizenship_digit = cleaned[10]
    citizenship = {
        "0": Citizenship.SA_CITIZEN,
        "1": Citizenship.PERMANENT_RESIDENT,
    }.get(citizenship_digit)
    if citizenship is None:
        return IdAnalysis(cleaned, False, RejectionReason.CITIZENSHIP, date_of_birth=birthdate)

    gender = Gender.FEMALE if int(cleaned[6:10]) < 5000 else Gender.MALE

    return IdAnalysis(
        cleaned,
        True,
        None,
        date_of_birth=birthdate,
        gender=gender,
        citizenship=citizenship,
    )


def is_valid_sa_id(id_string: str) -> bool:
    """Boolean convenience wrapper kept for the documented public API."""
    return analyse_id_number(id_string).valid
