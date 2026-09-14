/**
 * Read-only diagnostic: reports the granted OAuth scopes on the Google Sheets
 * connection and lists the tabs in the configured spreadsheet.
 * Makes no modifications of any kind.
 */
async function main() {
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

  const item = data.items?.[0];
  if (!item) throw new Error('No google-sheet connection found');

  const s = item.settings || {};
  const scopeStr: string =
    s.scope || s.scopes || s.oauth?.credentials?.scope || s.oauth?.scope || '';
  const scopes = Array.isArray(scopeStr) ? scopeStr : String(scopeStr).split(/[\s,]+/).filter(Boolean);

  console.log('Granted scopes:');
  for (const sc of scopes) console.log('  -', sc);

  const has = (frag: string) => scopes.some((x) => x.includes(frag));
  console.log('\nCapability check:');
  console.log('  sheets read/write :', has('auth/spreadsheets') && !scopes.every(x => x.includes('readonly')));
  console.log('  drive (full)      :', has('auth/drive') && !has('auth/drive.readonly'));
  console.log('  drive.file        :', has('auth/drive.file'));

  const accessToken = s.access_token || s.oauth?.credentials?.access_token;
  const { google } = await import('googleapis');
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

  const id = process.env.GOOGLE_SHEETS_ID!;
  const meta = await sheets.spreadsheets.get({ spreadsheetId: id, includeGridData: false });
  console.log('\nSpreadsheet:', JSON.stringify(meta.data.properties?.title));
  console.log('Tabs:');
  for (const sh of meta.data.sheets || []) {
    const p = sh.properties!;
    console.log(
      `  - ${JSON.stringify(p.title)} (id=${p.sheetId}, rows=${p.gridProperties?.rowCount}, cols=${p.gridProperties?.columnCount})`
    );
  }
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
