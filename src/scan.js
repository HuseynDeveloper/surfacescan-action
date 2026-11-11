#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const GRADE_ORDER = ['A+', 'A', 'B+', 'B', 'C', 'D', 'F'];

function normalizeDomainInput(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  s = s.replace(/^https?:\/\//i, '');
  s = s.split(/[/?#]/)[0];
  s = s.replace(/:\d+$/, '');
  return s.toLowerCase();
}

function meetsMinimumGrade(actualGrade, minGrade) {
  const actualIdx = GRADE_ORDER.indexOf(String(actualGrade || '').toUpperCase());
  const minIdx = GRADE_ORDER.indexOf(String(minGrade || '').toUpperCase());
  if (actualIdx === -1 || minIdx === -1) return false;
  return actualIdx <= minIdx;
}

function sanitizeMdCell(text) {
  return String(text || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
}

function statusBadge(status) {
  switch (String(status || '').toLowerCase()) {
    case 'good':
      return 'PASS';
    case 'warn':
      return 'WARN';
    case 'bad':
      return 'FAIL';
    default:
      return 'INFO';
  }
}

function buildSarif(scan, baseUrl) {
  const checks = Array.isArray(scan.checks) ? scan.checks : [];
  const flagged = checks.filter((c) => c.status === 'bad' || c.status === 'warn');

  const rules = checks.map((c) => ({
    id: `surfacescan/${c.id}`,
    name: String(c.title || c.id).replace(/[^a-zA-Z0-9]+/g, '') || String(c.id),
    shortDescription: { text: String(c.title || c.id) },
    fullDescription: { text: String(c.line || c.label || c.title || c.id) },
    defaultConfiguration: {
      level: c.status === 'bad' ? 'error' : (c.status === 'warn' ? 'warning' : 'note')
    }
  }));

  const results = flagged.map((c) => ({
    ruleId: `surfacescan/${c.id}`,
    level: c.status === 'bad' ? 'error' : 'warning',
    message: {
      text: `[${c.label || c.status}] ${c.title}: ${c.line || 'Review configuration.'}`
    },
    locations: [
      {
        physicalLocation: {
          artifactLocation: {
            uri: `https://${scan.domain}/`
          }
        }
      }
    ],
    properties: {
      domain: scan.domain,
      grade: scan.grade,
      score: scan.score,
      checkId: c.id,
      status: c.status
    }
  }));

  return {
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'SurfaceScan',
            version: '1.0.0',
            informationUri: baseUrl,
            rules
          }
        },
        results,
        properties: {
          domain: scan.domain,
          grade: scan.grade,
          score: scan.score,
          scannedAt: scan.scannedAt
        }
      }
    ]
  };
}

function buildMarkdownSummary(scan, baseUrl, failUnder, thresholdPassed) {
  const lines = [];
  const badgeUrl = `${baseUrl}/badge/${encodeURIComponent(scan.domain)}.svg`;

  lines.push(`## SurfaceScan Audit — \`${sanitizeMdCell(scan.domain)}\``);
  lines.push('');
  lines.push(`![SurfaceScan Grade](${badgeUrl})`);
  lines.push('');
  lines.push(
    `**Grade:** \`${sanitizeMdCell(scan.grade)}\` &nbsp;|&nbsp; **Score:** \`${Number(scan.score)}/100\` &nbsp;|&nbsp; **Duration:** \`${sanitizeMdCell(scan.duration || '—')}\``
  );

  if (failUnder && thresholdPassed !== null) {
    lines.push(
      thresholdPassed
        ? `**Policy Gate (\`>= ${failUnder}\`):** Passed`
        : `**Policy Gate (\`>= ${failUnder}\`):** Failed`
    );
  }

  if (scan.summary) {
    lines.push('');
    lines.push(`> ${sanitizeMdCell(scan.summary)}`);
  }

  lines.push('');
  lines.push('| Status | Check | Result | Findings |');
  lines.push('|---|---|---|---|');

  for (const chk of scan.checks || []) {
    lines.push(
      `| ${statusBadge(chk.status)} | ${sanitizeMdCell(chk.title || chk.id)} | ${sanitizeMdCell(chk.label || chk.status)} | ${sanitizeMdCell(chk.line || '—')} |`
    );
  }

  lines.push('');
  lines.push(
    `Scanned via [SurfaceScan](${baseUrl}) · [API & Builders](${baseUrl}/tools#api) · [Fix Snippets](${baseUrl}/resources)`
  );
  return `${lines.join('\n')}\n`;
}

function appendFileSafe(filePath, content) {
  if (!filePath) return;
  fs.appendFileSync(filePath, content, 'utf8');
}

