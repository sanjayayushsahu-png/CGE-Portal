const zlib = require('node:zlib');

// CRC-32 table for ZIP archive
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[i] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function createZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8');
    const dataBuf = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content, 'utf8');
    const compressed = zlib.deflateRawSync(dataBuf);
    const crc = crc32(dataBuf);

    // Local file header
    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 flag
    localHeader.writeUInt16LE(8, 8); // deflate
    localHeader.writeUInt16LE(0, 10); // mod time
    localHeader.writeUInt16LE(0, 12); // mod date
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(dataBuf.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    nameBuf.copy(localHeader, 30);

    localParts.push(localHeader, compressed);

    // Central directory header
    const centralHeader = Buffer.alloc(46 + nameBuf.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(dataBuf.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    nameBuf.copy(centralHeader, 46);

    centralParts.push(centralHeader);
    offset += localHeader.length + compressed.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, eocd]);
}

function xmlEscape(val) {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function colLetter(idx) {
  let s = '';
  let n = idx + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// Style indices defined in styles.xml:
// 0: default normal left
// 1: title bold 14pt center
// 2: subtitle bold 11pt center
// 3: info bold 10pt left
// 4: table header bold 10pt center wrap gray-fill border
// 5: table subheader bold 9pt center gray-fill border
// 6: data left wrap border
// 7: data center wrap border
// 8: total row bold center light-blue-fill border
// 9: total row bold left light-blue-fill border
// 10: signature bold right
// 11: note italic left

function buildStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="6">
    <font><sz val="10"/><name val="Calibri"/></font>
    <font><b/><sz val="14"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><name val="Calibri"/></font>
    <font><b/><sz val="9"/><name val="Calibri"/></font>
    <font><i/><sz val="9"/><name val="Calibri"/></font>
  </fonts>
  <fills count="4">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFDBEAFE"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FF334155"/></left>
      <right style="thin"><color rgb="FF334155"/></right>
      <top style="thin"><color rgb="FF334155"/></top>
      <bottom style="thin"><color rgb="FF334155"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="12">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="4" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
  </cellXfs>
</styleSheet>`;
}

function buildWorksheetXml({ rows, colWidths, merges = [], rowHeights = {} }) {
  const colsXml = colWidths
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join('');

  const sheetDataXml = rows
    .map((row, rIdx) => {
      const rNum = rIdx + 1;
      const ht = rowHeights[rNum] ? ` ht="${rowHeights[rNum]}" customHeight="1"` : '';
      const cellsXml = row
        .map((cell, cIdx) => {
          if (cell === null || cell === undefined) return '';
          const ref = `${colLetter(cIdx)}${rNum}`;
          const isObj = typeof cell === 'object';
          const v = isObj ? cell.v : cell;
          const s = isObj && cell.s !== undefined ? ` s="${cell.s}"` : '';
          if (v === '' || v === null || v === undefined) {
            return `<c r="${ref}"${s}/>`;
          }
          if (typeof v === 'number' && !Number.isNaN(v)) {
            return `<c r="${ref}"${s}><v>${v}</v></c>`;
          }
          return `<c r="${ref}" t="inlineStr"${s}><is><t>${xmlEscape(v)}</t></is></c>`;
        })
        .join('');
      return `<row r="${rNum}"${ht}>${cellsXml}</row>`;
    })
    .join('');

  const mergesXml = merges.length
    ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="20"/>
  <cols>${colsXml}</cols>
  <sheetData>${sheetDataXml}</sheetData>
  ${mergesXml}
  <pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>
  <pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
}

function formatDateDMY(iso) {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function generateCgeWorkbook({ staff, form2, meta }) {
  const {
    district = 'बेमेतरा',
    censusDate = '31 मार्च, 2024',
    department = 'स्कूल शिक्षा विभाग',
    scopeLabel = 'कार्यालय',
    entityName = '',
    ddoCode = '',
    email = '',
    contact = '',
    signatureLabel = 'कार्यालय प्रमुख का हस्ताक्षर एवं सील'
  } = meta;

  // --- SHEET 1: प्रपत्र-01 (Form 1) ---
  const f1Rows = [];
  const f1Merges = [
    'A1:O1', 'A2:O2', 'A3:O3', 'A4:O4', 'A5:O5'
  ];

  f1Rows.push([{ v: 'प्रपत्र-01', s: 1 }]);
  f1Rows.push([{ v: `प्रशासनिक क्षेत्र में नियोजन गणना ${censusDate}`, s: 2 }]);
  f1Rows.push([{ v: `${censusDate} की स्थिति में इस ${scopeLabel} में कार्यरत अधिकारियों एवं कर्मचारियों की जानकारी`, s: 2 }]);
  f1Rows.push([{ v: `जिला: ${district}   |   ${scopeLabel} का नाम: ${entityName || 'समस्त'}   |   डी.डी.ओ. कोड: ${ddoCode || '-'}`, s: 3 }]);
  f1Rows.push([{ v: `विभाग का नाम: ${department}   |   सम्पर्क नम्बर / ई-मेल आई.डी.: ${[contact, email].filter(Boolean).join(' / ') || '-'}`, s: 3 }]);
  f1Rows.push([]); // blank row 6

  const f1Headers = [
    'S.NO.',
    'Employee Code',
    'Employee Name',
    'Gender\nM/F/Transgender',
    'Caste\nSC/ST/OBC/Gen.',
    'Date of Birth',
    'Date of First Joining',
    'Designation',
    'Class\nI/II/III (Executive or Ministerial)/IV',
    'Level in the Pay Matrix / Grade Pay',
    'Type of Employment\nRegular / Non Regular',
    'If Regular then\nPermanent / Temporary',
    'If Non Regular then Specify\n(Daily Wages/Contingency/Work Charged/Collector Rate/Contractual/Placement/Honorary/Part time)',
    'Is Post Sanctioned\nY/N',
    'Remark If any'
  ];
  f1Rows.push(f1Headers.map((h) => ({ v: h, s: 4 })));
  f1Rows.push(Array.from({ length: 15 }, (_, i) => ({ v: `(${i + 1})`, s: 5 })));

  staff.forEach((emp, idx) => {
    f1Rows.push([
      { v: idx + 1, s: 7 },
      { v: emp.emp_code, s: 7 },
      { v: emp.emp_name, s: 6 },
      { v: emp.gender, s: 7 },
      { v: emp.caste, s: 7 },
      { v: formatDateDMY(emp.dob), s: 7 },
      { v: formatDateDMY(emp.doj), s: 7 },
      { v: emp.designation, s: 6 },
      { v: emp.emp_class, s: 7 },
      { v: emp.pay_level, s: 7 },
      { v: emp.employment_type, s: 7 },
      { v: emp.employment_type === 'Regular' ? (emp.regular_status || '') : '', s: 7 },
      { v: emp.employment_type === 'Non Regular' ? (emp.non_regular_type || '') : '', s: 6 },
      { v: emp.is_sanctioned, s: 7 },
      { v: emp.remark || '', s: 6 }
    ]);
  });

  const noteRowNum = f1Rows.length + 1;
  f1Rows.push([{ v: 'Note: Please read instructions carefully before editing in the database.', s: 11 }]);
  f1Merges.push(`A${noteRowNum}:O${noteRowNum}`);
  f1Rows.push([]);
  const sigRowNum = f1Rows.length + 1;
  f1Rows.push([null, null, null, null, null, null, null, null, null, null, { v: signatureLabel, s: 10 }]);
  f1Merges.push(`K${sigRowNum}:O${sigRowNum}`);

  const sheet1Xml = buildWorksheetXml({
    rows: f1Rows,
    colWidths: [7, 15, 24, 14, 12, 13, 14, 22, 18, 16, 15, 16, 26, 12, 20],
    merges: f1Merges,
    rowHeights: { 1: 24, 2: 22, 3: 22, 4: 22, 5: 22, 7: 48, 8: 20 }
  });

  // --- SHEET 2: प्रपत्र-02 (गोश्वारा) ---
  const f2Rows = [];
  const f2Merges = [
    'A1:R1', 'A2:R2', 'A3:R3', 'A4:R4', 'A5:R5',
    'A6:A7', 'B6:F6', 'G6:K6', 'L6:P6', 'Q6:Q7', 'R6:R7'
  ];

  f2Rows.push([{ v: 'प्रपत्र-02 (प्रपत्र-01 का गोश्वारा)', s: 1 }]);
  f2Rows.push([{ v: 'प्रशासनिक क्षेत्र में नियोजन गणना की जानकारी', s: 2 }]);
  f2Rows.push([{ v: `${censusDate} की स्थिति में इस ${scopeLabel} में कार्यरत अधिकारियों एवं कर्मचारियों की संख्या`, s: 2 }]);
  f2Rows.push([{ v: `जिला: ${district}   |   ${scopeLabel} का नाम: ${entityName || 'समस्त'}   |   डी.डी.ओ. कोड: ${ddoCode || '-'}`, s: 3 }]);
  f2Rows.push([{ v: `विभाग: ${department}   |   सम्पर्क नम्बर एवं ई-मेल आई.डी.: ${[contact, email].filter(Boolean).join(' / ') || '-'}`, s: 3 }]);

  // Row 6: Group header
  f2Rows.push([
    { v: 'वर्ग / श्रेणी', s: 4 },
    { v: 'पुरुष (Male)', s: 4 }, { v: '', s: 4 }, { v: '', s: 4 }, { v: '', s: 4 }, { v: '', s: 4 },
    { v: 'महिला (Female)', s: 4 }, { v: '', s: 4 }, { v: '', s: 4 }, { v: '', s: 4 }, { v: '', s: 4 },
    { v: 'योग (Male + Female)', s: 4 }, { v: '', s: 4 }, { v: '', s: 4 }, { v: '', s: 4 }, { v: '', s: 4 },
    { v: 'Transgender', s: 4 },
    { v: 'Total', s: 4 }
  ]);

  // Row 7: Sub header
  f2Rows.push([
    { v: '', s: 4 },
    { v: 'SC', s: 5 }, { v: 'ST', s: 5 }, { v: 'OBC', s: 5 }, { v: 'GEN', s: 5 }, { v: 'Total', s: 5 },
    { v: 'SC', s: 5 }, { v: 'ST', s: 5 }, { v: 'OBC', s: 5 }, { v: 'GEN', s: 5 }, { v: 'Total', s: 5 },
    { v: 'SC', s: 5 }, { v: 'ST', s: 5 }, { v: 'OBC', s: 5 }, { v: 'GEN', s: 5 }, { v: 'Total', s: 5 },
    { v: '', s: 5 },
    { v: '', s: 5 }
  ]);

  for (const r of form2.rows) {
    f2Rows.push([
      { v: r.label, s: 6 },
      { v: r.m_sc, s: 7 }, { v: r.m_st, s: 7 }, { v: r.m_obc, s: 7 }, { v: r.m_gen, s: 7 }, { v: r.m_total, s: 8 },
      { v: r.f_sc, s: 7 }, { v: r.f_st, s: 7 }, { v: r.f_obc, s: 7 }, { v: r.f_gen, s: 7 }, { v: r.f_total, s: 8 },
      { v: r.t_sc, s: 7 }, { v: r.t_st, s: 7 }, { v: r.t_obc, s: 7 }, { v: r.t_gen, s: 7 }, { v: r.t_total, s: 8 },
      { v: r.transgender, s: 7 },
      { v: r.grand_total, s: 8 }
    ]);
  }

  const t = form2.totals;
  f2Rows.push([
    { v: t.label, s: 9 },
    { v: t.m_sc, s: 8 }, { v: t.m_st, s: 8 }, { v: t.m_obc, s: 8 }, { v: t.m_gen, s: 8 }, { v: t.m_total, s: 8 },
    { v: t.f_sc, s: 8 }, { v: t.f_st, s: 8 }, { v: t.f_obc, s: 8 }, { v: t.f_gen, s: 8 }, { v: t.f_total, s: 8 },
    { v: t.t_sc, s: 8 }, { v: t.t_st, s: 8 }, { v: t.t_obc, s: 8 }, { v: t.t_gen, s: 8 }, { v: t.t_total, s: 8 },
    { v: t.transgender, s: 8 },
    { v: t.grand_total, s: 8 }
  ]);

  f2Rows.push([]);
  const f2TipRow = f2Rows.length + 1;
  f2Rows.push([{ v: 'टीप:- कृपया प्रपत्र 01 के आधार पर भरा जावे।', s: 11 }]);
  f2Merges.push(`A${f2TipRow}:R${f2TipRow}`);
  f2Rows.push([]);
  const f2SigRow = f2Rows.length + 1;
  f2Rows.push([
    null, null, null, null, null, null, null, null, null, null, null, null,
    { v: signatureLabel, s: 10 }
  ]);
  f2Merges.push(`M${f2SigRow}:R${f2SigRow}`);

  const sheet2Xml = buildWorksheetXml({
    rows: f2Rows,
    colWidths: [28, 7, 7, 7, 7, 8, 7, 7, 7, 7, 8, 7, 7, 7, 7, 8, 12, 9],
    merges: f2Merges,
    rowHeights: { 1: 24, 2: 22, 3: 22, 4: 22, 5: 22, 6: 24, 7: 22 }
  });

  const files = [
    {
      name: '[Content_Types].xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`
    },
    {
      name: '_rels/.rels',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`
    },
    {
      name: 'xl/workbook.xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Form-1 (प्रपत्र-01)" sheetId="1" r:id="rId1"/>
    <sheet name="Form-2 (गोश्वारा)" sheetId="2" r:id="rId2"/>
  </sheets>
</workbook>`
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`
    },
    { name: 'xl/styles.xml', content: buildStylesXml() },
    { name: 'xl/worksheets/sheet1.xml', content: sheet1Xml },
    { name: 'xl/worksheets/sheet2.xml', content: sheet2Xml }
  ];

  return createZip(files);
}

function generateUploadTemplateWorkbook(level = 'school') {
  const isSankul = level === 'sankul';
  const headers = [
    ...(isSankul ? ['School Name', 'UDISE Code'] : []),
    'S.NO.',
    'Employee Code',
    'Employee Name',
    'Gender (M/F/Transgender)',
    'Caste (SC/ST/OBC/Gen.)',
    'Date of Birth (YYYY-MM-DD)',
    'Date of First Joining (YYYY-MM-DD)',
    'Designation',
    'Class (I/II/III (Executive)/III (Ministerial)/IV)',
    'Level in Pay Matrix / Grade Pay',
    'Type of Employment (Regular/Non Regular)',
    'If Regular (Permanent/Temporary)',
    'If Non Regular (Daily Wages/Contingency/Work Charged/Collector Rate/Contractual/Placement/Honorary/Part time)',
    'Is Post Sanctioned (Y/N)',
    'Remark If any'
  ];

  const rows = [
    headers.map((h) => ({ v: h, s: 4 })),
    [
      ...(isSankul ? [{ v: 'शास. प्रा. शा. उदाहरण-1', s: 6 }, { v: '22230100105', s: 7 }] : []),
      { v: 1, s: 7 }, { v: 'CG220101', s: 7 }, { v: 'Mohan Lal Sahu', s: 6 },
      { v: 'M', s: 7 }, { v: 'OBC', s: 7 }, { v: '1984-05-12', s: 7 }, { v: '2010-07-01', s: 7 },
      { v: 'Teacher (LB)', s: 6 }, { v: 'III (Executive)', s: 7 }, { v: 'Level-8', s: 7 },
      { v: 'Regular', s: 7 }, { v: 'Permanent', s: 7 }, { v: '', s: 6 }, { v: 'Y', s: 7 }, { v: '', s: 6 }
    ],
    [
      ...(isSankul ? [{ v: 'शास. पूर्व मा. शा. उदाहरण-2', s: 6 }, { v: '22230100106', s: 7 }] : []),
      { v: 2, s: 7 }, { v: 'CG220102', s: 7 }, { v: 'Kavita Verma', s: 6 },
      { v: 'F', s: 7 }, { v: 'SC', s: 7 }, { v: '1991-09-20', s: 7 }, { v: '2022-08-15', s: 7 },
      { v: 'Atithi Shikshak', s: 6 }, { v: 'III (Executive)', s: 7 }, { v: 'Fixed', s: 7 },
      { v: 'Non Regular', s: 7 }, { v: '', s: 7 }, { v: 'Contractual', s: 6 }, { v: 'N', s: 7 }, { v: '', s: 6 }
    ]
  ];

  const colWidths = [
    ...(isSankul ? [28, 16] : []),
    7, 15, 22, 16, 15, 16, 18, 20, 22, 16, 18, 18, 28, 14, 18
  ];

  const sheetXml = buildWorksheetXml({ rows, colWidths, merges: [], rowHeights: { 1: 38 } });

  return createZip([
    {
      name: '[Content_Types].xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`
    },
    {
      name: '_rels/.rels',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`
    },
    {
      name: 'xl/workbook.xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="${isSankul ? 'Sankul Upload' : 'School Upload'}" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`
    },
    { name: 'xl/styles.xml', content: buildStylesXml() },
    { name: 'xl/worksheets/sheet1.xml', content: sheetXml }
  ]);
}

module.exports = { generateCgeWorkbook, generateUploadTemplateWorkbook };
