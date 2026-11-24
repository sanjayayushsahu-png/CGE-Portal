const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFile } = require('node:child_process');
const { db, findDuplicateStaff } = require('./db');

// ---------------------------------------------------------------------------
// Pure Node.js ZIP / XLSX / CSV reader (zero external dependencies)
// ---------------------------------------------------------------------------

function readZipEntries(buffer) {
  // Locate End of Central Directory (EOCD) record: signature 0x06054b50
  const minPos = Math.max(0, buffer.length - 65557);
  let eocdPos = -1;
  for (let i = buffer.length - 22; i >= minPos; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdPos = i;
      break;
    }
  }
  if (eocdPos === -1) {
    throw new Error('अमान्य XLSX फ़ाइल (ZIP हेडर नहीं मिला)');
  }

  const totalEntries = buffer.readUInt16LE(eocdPos + 10);
  const centralDirOffset = buffer.readUInt32LE(eocdPos + 16);
  const entries = new Map();

  let pos = centralDirOffset;
  for (let i = 0; i < totalEntries && pos + 46 <= buffer.length; i++) {
    if (buffer.readUInt32LE(pos) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(pos + 10);
    const compressedSize = buffer.readUInt32LE(pos + 20);
    const nameLen = buffer.readUInt16LE(pos + 28);
    const extraLen = buffer.readUInt16LE(pos + 30);
    const commentLen = buffer.readUInt16LE(pos + 32);
    const localHeaderOffset = buffer.readUInt32LE(pos + 42);

    const rawName = buffer.subarray(pos + 46, pos + 46 + nameLen).toString('utf8');
    const name = rawName.replace(/\\/g, '/').replace(/^\/+/, '');
    pos += 46 + nameLen + extraLen + commentLen;

    if (localHeaderOffset + 30 > buffer.length) continue;
    if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) continue;

    const lNameLen = buffer.readUInt16LE(localHeaderOffset + 26);
    const lExtraLen = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + lNameLen + lExtraLen;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);

    if (method === 0) {
      entries.set(name, compressed);
    } else if (method === 8) {
      entries.set(name, zlib.inflateRawSync(compressed));
    }
  }

  return entries;
}

function decodeXmlEntities(str) {
  if (!str) return '';
  return String(str)
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex) => {
      const code = parseInt(hex, 16);
      return code === 0x0d ? '' : String.fromCharCode(code);
    })
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function parseXmlAttrs(attrStr) {
  const attrs = {};
  if (!attrStr) return attrs;
  const re = /([A-Za-z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(attrStr)) !== null) {
    attrs[m[1]] = decodeXmlEntities(m[2] !== undefined ? m[2] : m[3]);
  }
  return attrs;
}

function colLettersToIndex(letters) {
  let idx = 0;
  for (let i = 0; i < letters.length; i++) {
    idx = idx * 26 + (letters.charCodeAt(i) - 64);
  }
  return idx - 1;
}

function extractTextNodes(xmlFragment) {
  const cleaned = xmlFragment.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let out = '';
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
  let m;
  while ((m = re.exec(cleaned)) !== null) {
    out += decodeXmlEntities(m[1]);
  }
  return out;
}

function parseSharedStrings(xml) {
  const strings = [];
  if (!xml) return strings;
  const re = /<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    strings.push(extractTextNodes(m[1]));
  }
  return strings;
}

const BUILTIN_DATE_FMT_IDS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22,
  27, 28, 29, 30, 31, 32, 33, 34, 35, 36,
  45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58
]);

function isDateFormatCode(code) {
  if (!code) return false;
  // Remove quoted literals, [bracketed] locale/color tokens, and escaped chars
  const stripped = code
    .replace(/"[^"]*"/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\\./g, '')
    .toLowerCase();
  return /[dy]/.test(stripped) || (/m/.test(stripped) && /[/-]/.test(stripped));
}

