import { CustomField, VaultEntry } from '../types/vault';
import { formatTotpStorage } from './totp';

export function createId(): string {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function parseCsvRows(raw: string): string[][] {
  const text = raw.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field);
        field = '';
      } else if (ch === '\r' && next === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
        i++;
      } else if (ch === '\n' || ch === '\r') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += ch;
      }
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

function normalizeTotpImport(raw?: string): string {
  if (!raw || !raw.trim()) return '';
  if (raw.trim().toLowerCase().startsWith('otpauth://')) {
    return formatTotpStorage(raw);
  }
  return raw.trim();
}

export function importBitwardenData(rawText: string): VaultEntry[] {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new Error('The Bitwarden export is empty.');
  }
  const now = Date.now();
  const results: VaultEntry[] = [];

  if (trimmed.startsWith('{')) {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      throw new Error('Invalid JSON syntax in Bitwarden export. Check that the full file was pasted.');
    }
    if (data.encrypted === true) {
      throw new Error(
        'Encrypted Bitwarden JSON exports cannot be read directly. Export an unencrypted JSON or CSV file instead.'
      );
    }
    const folderMap = new Map<string, string>();
    if (Array.isArray(data.folders)) {
      for (const f of data.folders as Array<{ id?: string; name?: string }>) {
        if (f?.id && f?.name) folderMap.set(f.id, f.name);
      }
    }

    const items = Array.isArray(data.items) ? data.items : [];
    for (const item of items) {
      const folderTag = item.folderId ? folderMap.get(item.folderId) : undefined;
      const tags = folderTag ? [folderTag] : [];
      const customFields: CustomField[] = Array.isArray(item.fields)
        ? item.fields.map((f: { name?: string; value?: string; type?: number }) => ({
            id: createId(),
            label: f.name || 'Field',
            value: f.value || '',
            hidden: f.type === 1,
          }))
        : [];

      if (item.type === 2) {
        results.push({
          id: createId(),
          category: 'note',
          title: item.name || 'Imported Note',
          favorite: Boolean(item.favorite),
          tags,
          notes: item.notes || '',
          customFields,
          createdAt: now,
          updatedAt: now,
        });
      } else if (item.type === 3 && item.card) {
        results.push({
          id: createId(),
          category: 'card',
          title: item.name || 'Imported Card',
          favorite: Boolean(item.favorite),
          tags,
          notes: item.notes || '',
          customFields,
          cardholderName: item.card.cardholderName || '',
          cardNumber: item.card.number || '',
          cardExpiry:
            item.card.expMonth && item.card.expYear
              ? `${String(item.card.expMonth).padStart(2, '0')}/${String(item.card.expYear).slice(-2)}`
              : '',
          cardCvv: item.card.code || '',
          createdAt: now,
          updatedAt: now,
        });
      } else if (item.type === 4 && item.identity) {
        const id = item.identity;
        results.push({
          id: createId(),
          category: 'identity',
          title: item.name || 'Imported Identity',
          favorite: Boolean(item.favorite),
          tags,
          notes: item.notes || '',
          customFields,
          fullName: [id.firstName, id.lastName].filter(Boolean).join(' '),
          email: id.email || '',
          phone: id.phone || '',
          address: [id.address1, id.city, id.state, id.postalCode].filter(Boolean).join(', '),
          idNumber: id.passportNumber || id.ssn || '',
          createdAt: now,
          updatedAt: now,
        });
      } else {
        const uris = item.login?.uris;
        const firstUri = Array.isArray(uris) && uris[0] ? uris[0].uri || '' : '';
        const history = Array.isArray(item.passwordHistory)
          ? (item.passwordHistory as Array<{ password?: string; lastUsedDate?: string }>)
              .filter((h) => Boolean(h?.password))
              .map((h) => ({
                password: String(h.password),
                changedAt: h.lastUsedDate ? Date.parse(h.lastUsedDate) || now : now,
              }))
              .slice(0, 15)
          : [];
        results.push({
          id: createId(),
          category: 'login',
          title: item.name || 'Imported Login',
          favorite: Boolean(item.favorite),
          tags,
          notes: item.notes || '',
          customFields,
          username: item.login?.username || '',
          password: item.login?.password || '',
          passwordUpdatedAt: now,
          passwordHistory: history,
          url: firstUri,
          totpSecret: normalizeTotpImport(item.login?.totp),
          createdAt: now,
          updatedAt: now,
        });
      }
    }
    return results;
  }

  const rows = parseCsvRows(trimmed);
  if (rows.length < 2) throw new Error('Unrecognized Bitwarden export format.');
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (name: string) => headers.indexOf(name);
  if (idx('name') === -1 && idx('login_username') === -1 && idx('login_password') === -1) {
    throw new Error('CSV headers do not match a Bitwarden export.');
  }

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const type = (r[idx('type')] || 'login').toLowerCase();
    const name = r[idx('name')] || 'Imported Item';
    const notes = r[idx('notes')] || '';
    const folder = (r[idx('folder')] || '').trim();
    const tags = folder ? [folder] : [];
    const fav = r[idx('favorite')] === '1' || r[idx('favorite')]?.toLowerCase() === 'true';
    const fieldsRaw = r[idx('fields')] || '';
    const customFields: CustomField[] = fieldsRaw
      ? fieldsRaw
          .split('\n')
          .map((line) => {
            const sep = line.indexOf(':');
            if (sep === -1) return null;
            return {
              id: createId(),
              label: line.slice(0, sep).trim() || 'Field',
              value: line.slice(sep + 1).trim(),
              hidden: false,
            };
          })
          .filter((f): f is CustomField => Boolean(f))
      : [];

    if (type === 'note') {
      results.push({
        id: createId(),
        category: 'note',
        title: name,
        favorite: fav,
        tags,
        notes,
        customFields,
        createdAt: now,
        updatedAt: now,
      });
    } else if (type === 'card') {
      results.push({
        id: createId(),
        category: 'card',
        title: name,
        favorite: fav,
        tags,
        notes,
        customFields,
        createdAt: now,
        updatedAt: now,
      });
    } else if (type === 'identity') {
      results.push({
        id: createId(),
        category: 'identity',
        title: name,
        favorite: fav,
        tags,
        notes,
        customFields,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      results.push({
        id: createId(),
        category: 'login',
        title: name,
        favorite: fav,
        tags,
        notes,
        customFields,
        url: r[idx('login_uri')] || '',
        username: r[idx('login_username')] || '',
        password: r[idx('login_password')] || '',
        totpSecret: normalizeTotpImport(r[idx('login_totp')]),
        passwordUpdatedAt: now,
        passwordHistory: [],
        createdAt: now,
        updatedAt: now,
      });
    }
  }
  return results;
}

