# SA ID Validator

Validate South African 13-digit identity numbers properly: Luhn checksum, real date parsing, gender
and citizenship decoding — in the browser, or as a small Python module.

**Live validator:** https://sklevel8-sa-id-validator.netlify.app
**Stack:** vanilla JavaScript (web) · Python 3.11 (reference implementation)

---

## Why this exists

South African ID numbers are collected constantly and validated badly. The common implementation is
a regex check on length, which accepts `0000000000000` and every impossible date that happens to
have thirteen digits. The checksum is the part that actually distinguishes a real number from a
typo, and it is usually skipped.

There is a second, less obvious problem: an ID number encodes date of birth, gender and citizenship.
That makes it personal data under POPIA, and yet validators are typically shipped as a form POST to
a server — sending identity numbers over the wire and into logs purely to run arithmetic that a
phone can do instantly.

So this project has two goals that reinforce each other:

- **Do the checks in the right order and get the edge cases right** — checksum first, then a date
  that actually exists, then plausibility, then the demographic digits.
- **Keep the number on the user's device.** The deployed validator is a static page. Nothing is sent
  anywhere, and there is no analytics call that could leak it.

## How it works

A 13-digit ID is structured as:

```
YYMMDD SSSS C A Z
│      │    │ │ └── Z : Luhn (mod 10) check digit
│      │    │ └──── A : legacy digit, 8 or 9 (no longer meaningful)
│      │    └────── C : 0 = SA citizen, 1 = permanent resident
│      └─────────── SSSS : 0000–4999 female, 5000–9999 male
└────────────────── YYMMDD : date of birth, century omitted
```

Validation runs in this order, and each failure returns a specific, machine-readable reason rather
than a generic "invalid":

1. **Shape** — exactly 13 characters, all digits (`ID_LENGTH_INVALID`, `ID_NON_NUMERIC`).
2. **Checksum** — the standard Luhn algorithm over the first twelve digits must produce the
   thirteenth (`LUHN_FAILED`). This is what catches transposed digits.
3. **Date** — the first six digits must form a real calendar date. The century is omitted, so both
   `19YY` and `20YY` are considered; candidates that are in the future or imply an age over 120 are
   discarded, and when both remain plausible **the younger one wins**, which is the convention every
   other SA validator follows (`ID_DATE_INVALID`, `ID_DATE_IN_FUTURE`, `ID_DATE_IMPLAUSIBLE`).
4. **Citizenship** — digit 11 must be `0` or `1` (`ID_CITIZENSHIP_INVALID`).
5. **Gender** — digits 7–10 below 5000 are recorded as female, otherwise male.

The Python module keeps this as pure functions returning a frozen dataclass, so it can be unit
tested without a PDF, a form or a network:

```python
from src.utils.validator import analyse_id_number

result = analyse_id_number("8001015009087")
# IdAnalysis(value=..., valid=True, date_of_birth=date(1980, 1, 1),
#            gender=Gender.MALE, citizenship=Citizenship.SA_CITIZEN)
```

`luhn_check_digit()` is exposed separately, which is what makes the walkthrough in the UI possible:
it shows each digit's transformation instead of just a verdict.

### The web validator

The deployed page is one self-contained front end with four parts:

- **Single check** — live validation as you type, decoded attributes, and a digit-by-digit Luhn
  walkthrough with the raw numbers exposed.
- **Batch** — paste a list (one per line or comma separated), get a summary and a per-row table,
  then export the results as CSV. Useful for cleaning a spreadsheet before an import.
- **Generator** — produce structurally valid numbers for test fixtures, including a chosen date and
  gender.
- **Anatomy** — a reference panel explaining what each digit group means.

## Features

- Luhn checksum validation, not just a length check
- Real calendar validation with the century pivot handled
- Specific rejection reasons suitable for display or logging
- Gender and citizenship decoding
- Batch validation with CSV export
- Valid-number generator for test data
- Digit-by-digit checksum walkthrough
- Fully client-side; no network calls, no storage, no analytics

## Run it locally

No build step.

```bash
# web
cd web && python -m http.server 8080      # http://localhost:8080

# python module
python -c "from src.utils.validator import analyse_id_number as a; print(a('8001015009087'))"
```

The Python module has no third-party dependencies.

## Project layout

```
src/utils/validator.py   pure validation: Luhn, date resolution, gender, citizenship
web/index.html           validator UI
web/app.js               client-side validation, batch, CSV, generator
web/app.css, theme.css   shared design system plus project theme
web/favicon.svg
```

## Deployment

`netlify.toml` publishes `web/` with security headers and short-lived asset caching. The Python
module is a library, not a service — it is included so the rules can be reused server-side without
reimplementing them.

## Licence

MIT