function parseDateStyleIndices(stylesXml) {
  const dateStyles = new Set();
  if (!stylesXml) return dateStyles;

  const customDateFmtIds = new Set();
  const numFmtsMatch = stylesXml.match(/<numFmts\b[^>]*>([\s\S]*?)<\/numFmts>/);
  if (numFmtsMatch) {
    const nfRe = /<numFmt\b([^>]*)\/?>/g;
    let m;
    while ((m = nfRe.exec(numFmtsMatch[1])) !== null) {
      const attrs = parseXmlAttrs(m[1]);
      const id = Number(attrs.numFmtId);
      if (!Number.isNaN(id) && isDateFormatCode(attrs.formatCode)) {
        customDateFmtIds.add(id);
      }
    }
  }

  const cellXfsMatch = stylesXml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/);
  if (cellXfsMatch) {
    const xfRe = /<xf\b([^>]*)(?:\/>|>[\s\S]*?<\/xf>)/g;
    let m;
    let idx = 0;
    while ((m = xfRe.exec(cellXfsMatch[1])) !== null) {
      const attrs = parseXmlAttrs(m[1]);
      const numFmtId = Number(attrs.numFmtId);
      if (BUILTIN_DATE_FMT_IDS.has(numFmtId) || customDateFmtIds.has(numFmtId)) {
        dateStyles.add(idx);
      }
      idx++;
    }
  }

  return dateStyles;
}

function excelSerialToIsoDate(serial, is1904) {
  const days = Math.floor(serial);
  let utcMs;
  if (is1904) {
    utcMs = Date.UTC(1904, 0, 1) + days * 86400000;
  } else {
    // Excel 1900 date system has a leap-year bug for 1900-02-29 (serial 60)
    const base = days < 60 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
    utcMs = base + days * 86400000;
  }
  const d = new Date(utcMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function resolveActiveSheetPath(entries) {
  const wbBuf = entries.get('xl/workbook.xml');
  const relsBuf = entries.get('xl/_rels/workbook.xml.rels');

  if (wbBuf && relsBuf) {
    const wbXml = wbBuf.toString('utf8');
    const relsXml = relsBuf.toString('utf8');

    let activeTab = 0;
    const viewMatch = wbXml.match(/<workbookView\b([^>]*)\/?>/);
    if (viewMatch) {
      const vAttrs = parseXmlAttrs(viewMatch[1]);
      if (vAttrs.activeTab && !Number.isNaN(Number(vAttrs.activeTab))) {
        activeTab = Number(vAttrs.activeTab);
      }
    }

    const sheets = [];
    const sheetRe = /<sheet\b([^>]*)\/?>/g;
    let sm;
    while ((sm = sheetRe.exec(wbXml)) !== null) {
      sheets.push(parseXmlAttrs(sm[1]));
    }

    const chosen = sheets[activeTab] || sheets[0];
    const relId = chosen && (chosen['r:id'] || chosen.id);

    if (relId) {
      const relRe = /<Relationship\b([^>]*)\/?>/g;
      let rm;
      while ((rm = relRe.exec(relsXml)) !== null) {
        const rAttrs = parseXmlAttrs(rm[1]);
        if (rAttrs.Id === relId && rAttrs.Target) {
          const target = rAttrs.Target.replace(/\\/g, '/').replace(/^\/+/, '');
          const candidate = target.startsWith('xl/') ? target : `xl/${target}`;
          if (entries.has(candidate)) return candidate;
        }
      }
    }
  }

  if (entries.has('xl/worksheets/sheet1.xml')) return 'xl/worksheets/sheet1.xml';
  for (const key of entries.keys()) {
    if (/^xl\/worksheets\/sheet\d+\.xml$/i.test(key)) return key;
  }
  return null;
}

function parseXlsxBuffer(buffer) {
  const entries = readZipEntries(buffer);
  const sheetPath = resolveActiveSheetPath(entries);
  if (!sheetPath || !entries.has(sheetPath)) {
    throw new Error('XLSX फ़ाइल में वर्कशीट नहीं मिली');
  }

  const wbXml = entries.has('xl/workbook.xml') ? entries.get('xl/workbook.xml').toString('utf8') : '';
  const is1904 = /<workbookPr\b[^>]*\bdate1904\s*=\s*["'](1|true)["']/i.test(wbXml);

  const sharedStrings = entries.has('xl/sharedStrings.xml')
    ? parseSharedStrings(entries.get('xl/sharedStrings.xml').toString('utf8'))
    : [];
  const dateStyles = entries.has('xl/styles.xml')
    ? parseDateStyleIndices(entries.get('xl/styles.xml').toString('utf8'))
    : new Set();

  const sheetXml = entries.get(sheetPath).toString('utf8');
  const dataMatch = sheetXml.match(/<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/);
  const sheetData = dataMatch ? dataMatch[1] : sheetXml;

  const rows = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch;
  while ((rowMatch = rowRe.exec(sheetData)) !== null) {
    const rowContent = rowMatch[1];
    const cells = [];
    let nextCol = 0;

    const cellRe = /<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowContent)) !== null) {
      const attrs = parseXmlAttrs(cellMatch[1]);
      const inner = cellMatch[2] || '';

      let colIdx = nextCol;
      if (attrs.r) {
        const refMatch = attrs.r.match(/^([A-Z]+)/i);
        if (refMatch) colIdx = colLettersToIndex(refMatch[1].toUpperCase());
      }
      nextCol = colIdx + 1;

      while (cells.length < colIdx) cells.push('');

      const t = attrs.t || '';
      const styleIdx = attrs.s !== undefined ? Number(attrs.s) : -1;
      let val = '';

      if (t === 'inlineStr') {
        val = extractTextNodes(inner).trim();
      } else {
        const vMatch = inner.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/);
        const rawV = vMatch ? vMatch[1] : '';

        if (t === 's') {
          const sIdx = Number(rawV);
          val = (sIdx >= 0 && sIdx < sharedStrings.length ? sharedStrings[sIdx] : '').trim();
        } else if (t === 'str') {
          val = decodeXmlEntities(rawV).trim();
        } else if (t === 'b') {
          val = rawV === '1' ? 'TRUE' : 'FALSE';
        } else if (t === 'e') {
          val = '';
        } else if (t === 'd') {
          val = decodeXmlEntities(rawV).trim().slice(0, 10);
        } else if (rawV !== '') {
          const num = Number(rawV);
          if (!Number.isNaN(num)) {
            if (dateStyles.has(styleIdx) && num > 0 && num < 2958466) {
              val = excelSerialToIsoDate(num, is1904);
            } else {
              val = Number.isInteger(num) ? String(num) : String(num);
            }
          } else {
            val = decodeXmlEntities(rawV).trim();
          }
        }
      }

      cells[colIdx] = val;
    }

    rows.push(cells);
  }

  return rows;
}