export function import1PasswordData(rawText: string): VaultEntry[] {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new Error('The 1Password export is empty.');
  }
  if (trimmed.startsWith('PK\u0003\u0004')) {
    throw new Error(
      'This .1pux archive is compressed. Extract export.data from the .1pux archive or export as CSV/JSON from 1Password.'
    );
  }
  const now = Date.now();
  const results: VaultEntry[] = [];

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let data: Record<string, unknown> | Record<string, unknown>[];
    try {
      data = JSON.parse(trimmed) as Record<string, unknown> | Record<string, unknown>[];
    } catch {
      throw new Error('Invalid JSON syntax in 1Password export. Check that the full file was pasted.');
    }
    const rawItems: Record<string, unknown>[] = [];
    if (Array.isArray(data)) {
      rawItems.push(...data);
    } else if (Array.isArray(data.accounts)) {
      for (const acc of data.accounts as Array<{ vaults?: Array<{ items?: Record<string, unknown>[] }> }>) {
        for (const v of acc.vaults || []) {
          for (const item of v.items || []) rawItems.push(item);
        }
      }
    } else if (Array.isArray(data.items)) {
      rawItems.push(...(data.items as Record<string, unknown>[]));
    }

    for (const item of rawItems) {
      const overview = (item.overview as Record<string, unknown>) || {};
      const details = (item.details as Record<string, unknown>) || {};
      const title = String(overview.title || item.title || 'Imported Item');
      const url = String(overview.url || item.url || '');
      const tags = Array.isArray(overview.tags) ? overview.tags.map(String) : [];
      const catHint = String(item.categoryUuid || item.templateUuid || item.category || '').toUpperCase();

      let username = '';
      let password = '';
      let totpSecret = '';
      const loginFields = (details.loginFields as Array<{ designation?: string; value?: string }>) || [];
      for (const f of loginFields) {
        if (f.designation === 'username') username = f.value || '';
        if (f.designation === 'password') password = f.value || '';
      }

      const sections =
        (details.sections as Array<{
          fields?: Array<{ id?: string; title?: string; value?: { totp?: string; string?: string; concealed?: string } }>;
        }>) || [];
      let cardNumber = '';
      let cardholderName = '';
      let cardExpiry = '';
      let cardCvv = '';

      for (const s of sections) {
        for (const f of s.fields || []) {
          if (f.value?.totp) totpSecret = normalizeTotpImport(f.value.totp);
          const fieldTitle = (f.title || f.id || '').toLowerCase();
          const val = f.value?.string || f.value?.concealed || '';
          if (fieldTitle.includes('card number') || f.id === 'ccnum') cardNumber = val;
          else if (fieldTitle.includes('cardholder') || f.id === 'cardholder') cardholderName = val;
          else if (fieldTitle.includes('expiry') || f.id === 'expiry') cardExpiry = val;
          else if (fieldTitle.includes('verification') || fieldTitle.includes('cvv') || f.id === 'cvv') cardCvv = val;
        }
      }

      const isFav = Boolean(overview.favorite) || item.favIndex === 1;

      if (catHint === '003' || catHint.includes('NOTE')) {
        results.push({
          id: createId(),
          category: 'note',
          title,
          favorite: isFav,
          tags,
          notes: String(details.notesPlain || ''),
          customFields: [],
          createdAt: now,
          updatedAt: now,
        });
      } else if (catHint === '002' || catHint.includes('CREDIT_CARD') || cardNumber) {
        results.push({
          id: createId(),
          category: 'card',
          title,
          favorite: isFav,
          tags,
          notes: String(details.notesPlain || ''),
          customFields: [],
          cardholderName,
          cardNumber,
          cardExpiry,
          cardCvv,
          createdAt: now,
          updatedAt: now,
        });
      } else {
        results.push({
          id: createId(),
          category: 'login',
          title,
          favorite: isFav,
          tags,
          notes: String(details.notesPlain || ''),
          customFields: [],
          username,
          password,
          url,
          totpSecret,
          passwordUpdatedAt: now,
          passwordHistory: [],
          createdAt: now,
          updatedAt: now,
        });
      }
    }
    return results;
  }

  const rows = parseCsvRows(trimmed);
  if (rows.length < 2) throw new Error('Unrecognized 1Password export format.');
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (name: string) => headers.indexOf(name);
  if (idx('title') === -1 && idx('username') === -1 && idx('password') === -1) {
    throw new Error('CSV headers do not match a 1Password export.');
  }

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const title = r[idx('title')] || 'Imported Login';
    const url = r[idx('url')] || r[idx('website')] || '';
    const username = r[idx('username')] || '';
    const password = r[idx('password')] || '';
    const otpRaw = r[idx('otpauth')] || r[idx('one-time password')] || '';
    const totpSecret = normalizeTotpImport(otpRaw);
    const tagsRaw = r[idx('tags')] || '';
    const tags = tagsRaw ? tagsRaw.split(/[;,]/).map((t) => t.trim()).filter(Boolean) : [];
    const notes = r[idx('notes')] || '';
    const typeCol = (r[idx('type')] || '').toLowerCase();

    if (typeCol.includes('note') && !username && !password) {
      results.push({
        id: createId(),
        category: 'note',
        title,
        favorite: (r[idx('favorite')] || '').toLowerCase() === 'true',
        tags,
        notes,
        customFields: [],
        createdAt: now,
        updatedAt: now,
      });
    } else {
      results.push({
        id: createId(),
        category: 'login',
        title,
        favorite: (r[idx('favorite')] || '').toLowerCase() === 'true',
        tags,
        notes,
        customFields: [],
        username,
        password,
        url,
        totpSecret,
        passwordUpdatedAt: now,
        passwordHistory: [],
        createdAt: now,
        updatedAt: now,
      });
    }
  }
  return results;
}