async function main() {
  const rawDomain = process.env.INPUT_DOMAIN;
  const domain = normalizeDomainInput(rawDomain);
  if (!domain) {
    console.error('Error: "domain" input is required.');
    process.exit(2);
  }

  const apiUrl = String(process.env.INPUT_API_URL || 'https://surfacescan.uk')
    .trim()
    .replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(apiUrl)) {
    console.error('Error: "api-url" must start with http:// or https://');
    process.exit(2);
  }

  const rawFailUnder = String(process.env.INPUT_FAIL_UNDER ?? 'B').trim();
  const skipFailGate = !rawFailUnder || ['none', 'off', 'false'].includes(rawFailUnder.toLowerCase());
  const failUnder = skipFailGate ? '' : rawFailUnder.toUpperCase();
  if (failUnder && !GRADE_ORDER.includes(failUnder)) {
    console.error(`Error: invalid fail-under grade "${rawFailUnder}". Expected one of: ${GRADE_ORDER.join(', ')}, or "none".`);
    process.exit(2);
  }

  const lang = String(process.env.INPUT_LANG || 'en').trim().toLowerCase() === 'az' ? 'az' : 'en';
  const apiKey = String(process.env.INPUT_API_KEY || '').trim();
  const sarifPath = String(process.env.INPUT_SARIF_FILE || '').trim();
  const writeSummary = String(process.env.INPUT_WRITE_SUMMARY || 'true').trim().toLowerCase() !== 'false';

  const endpoint = `${apiUrl}/api/scan?domain=${encodeURIComponent(domain)}&lang=${lang}`;
  const headers = {
    Accept: 'application/json',
    'User-Agent': 'surfacescan-github-action/1.0'
  };
  if (apiKey) {
    headers['X-API-Key'] = apiKey;
  }

  let res;
  let bodyText;
  try {
    res = await fetch(endpoint, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(30000)
    });
    bodyText = await res.text();
  } catch (err) {
    console.error(`Failed to reach SurfaceScan API (${apiUrl}): ${err.message}`);
    process.exit(2);
  }

  let data;
  try {
    data = JSON.parse(bodyText);
  } catch {
    console.error(`Unexpected non-JSON response from ${apiUrl} (HTTP ${res.status}).`);
    process.exit(2);
  }

  if (!res.ok) {
    const errMsg = data && data.error ? data.error : `HTTP ${res.status}`;
    console.error(`SurfaceScan API error (${res.status}): ${errMsg}`);
    if (res.status === 429 && !apiKey) {
      console.error(`Tip: Generate a free Personal API Key at ${apiUrl}/profile (30 req/min Free, 120 req/min Pro) and pass it via the "api-key" input.`);
    }
    process.exit(2);
  }

  const grade = String(data.grade || '').toUpperCase();
  const score = Number(data.score ?? 0);
  const thresholdPassed = failUnder ? meetsMinimumGrade(grade, failUnder) : null;

  console.log(`SurfaceScan Audit: ${data.domain}`);
  console.log(`Grade: ${grade} (${score}/100) | Duration: ${data.duration || '—'}`);
  if (data.summary) console.log(`Summary: ${data.summary}`);
  console.log('---');
  for (const chk of data.checks || []) {
    console.log(`[${statusBadge(chk.status)}] ${chk.title || chk.id}: ${chk.label || chk.status}`);
    if (chk.line) console.log(`       ${chk.line}`);
  }
  if (failUnder) {
    console.log('---');
    console.log(`Policy Gate (>= ${failUnder}): ${thresholdPassed ? 'PASSED' : 'FAILED'}`);
  }

  let writtenSarif = '';
  if (sarifPath) {
    const resolvedSarif = path.resolve(process.cwd(), sarifPath);
    fs.mkdirSync(path.dirname(resolvedSarif), { recursive: true });
    fs.writeFileSync(resolvedSarif, `${JSON.stringify(buildSarif(data, apiUrl), null, 2)}\n`, 'utf8');
    writtenSarif = sarifPath;
    console.log(`SARIF report written to ${sarifPath}`);
  }

  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    appendFileSafe(githubOutput, `grade=${grade}\nscore=${score}\nsarif-file=${writtenSarif}\n`);
  }

  const githubSummary = process.env.GITHUB_STEP_SUMMARY;
  if (writeSummary && githubSummary) {
    appendFileSafe(githubSummary, buildMarkdownSummary(data, apiUrl, failUnder, thresholdPassed));
  }

  if (failUnder && !thresholdPassed) {
    console.error(`Audit failed: domain grade ${grade} is below required minimum ${failUnder}.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err && err.message ? err.message : err);
  process.exit(2);
});