function parseCsvBuffer(buffer) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    text = buffer.toString('latin1');
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field.trim());
      field = '';
    } else if (ch === '\r') {
      if (text[i + 1] === '\n') i++;
      row.push(field.trim());
      rows.push(row);
      row = [];
      field = '';
    } else if (ch === '\n') {
      row.push(field.trim());
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field.trim());
    rows.push(row);
  }
  return rows;
}

function getPythonCandidates() {
  const candidates = [];
  if (process.env.PYTHON) candidates.push({ cmd: process.env.PYTHON, args: [] });
  candidates.push({ cmd: 'python', args: [] });
  candidates.push({ cmd: 'py', args: ['-3'] });
  candidates.push({ cmd: 'python3', args: [] });

  if (process.platform === 'win32') {
    const roots = [
      'C:\\Python314', 'C:\\Python313', 'C:\\Python312', 'C:\\Python311', 'C:\\Python310',
      'C:\\Program Files\\Python314', 'C:\\Program Files\\Python313', 'C:\\Program Files\\Python312'
    ];
    if (process.env.LOCALAPPDATA) {
      const pyDir = path.join(process.env.LOCALAPPDATA, 'Programs', 'Python');
      try {
        for (const sub of fs.readdirSync(pyDir)) {
          roots.push(path.join(pyDir, sub));
        }
      } catch {}
    }
    for (const dir of roots) {
      const exe = path.join(dir, 'python.exe');
      if (fs.existsSync(exe)) candidates.push({ cmd: exe, args: [] });
    }
  }

  return candidates;
}

function parseWithPython(buffer, filename) {
  return new Promise((resolve, reject) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cge-imp-'));
    const ext = path.extname(filename || '.xls').toLowerCase() || '.xls';
    const tmpFile = path.join(tmpDir, `input${ext}`);
    const scriptPath = path.join(__dirname, 'excel_reader.py');

    const cleanup = () => {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    };

    try {
      fs.writeFileSync(tmpFile, buffer);
    } catch (err) {
      cleanup();
      return reject(err);
    }

    const candidates = getPythonCandidates();
    let idx = 0;

    const tryNext = () => {
      if (idx >= candidates.length) {
        cleanup();
        return reject(new Error(
          'पुरानी .xls फ़ाइल पढ़ने के लिए सिस्टम में Python नहीं मिला। कृपया फ़ाइल को Excel में .xlsx या .csv फ़ॉर्मेट में Save As करके अपलोड करें।'
        ));
      }
      const { cmd, args } = candidates[idx++];
      execFile(cmd, [...args, scriptPath, tmpFile], { maxBuffer: 25 * 1024 * 1024, timeout: 30000 }, (err, stdout, stderr) => {
        if (err && err.code === 'ENOENT') {
          return tryNext();
        }
        cleanup();
        if (err) {
          let msg = stderr || err.message;
          try {
            const parsed = JSON.parse(stdout);
            if (parsed.error) msg = parsed.error;
          } catch {}
          return reject(new Error(`Excel पढ़ने में त्रुटि: ${msg}`));
        }
        try {
          const parsed = JSON.parse(stdout);
          if (parsed.error) return reject(new Error(parsed.error));
          resolve(parsed.rows || []);
        } catch (parseErr) {
          reject(new Error(`Excel डेटा प्रोसेस करने में त्रुटि: ${parseErr.message}`));
        }
      });
    };

    tryNext();
  });
}

