/**
 * Creates a dated backup copy of the live catalog spreadsheet.
 *
 * Never modifies the original. Tries a whole-file Drive copy first (best fidelity);
 * if the granted scope does not permit copying a file the app did not create, falls
 * back to creating a new spreadsheet and copying each catalog tab into it.
 */
import { google } from 'googleapis';

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
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: token });
  const sheets = google.sheets({ version: 'v4', auth });
  const drive = google.drive({ version: 'v3', auth });
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;

  const meta = await sheets.spreadsheets.get({ spreadsheetId, includeGridData: false });
  const sourceTitle = meta.data.properties?.title || 'Spreadsheet';
  const allTabs = (meta.data.sheets || []).map((s) => s.properties!);
  const stamp = new Date().toISOString().slice(0, 10);
  const backupName = `${sourceTitle} — BACKUP before Pricing Versions ${stamp}`;

  // Attempt 1: full-file Drive copy.
  try {
    const copy = await drive.files.copy({
      fileId: spreadsheetId,
      requestBody: { name: backupName },
      fields: 'id,name,webViewLink',
    });
    console.log('METHOD: full Drive file copy');
    console.log('BACKUP_NAME:', copy.data.name);
    console.log('BACKUP_ID:', copy.data.id);
    console.log('BACKUP_URL:', copy.data.webViewLink || `https://docs.google.com/spreadsheets/d/${copy.data.id}`);

    const vmeta = await sheets.spreadsheets.get({
      spreadsheetId: copy.data.id!,
      includeGridData: false,
    });
    const copiedTabs = (vmeta.data.sheets || []).map((s) => s.properties!.title);
    console.log(`VERIFY: ${copiedTabs.length} tabs in backup vs ${allTabs.length} in source`);
    const missing = allTabs.map((t) => t.title).filter((t) => !copiedTabs.includes(t!));
    console.log('VERIFY_MISSING_TABS:', missing.length === 0 ? 'none' : missing.join(', '));
    return;
  } catch (e: any) {
    console.log('Full Drive copy unavailable, falling back to per-tab copy. Reason:', e.message);
  }

  // Attempt 2: new spreadsheet + copy each catalog tab into it.
  const created = await sheets.spreadsheets.create({
    requestBody: { properties: { title: backupName } },
    fields: 'spreadsheetId,spreadsheetUrl',
  });
  const destId = created.data.spreadsheetId!;
  const catalogTabs = allTabs.filter((p) => (p.title || '').toLowerCase().includes('dex'));

  for (const p of catalogTabs) {
    await sheets.spreadsheets.sheets.copyTo({
      spreadsheetId,
      sheetId: p.sheetId!,
      requestBody: { destinationSpreadsheetId: destId },
    });
    console.log(`  copied ${JSON.stringify(p.title)} (id=${p.sheetId})`);
  }

  console.log('METHOD: per-tab copy into new spreadsheet');
  console.log('BACKUP_NAME:', backupName);
  console.log('BACKUP_ID:', destId);
  console.log('BACKUP_URL:', created.data.spreadsheetUrl);
  console.log(`VERIFY: copied ${catalogTabs.length} catalog tabs`);
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
