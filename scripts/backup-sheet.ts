/**
 * Safety backup + tab identity analysis.
 *
 * READ-ONLY against the live spreadsheet. Writes a local raw-value backup of every
 * candidate DeX tab and reports which tab the database actually corresponds to,
 * so tabs can be pinned by stable numeric sheetId instead of by ambiguous title.
 */
import { google } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';

async function getAccessToken() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
    ? 'depl ' + process.env.WEB_REPL_RENEWAL
    : null;
  if (!hostname || !xReplitToken) throw new Error('Connector env not available');
  const data = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=google-sheet',
    { headers: { Accept: 'application/json', 'X-Replit-Token': xReplitToken } }
  ).then((r) => r.json());
  const s = data.items?.[0]?.settings || {};
  const token = s.access_token || s.oauth?.credentials?.access_token;
  if (!token) throw new Error('No access token');
  return token;
}

async function main() {
  const token = await getAccessToken();
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: token });
  const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;

  const meta = await sheets.spreadsheets.get({ spreadsheetId, includeGridData: false });
  const all = (meta.data.sheets || []).map((s) => s.properties!);

  // Any tab whose title mentions DeX is a catalog candidate.
  const candidates = all.filter((p) => (p.title || '').toLowerCase().includes('dex'));

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = path.join('backups', `sheet-${stamp}`);
  fs.mkdirSync(outDir, { recursive: true });

  const report: any[] = [];

  for (const p of candidates) {
    const title = p.title!;
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${title}'!A1:AZ`,
      valueRenderOption: 'UNFORMATTED_VALUE',
    });
    const values = res.data.values || [];
    // Data rows = non-empty rows below the header row.
    const dataRows = values.slice(1).filter((r) => r && r.some((c) => String(c ?? '').trim() !== ''));

    const safeName = `${p.sheetId}__${title.replace(/[^a-zA-Z0-9]+/g, '_')}`;
    fs.writeFileSync(
      path.join(outDir, `${safeName}.json`),
      JSON.stringify({ sheetId: p.sheetId, title, values }, null, 2)
    );

    const header = (values[0] || []).map((c) => String(c ?? '').trim());
    report.push({
      sheetId: p.sheetId,
      title,
      titleHasTrailingSpace: title !== title.trim(),
      titleHasDoubleSpace: /\s{2,}/.test(title),
      totalRows: values.length,
      dataRows: dataRows.length,
      headerCols: header.length,
      header,
    });
  }

  fs.writeFileSync(path.join(outDir, '_report.json'), JSON.stringify(report, null, 2));

  console.log(`Local backup written to: ${outDir}\n`);
  console.log('Candidate DeX tabs:');
  for (const r of report) {
    const flags = [
      r.titleHasTrailingSpace ? 'TRAILING-SPACE' : '',
      r.titleHasDoubleSpace ? 'DOUBLE-SPACE' : '',
    ]
      .filter(Boolean)
      .join(' ');
    console.log(
      `  sheetId=${String(r.sheetId).padEnd(11)} dataRows=${String(r.dataRows).padEnd(5)} cols=${String(
        r.headerCols
      ).padEnd(3)} ${JSON.stringify(r.title)} ${flags}`
    );
  }

  console.log('\nHeaders per tab:');
  for (const r of report) {
    console.log(`  ${JSON.stringify(r.title)} (id=${r.sheetId}):`);
    console.log(`     ${r.header.map((h: string, i: number) => `${String.fromCharCode(65 + i)}=${h}`).join(' | ')}`);
  }
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