async function parseSpreadsheetBuffer(buffer, filename = 'upload.xlsx') {
  const ext = path.extname(filename || '.xlsx').toLowerCase();
  const isZip = buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b; // "PK"
  const isOle2 = buffer.length >= 4 && buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0;

  if (isZip || ext === '.xlsx') {
    try {
      return parseXlsxBuffer(buffer);
    } catch (nativeErr) {
      // Fallback to Python if available for unusual XLSX variants
      try {
        return await parseWithPython(buffer, filename);
      } catch {
        throw new Error(`Excel पढ़ने में त्रुटि: ${nativeErr.message}`);
      }
    }
  }

  if (isOle2 || ext === '.xls') {
    if (!isOle2 && !isZip) {
      // Some .xls exports are actually CSV/text renamed to .xls
      return parseCsvBuffer(buffer);
    }
    return parseWithPython(buffer, filename);
  }

  return parseCsvBuffer(buffer);
}

function normGender(v) {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return 'M';
  if (s.startsWith('f') || s.includes('महिला') || s.includes('female')) return 'F';
  if (s.startsWith('t') || s.includes('trans')) return 'Transgender';
  return 'M';
}

function normCaste(v) {
  const s = String(v || '').trim().toUpperCase();
  if (s === 'SC' || s.includes('अ.जा')) return 'SC';
  if (s === 'ST' || s.includes('अ.ज.जा')) return 'ST';
  if (s === 'OBC' || s.includes('पिछड़ा')) return 'OBC';
  return 'Gen.';
}

function normClass(v) {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return 'III (Executive)';
  if (s === 'i' || s === '1' || s === 'class i' || s === 'class 1' || s.includes('प्रथम')) return 'I';
  if (s === 'ii' || s === '2' || s === 'class ii' || s === 'class 2' || s.includes('द्वितीय')) return 'II';
  if (s === 'iv' || s === '4' || s === 'class iv' || s === 'class 4' || s.includes('चतुर्थ')) return 'IV';
  if (s.includes('min') || s.includes('अनुसचिवीय') || s.includes('लिपिक')) return 'III (Ministerial)';
  return 'III (Executive)';
}

function normEmploymentType(v) {
  const s = String(v || '').trim().toLowerCase();
  if (s.includes('non') || s.includes('अनियमित')) return 'Non Regular';
  return 'Regular';
}

function normRegularStatus(v) {
  const s = String(v || '').trim().toLowerCase();
  if (s.includes('temp') || s.includes('अस्थायी')) return 'Temporary';
  return 'Permanent';
}

function normNonRegularType(v) {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return 'Contractual';
  if (s.includes('work') || s.includes('कार्यभारित')) return 'Work Charged';
  if (s.includes('contin') || s.includes('आकस्मिक')) return 'Contingency';
  if (s.includes('daily') || s.includes('दैनिक')) return 'Daily Wages';
  if (s.includes('collect') || s.includes('कलेक्टर')) return 'Collector Rate';
  if (s.includes('place') || s.includes('प्लेसमेंट')) return 'Placement';
  if (s.includes('honor') || s.includes('मानसेवी')) return 'Honorary';
  if (s.includes('part') || s.includes('अंशकालीन')) return 'Part time';
  return 'Contractual';
}

function normSanctioned(v) {
  const s = String(v || '').trim().toLowerCase();
  if (s === 'n' || s === 'no' || s.includes('नहीं')) return 'N';
  return 'Y';
}

function normDate(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dmy = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (dmy) {
    const dd = dmy[1].padStart(2, '0');
    const mm = dmy[2].padStart(2, '0');
    let yy = dmy[3];
    if (yy.length === 2) yy = Number(yy) > 35 ? `19${yy}` : `20${yy}`;
    return `${yy}-${mm}-${dd}`;
  }
  return s;
}

