/* SA ID validator — same rules as src/utils/validator.py, implemented client-side. */
(() => {
  'use strict';

  const MAX_AGE_YEARS = 120;
  const LENGTH = 13;

  const $ = (s) => document.querySelector(s);
  const el = {
    input: $('#idInput'),
    segments: $('#segments'),
    verdict: $('#verdict'),
    verdictBadge: $('#verdictBadge'),
    verdictCode: $('#verdictCode'),
    verdictText: $('#verdictText'),
    reason: $('#reasonBox'),
    dob: $('#factDob'),
    age: $('#factAge'),
    gender: $('#factGender'),
    citizen: $('#factCitizen'),
    checksum: $('#factChecksum'),
    sequence: $('#factSequence'),
    csDigits: $('#checksumDigits'),
    csSum: $('#checksumSum'),
    csExpected: $('#checksumExpected'),
    batchInput: $('#batchInput'),
    batchRows: $('#batchRows'),
    batchEmpty: $('#batchEmpty'),
    batchCount: $('#batchCount'),
    bTotal: $('#bTotal'),
    bValid: $('#bValid'),
    bInvalid: $('#bInvalid'),
    toast: $('#toast'),
  };

  const REASONS = {
    ID_LENGTH_INVALID: 'The number must be exactly 13 digits.',
    ID_NON_NUMERIC: 'Only digits are allowed.',
    LUHN_FAILED: 'The Luhn check digit does not match the first twelve digits.',
    ID_DATE_INVALID: 'The first six digits do not form a real calendar date.',
    ID_DATE_IN_FUTURE: 'The date of birth is in the future.',
    ID_DATE_IMPLAUSIBLE: 'The date of birth implies an age above 120 years.',
    ID_CITIZENSHIP_INVALID: 'The citizenship digit must be 0 (citizen) or 1 (permanent resident).',
  };

  let lastResults = [];

  /* -------------------------------------------------------------- helpers */
  function digitsOnly(value) { return String(value || '').replace(/\D/g, ''); }

  function luhnCheckDigit(payload) {
    let total = 0;
    for (let i = 0; i < payload.length; i += 1) {
      const index = payload.length - 1 - i;
      let digit = Number(payload[index]);
      if (i % 2 === 0) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      total += digit;
    }
    return (10 - (total % 10)) % 10;
  }

  function transformedDigits(payload) {
    return payload.split('').map((char, i) => {
      const fromRight = payload.length - 1 - i;
      let value = Number(char);
      const doubled = fromRight % 2 === 0;
      if (doubled) {
        value *= 2;
        if (value > 9) value -= 9;
      }
      return { original: Number(char), value, doubled, reduced: doubled && Number(char) * 2 > 9 };
    });
  }

  function resolveDate(yy, mm, dd, today) {
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return { error: 'ID_DATE_INVALID' };
    const candidates = [];
    for (const year of [1900 + yy, 2000 + yy]) {
      const candidate = new Date(Date.UTC(year, mm - 1, dd));
      if (candidate.getUTCFullYear() === year && candidate.getUTCMonth() === mm - 1 && candidate.getUTCDate() === dd) {
        candidates.push(candidate);
      }
    }
    if (!candidates.length) return { error: 'ID_DATE_INVALID' };

    const plausible = candidates.filter((candidate) => {
      const ageDays = (today - candidate) / 864e5;
      return ageDays >= 0 && ageDays <= MAX_AGE_YEARS * 365.25;
    });
    if (!plausible.length) {
      const allFuture = candidates.every((candidate) => candidate > today);
      return { error: allFuture ? 'ID_DATE_IN_FUTURE' : 'ID_DATE_IMPLAUSIBLE' };
    }
    return { date: new Date(Math.max(...plausible.map((d) => d.getTime()))) };
  }

  function analyse(raw, today = new Date()) {
    const cleaned = String(raw || '').trim();
    if (cleaned.length !== LENGTH) return { valid: false, reason: 'ID_LENGTH_INVALID', value: cleaned };
    if (!/^\d{13}$/.test(cleaned)) return { valid: false, reason: 'ID_NON_NUMERIC', value: cleaned };

    if (luhnCheckDigit(cleaned.slice(0, 12)) !== Number(cleaned[12])) {
      return { valid: false, reason: 'LUHN_FAILED', value: cleaned };
    }

    const { date, error } = resolveDate(Number(cleaned.slice(0, 2)), Number(cleaned.slice(2, 4)), Number(cleaned.slice(4, 6)), today);
    if (error) return { valid: false, reason: error, value: cleaned };

    const citizenshipDigit = cleaned[10];
    const citizenship = citizenshipDigit === '0' ? 'SA citizen' : citizenshipDigit === '1' ? 'Permanent resident' : null;
    if (!citizenship) return { valid: false, reason: 'ID_CITIZENSHIP_INVALID', date, value: cleaned };

    const sequence = Number(cleaned.slice(6, 10));
    return {
      valid: true,
      reason: null,
      value: cleaned,
      date,
      gender: sequence < 5000 ? 'Female' : 'Male',
      citizenship,
      sequence: cleaned.slice(6, 10),
      legacy: cleaned[11],
      checkDigit: Number(cleaned[12]),
    };
  }

  function fmtDate(date) {
    if (!date) return '—';
    return date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  }
  function ageOf(date, now = new Date()) {
    if (!date) return '—';
    let age = now.getUTCFullYear() - date.getUTCFullYear();
    const beforeBirthday = now.getUTCMonth() < date.getUTCMonth()
      || (now.getUTCMonth() === date.getUTCMonth() && now.getUTCDate() < date.getUTCDate());
    if (beforeBirthday) age -= 1;
    return `${age} years`;
  }
  function toast(message) {
    el.toast.textContent = message;
    el.toast.classList.add('is-visible');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.toast.classList.remove('is-visible'), 2000);
  }

  /* --------------------------------------------------------------- render */
  function renderSegments(digits) {
    const groups = [
      { cls: 'dob', from: 0, to: 6, label: 'date of birth' },
      { cls: 'seq', from: 6, to: 10, label: 'sequence' },
      { cls: 'cit', from: 10, to: 11, label: 'citizenship' },
      { cls: 'legacy', from: 11, to: 12, label: 'legacy' },
      { cls: 'check', from: 12, to: 13, label: 'check' },
    ];
    el.segments.innerHTML = groups.map((group) => {
      let html = `<div class="seg-group" aria-label="${group.label}">`;
      for (let i = group.from; i < group.to; i += 1) {
        const char = digits[i] || '';
        html += `<span class="seg seg--${group.cls}" data-filled="${Boolean(char)}">${char || '·'}</span>`;
      }
      return `${html}</div>`;
    }).join('');
  }

  function renderFacts(result) {
    el.dob.textContent = fmtDate(result.date);
    el.age.textContent = ageOf(result.date);
    el.gender.textContent = result.gender || '—';
    el.citizen.textContent = result.citizenship || '—';
    el.checksum.textContent = result.valid ? 'Valid (Luhn)' : 'Failed';
    el.sequence.textContent = result.sequence || '—';
  }

  function renderChecksum(value) {
    if (value.length < 12) {
      el.csDigits.innerHTML = '';
      el.csSum.textContent = '—';
      el.csExpected.textContent = '—';
      return;
    }
    const payload = value.slice(0, 12);
    const parts = transformedDigits(payload);
    el.csDigits.innerHTML = parts.map((part) =>
      `<span class="cd ${part.doubled ? 'cd--double' : ''} ${part.reduced ? 'cd--reduced' : ''}" title="digit ${part.original}">${part.value}<small>${part.original}</small></span>`
    ).join('');
    const total = parts.reduce((sum, part) => sum + part.value, 0);
    el.csSum.textContent = String(total);
    el.csExpected.textContent = String(luhnCheckDigit(payload));
  }

  function render() {
    const digits = digitsOnly(el.input.value).slice(0, LENGTH);
    renderSegments(digits);

    if (!digits) {
      el.verdict.hidden = true;
      el.reason.hidden = true;
      renderFacts({});
      renderChecksum('');
      return;
    }

    const result = analyse(digits);
    renderFacts(result);
    renderChecksum(digits);

    el.verdict.hidden = false;
    el.verdict.className = `verdict ${result.valid ? 'verdict--ok' : 'verdict--bad'}`;
    el.verdictBadge.className = `badge ${result.valid ? 'badge--ok' : 'badge--bad'}`;
    el.verdictBadge.innerHTML = `<span class="dot"></span> ${result.valid ? 'Valid ID number' : 'Rejected'}`;
    el.verdictCode.textContent = result.valid ? 'checksum · date · citizenship ok' : result.reason;

    if (result.valid) {
      el.verdictText.textContent = `Born ${fmtDate(result.date)} · ${result.gender} · ${result.citizenship}. All structural checks passed.`;
      el.reason.hidden = true;
    } else {
      el.verdictText.textContent = REASONS[result.reason] || 'The number failed structural validation.';
      el.reason.hidden = digits.length < 13;
      el.reason.textContent = digits.length < 13 ? `${13 - digits.length} more digit${13 - digits.length === 1 ? '' : 's'} needed.` : '';
    }
  }

  /* ---------------------------------------------------------------- batch */
  function parseBatch(text) {
    return text.split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const runs = line.match(/\d{13}/g);
        return runs ? runs[0] : digitsOnly(line);
      });
  }

  function runBatch() {
    const numbers = parseBatch(el.batchInput.value).slice(0, 500);
    lastResults = numbers.map((number) => analyse(number));
    renderBatch();
  }

  function renderBatch() {
    const valid = lastResults.filter((r) => r.valid).length;
    el.bTotal.textContent = String(lastResults.length);
    el.bValid.textContent = String(valid);
    el.bInvalid.textContent = String(lastResults.length - valid);

    el.batchRows.innerHTML = lastResults.map((result) => `<tr>
      <td class="mono">${escapeHtml(result.value || '—')}</td>
      <td><span class="badge ${result.valid ? 'badge--ok' : 'badge--bad'}"><span class="dot"></span>${result.valid ? 'valid' : 'rejected'}</span></td>
      <td>${result.valid ? fmtDate(result.date) : '—'}</td>
      <td>${result.gender || '—'}</td>
      <td>${result.citizenship || '—'}</td>
      <td class="dim small">${result.valid ? 'ok' : (REASONS[result.reason] || result.reason)}</td>
    </tr>`).join('');

    el.batchEmpty.classList.toggle('hidden', lastResults.length > 0);
    el.batchCount.textContent = `${numbersLabel(lastResults.length)}`;
  }

  function numbersLabel(count) { return `${count} line${count === 1 ? '' : 's'}`; }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function exportCsv() {
    if (!lastResults.length) { toast('Run a batch first'); return; }
    const rows = [['number', 'valid', 'reason', 'date_of_birth', 'gender', 'citizenship']];
    lastResults.forEach((r) => rows.push([
      r.value,
      r.valid ? 'true' : 'false',
      r.reason || '',
      r.date ? r.date.toISOString().slice(0, 10) : '',
      r.gender || '',
      r.citizenship || '',
    ]));
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'sa-id-validation.csv';
    anchor.click();
    URL.revokeObjectURL(url);
    toast('CSV exported');
  }

  /* ------------------------------------------------------------ generator */
  function generateValidId() {
    const start = new Date(Date.UTC(1955, 0, 1));
    const end = new Date(Date.UTC(2006, 11, 31));
    const dob = new Date(start.getTime() + Math.random() * (end - start));
    const yy = String(dob.getUTCFullYear() % 100).padStart(2, '0');
    const mm = String(dob.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(dob.getUTCDate()).padStart(2, '0');
    const male = Math.random() > 0.5;
    const sequence = String(Math.floor(Math.random() * 5000) + (male ? 5000 : 0)).padStart(4, '0');
    const citizenship = Math.random() > 0.15 ? '0' : '1';
    const legacy = '8';
    const payload = `${yy}${mm}${dd}${sequence}${citizenship}${legacy}`;
    return `${payload}${luhnCheckDigit(payload)}`;
  }

  /* ---------------------------------------------------------------- events */
  el.input.addEventListener('input', () => {
    const caret = el.input.selectionStart;
    const clean = digitsOnly(el.input.value).slice(0, LENGTH);
    if (clean !== el.input.value) {
      el.input.value = clean;
      try { el.input.setSelectionRange(Math.min(caret, clean.length), Math.min(caret, clean.length)); } catch { /* noop */ }
    }
    render();
  });
  el.input.addEventListener('paste', () => setTimeout(render, 0));

  document.querySelector('#sampleBtn').addEventListener('click', () => {
    el.input.value = '8001015009087';
    render();
    el.input.focus();
  });
  document.querySelector('#clearBtn').addEventListener('click', () => {
    el.input.value = '';
    render();
    el.input.focus();
  });
  document.querySelector('#batchBtn').addEventListener('click', runBatch);
  document.querySelector('#exportBtn').addEventListener('click', exportCsv);
  document.querySelector('#generateBtn').addEventListener('click', () => {
    const generated = generateValidId();
    el.batchInput.value = [el.batchInput.value.trim(), generated].filter(Boolean).join('\n');
    runBatch();
    toast('Generated a valid test ID');
  });
  el.batchInput.addEventListener('input', () => {
    el.batchCount.textContent = numbersLabel(parseBatch(el.batchInput.value).length);
  });

  render();
  el.batchCount.textContent = '0 lines';
})();