function mapColumns(headerRow) {
  const idx = {};
  headerRow.forEach((raw, i) => {
    const h = String(raw || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!h) return;
    if ((h.includes('school') && h.includes('name')) || h.includes('विद्यालय') || h === 'school') idx.school_name = i;
    else if (h.includes('udise')) idx.udise_code = i;
    else if (h.includes('code') && (h.includes('emp') || h.includes('emlp') || h.includes('कर्मचारी'))) idx.emp_code = i;
    else if (h.includes('name') && (h.includes('emp') || h.includes('emlp') || h.includes('कर्मचारी'))) idx.emp_name = i;
    else if (h.includes('gender') || h.includes('gendre') || h.includes('लिंग')) idx.gender = i;
    else if (h.includes('caste') || h.includes('जाति') || h.includes('वर्ग')) idx.caste = i;
    else if (h.includes('birth') || h === 'dob' || h.includes('जन्म')) idx.dob = i;
    else if (h.includes('joining') || h === 'doj' || h.includes('नियुक्ति')) idx.doj = i;
    else if (h.includes('designation') || h.includes('पदनाम')) idx.designation = i;
    else if (h.includes('class') || h.includes('श्रेणी')) idx.emp_class = i;
    else if (h.includes('pay') || h.includes('level') || h.includes('grade') || h.includes('वेतन')) idx.pay_level = i;
    else if (h.includes('type of employment') || h.includes('नियोजन प्रकार')) idx.employment_type = i;
    else if (h.includes('if regular') || h.includes('permanent') || h.includes('regular status')) idx.regular_status = i;
    else if (h.includes('if non regular') || h.includes('non regular type') || h.includes('specify')) idx.non_regular_type = i;
    else if (h.includes('sanctioned') || h.includes('स्वीकृत')) idx.is_sanctioned = i;
    else if (h.includes('remark') || h.includes('टिप्पणी')) idx.remark = i;
  });
  return idx;
}

function findHeaderRowIndex(rows) {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const joined = rows[i].map((c) => String(c || '').toLowerCase()).join(' ');
    if (
      (joined.includes('employee') || joined.includes('emlpoyee')) &&
      (joined.includes('code') || joined.includes('name') || joined.includes('designation'))
    ) {
      return i;
    }
  }
  return 0;
}

function isSkippableRow(row) {
  const nonEmpty = row.map((c) => String(c || '').trim()).filter(Boolean);
  if (nonEmpty.length === 0) return true;
  const joined = nonEmpty.join(' ').toLowerCase();
  if (joined.startsWith('(1)') || joined.includes('(1) (2) (3)')) return true;
  if (joined.startsWith('note:') || joined.startsWith('टीप') || joined.includes('हस्ताक्षर') || joined.includes('signature')) return true;
  return false;
}

async function importExcelForLevel({ buffer, filename, level, block_id, sankul_id, school_id }) {
  const rows = await parseSpreadsheetBuffer(buffer, filename);
  if (!rows.length) throw new Error('फ़ाइल खाली है (No rows found)');

  const headerIdx = findHeaderRowIndex(rows);
  const colMap = mapColumns(rows[headerIdx]);

  if (colMap.emp_code === undefined || colMap.emp_name === undefined) {
    throw new Error('फ़ाइल में "Employee Code" और "Employee Name" कॉलम नहीं मिले। कृपया दिए गए Excel टेम्पलेट का उपयोग करें।');
  }

  if (level === 'school' && (!block_id || !sankul_id || !school_id)) {
    throw new Error('विद्यालय स्तर अपलोड के लिए विकासखंड, संकुल और विद्यालय चुनना आवश्यक है।');
  }
  if (level === 'sankul' && (!block_id || !sankul_id)) {
    throw new Error('संकुल स्तर अपलोड के लिए विकासखंड और संकुल चुनना आवश्यक है।');
  }

  // Load existing schools in this sankul for sankul-level matching (by normalized name OR UDISE)
  const normKey = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const existingSchools = db.prepare('SELECT * FROM schools WHERE sankul_id = ?').all(Number(sankul_id));
  const schoolByName = new Map();
  const schoolByUdise = new Map();
  for (const sc of existingSchools) {
    schoolByName.set(normKey(sc.name), sc.id);
    if (sc.udise_code && String(sc.udise_code).trim()) {
      schoolByUdise.set(normKey(sc.udise_code), sc.id);
    }
  }

  const insertSchoolStmt = db.prepare(
    'INSERT INTO schools (block_id, sankul_id, name, udise_code, school_type) VALUES (?, ?, ?, ?, ?)'
  );
  const insertStaffStmt = db.prepare(`
    INSERT INTO staff (
      block_id, sankul_id, school_id, emp_code, emp_name, gender, caste,
      dob, doj, designation, emp_class, pay_level, employment_type,
      regular_status, non_regular_type, is_sanctioned, remark, is_sample
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `);

  let inserted = 0;
  let schoolsCreated = 0;
  let duplicatesSkipped = 0;
  const skipped = [];

  const getCell = (r, key) => (colMap[key] !== undefined ? String(r[colMap[key]] ?? '').trim() : '');

  db.exec('BEGIN');
  try {
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      if (isSkippableRow(r)) continue;

      const empCode = getCell(r, 'emp_code').replace(/\s+/g, ' ').trim();
      const empName = getCell(r, 'emp_name').replace(/\s+/g, ' ').trim();
      if (!empCode && !empName) continue;
      if (!empCode || !empName) {
        skipped.push({ row: i + 1, reason: 'Employee Code या Name खाली है' });
        continue;
      }

      const dobClean = normDate(getCell(r, 'dob'));
      const desigClean = (getCell(r, 'designation') || 'Teacher').replace(/\s+/g, ' ').trim();

      // Resolve existing school (without creating a new one yet)
      let targetSchoolId = school_id ? Number(school_id) : null;
      const schName = getCell(r, 'school_name').replace(/\s+/g, ' ').trim();
      const udise = getCell(r, 'udise_code').replace(/\s+/g, '').trim();

      if (level === 'sankul') {
        if (udise && schoolByUdise.has(normKey(udise))) {
          targetSchoolId = schoolByUdise.get(normKey(udise));
        } else if (schName && schoolByName.has(normKey(schName))) {
          targetSchoolId = schoolByName.get(normKey(schName));
        }
      }

      // Check duplicate BEFORE creating any new school or inserting staff
      const dup = findDuplicateStaff({
        emp_code: empCode,
        emp_name: empName,
        dob: dobClean,
        designation: desigClean,
        sankul_id: Number(sankul_id),
        school_id: targetSchoolId
      });
      if (dup) {
        duplicatesSkipped++;
        skipped.push({ row: i + 1, reason: dup.message });
        continue;
      }

      // Now auto-create school only for valid non-duplicate rows
      if (level === 'sankul' && !targetSchoolId) {
        if (schName) {
          const info = insertSchoolStmt.run(Number(block_id), Number(sankul_id), schName, udise, 'Primary');
          targetSchoolId = Number(info.lastInsertRowid);
          schoolByName.set(normKey(schName), targetSchoolId);
          if (udise) schoolByUdise.set(normKey(udise), targetSchoolId);
          schoolsCreated++;
        } else if (existingSchools.length > 0) {
          targetSchoolId = existingSchools[0].id;
        } else {
          const sankul = db.prepare('SELECT name FROM sankuls WHERE id = ?').get(Number(sankul_id));
          const defName = sankul ? `${sankul.name} (Default School)` : 'संकुल विद्यालय';
          const info = insertSchoolStmt.run(Number(block_id), Number(sankul_id), defName, '', 'Primary');
          targetSchoolId = Number(info.lastInsertRowid);
          schoolByName.set(normKey(defName), targetSchoolId);
          existingSchools.push({ id: targetSchoolId, name: defName });
          schoolsCreated++;
        }
      }

      const empType = normEmploymentType(getCell(r, 'employment_type'));
      const regStatus = empType === 'Regular' ? normRegularStatus(getCell(r, 'regular_status')) : '';
      const nonRegType = empType === 'Non Regular' ? normNonRegularType(getCell(r, 'non_regular_type')) : '';

      insertStaffStmt.run(
        Number(block_id),
        Number(sankul_id),
        targetSchoolId,
        empCode,
        empName,
        normGender(getCell(r, 'gender')),
        normCaste(getCell(r, 'caste')),
        dobClean,
        normDate(getCell(r, 'doj')),
        desigClean,
        normClass(getCell(r, 'emp_class')),
        getCell(r, 'pay_level'),
        empType,
        regStatus,
        nonRegType,
        normSanctioned(getCell(r, 'is_sanctioned')),
        getCell(r, 'remark')
      );
      inserted++;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return { inserted, schoolsCreated, duplicatesSkipped, skipped };
}

module.exports = { importExcelForLevel, parseSpreadsheetBuffer };
