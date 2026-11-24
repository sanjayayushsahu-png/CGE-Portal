const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { db, computeForm2, getSettings, getStaffFiltered, findDuplicateStaff } = require('./db');
const { generateCgeWorkbook, generateUploadTemplateWorkbook } = require('./xlsx_generator');
const { generateCgePdfBuffer } = require('./pdf_generator');
const { importExcelForLevel } = require('./excel_import');

const PORT = Number(process.env.PORT) || 3456;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 15 * 1024 * 1024) {
        reject(new Error('Request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

function resolveCgeReport(searchParams) {
  const scope = searchParams.get('scope') || 'district'; // district | block | sankul | school
  const id = searchParams.get('id') ? Number(searchParams.get('id')) : null;
  const settings = getSettings();

  let filters = {};
  let meta = {
    district: settings.district_name || 'बेमेतरा',
    censusDate: settings.census_date || '31 मार्च, 2024',
    department: settings.department_name || 'स्कूल शिक्षा विभाग',
    scope,
    scopeLabel: 'कार्यालय',
    entityName: 'समस्त जिला (All District)',
    ddoCode: '',
    email: settings.default_email || '',
    contact: settings.default_contact || '',
    signatureLabel: 'कार्यालय प्रमुख का हस्ताक्षर एवं सील'
  };

  if (scope === 'block' && id) {
    const block = db.prepare('SELECT * FROM blocks WHERE id = ?').get(id);
    if (block) {
      filters.block_id = block.id;
      meta.scopeLabel = 'विकासखंड / कार्यालय';
      meta.entityName = block.name;
      meta.ddoCode = block.ddo_code || '';
      meta.email = block.email || meta.email;
      meta.contact = block.contact || meta.contact;
      meta.signatureLabel = 'विकासखंड शिक्षा अधिकारी / कार्यालय प्रमुख का हस्ताक्षर एवं सील';
    }
  } else if (scope === 'sankul' && id) {
    const sankul = db.prepare(`
      SELECT sn.*, b.name AS block_name
      FROM sankuls sn JOIN blocks b ON sn.block_id = b.id
      WHERE sn.id = ?
    `).get(id);
    if (sankul) {
      filters.sankul_id = sankul.id;
      meta.scopeLabel = 'संकुल';
      meta.entityName = `${sankul.name} (${sankul.block_name})`;
      meta.ddoCode = sankul.ddo_code || '';
      meta.email = sankul.email || meta.email;
      meta.contact = sankul.contact || meta.contact;
      meta.signatureLabel = 'संकुल समन्वयक के हस्ताक्षर एवं सील';
    }
  } else if (scope === 'school' && id) {
    const school = db.prepare(`
      SELECT sc.*, sn.name AS sankul_name, sn.ddo_code AS sankul_ddo, b.name AS block_name
      FROM schools sc
      JOIN sankuls sn ON sc.sankul_id = sn.id
      JOIN blocks b ON sc.block_id = b.id
      WHERE sc.id = ?
    `).get(id);
    if (school) {
      filters.school_id = school.id;
      meta.scopeLabel = 'विद्यालय';
      meta.entityName = `${school.name}${school.udise_code ? ` (UDISE: ${school.udise_code})` : ''}`;
      meta.ddoCode = school.ddo_code || school.sankul_ddo || '';
      meta.email = school.email || meta.email;
      meta.contact = school.contact || meta.contact;
      meta.signatureLabel = 'संस्था प्रमुख (प्राचार्य / प्रधानपाठक) का हस्ताक्षर एवं सील';
    }
  }

  const staff = getStaffFiltered(filters);
  const form2 = computeForm2(staff);
  return { meta, staff, form2 };
}

function csvEscape(v) {
  const s = String(v ?? '');
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildForm1Csv(staff, meta) {
  const lines = [];
  lines.push([`प्रपत्र-01`, `प्रशासनिक क्षेत्र में नियोजन गणना ${meta.censusDate}`].map(csvEscape).join(','));
  lines.push([`जिला: ${meta.district}`, `${meta.scopeLabel}: ${meta.entityName}`, `DDO कोड: ${meta.ddoCode || '-'}`].map(csvEscape).join(','));
  lines.push([
    'S.NO.', 'Employee Code', 'Employee Name', 'Gender', 'Caste', 'Date of Birth',
    'Date of First Joining', 'Designation', 'Class', 'Level in Pay Matrix / Grade Pay',
    'Type of Employment', 'If Regular (Permanent/Temporary)', 'If Non Regular (Specify)',
    'Is Post Sanctioned (Y/N)', 'Remark If any', 'School', 'Sankul', 'Block'
  ].map(csvEscape).join(','));

  staff.forEach((e, i) => {
    lines.push([
      i + 1, e.emp_code, e.emp_name, e.gender, e.caste, e.dob, e.doj,
      e.designation, e.emp_class, e.pay_level, e.employment_type,
      e.employment_type === 'Regular' ? e.regular_status : '',
      e.employment_type === 'Non Regular' ? e.non_regular_type : '',
      e.is_sanctioned, e.remark, e.school_name, e.sankul_name, e.block_name
    ].map(csvEscape).join(','));
  });
  return '\uFEFF' + lines.join('\r\n');
}

function buildForm2Csv(form2, meta) {
  const lines = [];
  lines.push([`प्रपत्र-02 (प्रपत्र-01 का गोश्वारा)`, `${meta.censusDate}`, `${meta.entityName}`].map(csvEscape).join(','));
  lines.push([
    'वर्ग/श्रेणी',
    'पुरुष SC', 'पुरुष ST', 'पुरुष OBC', 'पुरुष GEN', 'पुरुष Total',
    'महिला SC', 'महिला ST', 'महिला OBC', 'महिला GEN', 'महिला Total',
    'योग SC', 'योग ST', 'योग OBC', 'योग GEN', 'योग Total',
    'Transgender', 'Grand Total'
  ].map(csvEscape).join(','));

  for (const r of [...form2.rows, form2.totals]) {
    lines.push([
      r.label,
      r.m_sc, r.m_st, r.m_obc, r.m_gen, r.m_total,
      r.f_sc, r.f_st, r.f_obc, r.f_gen, r.f_total,
      r.t_sc, r.t_st, r.t_obc, r.t_gen, r.t_total,
      r.transgender, r.grand_total
    ].map(csvEscape).join(','));
  }
  return '\uFEFF' + lines.join('\r\n');
}

function validateStaffPayload(b) {
  const errors = [];
  if (!b.block_id) errors.push('Block आवश्यक है');
  if (!b.sankul_id) errors.push('Sankul आवश्यक है');
  if (!b.school_id) errors.push('School आवश्यक है');
  if (!b.emp_code || !String(b.emp_code).trim()) errors.push('Employee Code आवश्यक है');
  if (!b.emp_name || !String(b.emp_name).trim()) errors.push('Employee Name आवश्यक है');
  if (!['M', 'F', 'Transgender'].includes(b.gender)) errors.push('Valid Gender चुनें');
  if (!['SC', 'ST', 'OBC', 'Gen.'].includes(b.caste)) errors.push('Valid Caste चुनें');
  if (!b.designation || !String(b.designation).trim()) errors.push('Designation आवश्यक है');
  if (!['I', 'II', 'III (Executive)', 'III (Ministerial)', 'IV'].includes(b.emp_class)) errors.push('Valid Class चुनें');
  if (!['Regular', 'Non Regular'].includes(b.employment_type)) errors.push('Valid Employment Type चुनें');
  if (!['Y', 'N'].includes(b.is_sanctioned || 'Y')) errors.push('Is Post Sanctioned Y या N होना चाहिए');
  return errors;
}

function getSummaryByEntity(groupSql) {
  return db.prepare(groupSql).all();
}

const server = http.createServer(async (req, res) => {
  try {
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    const pathname = urlObj.pathname;
    const method = req.method;

    // --- API ROUTES ---
    if (pathname.startsWith('/api/')) {
      // Settings
      if (pathname === '/api/settings' && method === 'GET') {
        return sendJson(res, 200, getSettings());
      }
      if (pathname === '/api/settings' && method === 'PUT') {
        const body = await readBody(req);
        const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
        for (const [k, v] of Object.entries(body)) {
          upsert.run(k, String(v ?? ''));
        }
        return sendJson(res, 200, getSettings());
      }

      // Dashboard & Summaries
      if (pathname === '/api/dashboard' && method === 'GET') {
        const counts = {
          blocks: db.prepare('SELECT COUNT(*) as c FROM blocks').get().c,
          sankuls: db.prepare('SELECT COUNT(*) as c FROM sankuls').get().c,
          schools: db.prepare('SELECT COUNT(*) as c FROM schools').get().c,
          staff: db.prepare('SELECT COUNT(*) as c FROM staff').get().c,
          regular: db.prepare("SELECT COUNT(*) as c FROM staff WHERE employment_type = 'Regular'").get().c,
          nonRegular: db.prepare("SELECT COUNT(*) as c FROM staff WHERE employment_type = 'Non Regular'").get().c,
          male: db.prepare("SELECT COUNT(*) as c FROM staff WHERE gender = 'M'").get().c,
          female: db.prepare("SELECT COUNT(*) as c FROM staff WHERE gender = 'F'").get().c,
          transgender: db.prepare("SELECT COUNT(*) as c FROM staff WHERE gender = 'Transgender'").get().c,
          sanctioned: db.prepare("SELECT COUNT(*) as c FROM staff WHERE is_sanctioned = 'Y'").get().c,
          sampleCount: db.prepare('SELECT COUNT(*) as c FROM staff WHERE is_sample = 1').get().c
        };

        const blockSummary = getSummaryByEntity(`
          SELECT b.id, b.name, b.ddo_code,
            (SELECT COUNT(*) FROM sankuls sn WHERE sn.block_id = b.id) AS sankul_count,
            (SELECT COUNT(*) FROM schools sc WHERE sc.block_id = b.id) AS school_count,
            COUNT(s.id) AS total_staff,
            SUM(CASE WHEN s.employment_type = 'Regular' THEN 1 ELSE 0 END) AS regular_count,
            SUM(CASE WHEN s.employment_type = 'Non Regular' THEN 1 ELSE 0 END) AS non_regular_count,
            SUM(CASE WHEN s.gender = 'M' THEN 1 ELSE 0 END) AS male_count,
            SUM(CASE WHEN s.gender = 'F' THEN 1 ELSE 0 END) AS female_count,
            SUM(CASE WHEN s.caste = 'SC' THEN 1 ELSE 0 END) AS sc_count,
            SUM(CASE WHEN s.caste = 'ST' THEN 1 ELSE 0 END) AS st_count,
            SUM(CASE WHEN s.caste = 'OBC' THEN 1 ELSE 0 END) AS obc_count,
            SUM(CASE WHEN s.caste = 'Gen.' THEN 1 ELSE 0 END) AS gen_count
          FROM blocks b
          LEFT JOIN staff s ON s.block_id = b.id
          GROUP BY b.id
          ORDER BY b.name
        `);

        const sankulSummary = getSummaryByEntity(`
          SELECT sn.id, sn.name, sn.ddo_code, sn.coordinator_name, b.id AS block_id, b.name AS block_name,
            (SELECT COUNT(*) FROM schools sc WHERE sc.sankul_id = sn.id) AS school_count,
            COUNT(s.id) AS total_staff,
            SUM(CASE WHEN s.employment_type = 'Regular' THEN 1 ELSE 0 END) AS regular_count,
            SUM(CASE WHEN s.employment_type = 'Non Regular' THEN 1 ELSE 0 END) AS non_regular_count,
            SUM(CASE WHEN s.gender = 'M' THEN 1 ELSE 0 END) AS male_count,
            SUM(CASE WHEN s.gender = 'F' THEN 1 ELSE 0 END) AS female_count,
            SUM(CASE WHEN s.caste = 'SC' THEN 1 ELSE 0 END) AS sc_count,
            SUM(CASE WHEN s.caste = 'ST' THEN 1 ELSE 0 END) AS st_count,
            SUM(CASE WHEN s.caste = 'OBC' THEN 1 ELSE 0 END) AS obc_count,
            SUM(CASE WHEN s.caste = 'Gen.' THEN 1 ELSE 0 END) AS gen_count
          FROM sankuls sn
          JOIN blocks b ON sn.block_id = b.id
          LEFT JOIN staff s ON s.sankul_id = sn.id
          GROUP BY sn.id
          ORDER BY b.name, sn.name
        `);

        const schoolSummary = getSummaryByEntity(`
          SELECT sc.id, sc.name, sc.udise_code, sc.school_type, sc.head_name,
            sn.id AS sankul_id, sn.name AS sankul_name,
            b.id AS block_id, b.name AS block_name,
            COUNT(s.id) AS total_staff,
            SUM(CASE WHEN s.employment_type = 'Regular' THEN 1 ELSE 0 END) AS regular_count,
            SUM(CASE WHEN s.employment_type = 'Non Regular' THEN 1 ELSE 0 END) AS non_regular_count,
            SUM(CASE WHEN s.gender = 'M' THEN 1 ELSE 0 END) AS male_count,
            SUM(CASE WHEN s.gender = 'F' THEN 1 ELSE 0 END) AS female_count,
            SUM(CASE WHEN s.caste = 'SC' THEN 1 ELSE 0 END) AS sc_count,
            SUM(CASE WHEN s.caste = 'ST' THEN 1 ELSE 0 END) AS st_count,
            SUM(CASE WHEN s.caste = 'OBC' THEN 1 ELSE 0 END) AS obc_count,
            SUM(CASE WHEN s.caste = 'Gen.' THEN 1 ELSE 0 END) AS gen_count
          FROM schools sc
          JOIN sankuls sn ON sc.sankul_id = sn.id
          JOIN blocks b ON sc.block_id = b.id
          LEFT JOIN staff s ON s.school_id = sc.id
          GROUP BY sc.id
          ORDER BY b.name, sn.name, sc.name
        `);

        return sendJson(res, 200, { counts, blockSummary, sankulSummary, schoolSummary });
      }

      // Blocks CRUD
      if (pathname === '/api/blocks' && method === 'GET') {
        const rows = db.prepare('SELECT * FROM blocks ORDER BY name').all();
        return sendJson(res, 200, rows);
      }
      if (pathname === '/api/blocks' && method === 'POST') {
        const b = await readBody(req);
        if (!b.name || !b.name.trim()) return sendJson(res, 400, { error: 'Block का नाम आवश्यक है' });
        const dup = db.prepare('SELECT id, name FROM blocks WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))').get(b.name);
        if (dup) return sendJson(res, 409, { error: `विकासखंड "${dup.name}" पहले से दर्ज है (Duplicate Block)` });
        const info = db.prepare(
          'INSERT INTO blocks (name, code, ddo_code, contact, email) VALUES (?, ?, ?, ?, ?)'
        ).run(b.name.trim(), b.code || '', b.ddo_code || '', b.contact || '', b.email || '');
        return sendJson(res, 201, { id: Number(info.lastInsertRowid) });
      }
      if (pathname.startsWith('/api/blocks/') && method === 'PUT') {
        const id = Number(pathname.split('/').pop());
        const b = await readBody(req);
        const dup = db.prepare('SELECT id, name FROM blocks WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) AND id != ?').get(b.name, id);
        if (dup) return sendJson(res, 409, { error: `विकासखंड "${dup.name}" पहले से दर्ज है (Duplicate Block)` });
        db.prepare('UPDATE blocks SET name=?, code=?, ddo_code=?, contact=?, email=? WHERE id=?')
          .run(b.name.trim(), b.code || '', b.ddo_code || '', b.contact || '', b.email || '', id);
        return sendJson(res, 200, { ok: true });
      }
      if (pathname.startsWith('/api/blocks/') && method === 'DELETE') {
        const id = Number(pathname.split('/').pop());
        db.prepare('DELETE FROM blocks WHERE id = ?').run(id);
        return sendJson(res, 200, { ok: true });
      }

      // Sankuls CRUD
      if (pathname === '/api/sankuls' && method === 'GET') {
        const blockId = urlObj.searchParams.get('block_id');
        let sql = `
          SELECT sn.*, b.name AS block_name
          FROM sankuls sn JOIN blocks b ON sn.block_id = b.id
        `;
        const params = [];
        if (blockId) { sql += ' WHERE sn.block_id = ?'; params.push(Number(blockId)); }
        sql += ' ORDER BY b.name, sn.name';
        return sendJson(res, 200, db.prepare(sql).all(...params));
      }
      if (pathname === '/api/sankuls' && method === 'POST') {
        const b = await readBody(req);
        if (!b.block_id || !b.name || !b.name.trim()) return sendJson(res, 400, { error: 'Block और Sankul का नाम आवश्यक है' });
        const dup = db.prepare('SELECT id, name FROM sankuls WHERE block_id = ? AND LOWER(TRIM(name)) = LOWER(TRIM(?))').get(Number(b.block_id), b.name);
        if (dup) return sendJson(res, 409, { error: `संकुल "${dup.name}" इस विकासखंड में पहले से दर्ज है (Duplicate Sankul)` });
        const info = db.prepare(
          'INSERT INTO sankuls (block_id, name, code, ddo_code, coordinator_name, contact, email) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(Number(b.block_id), b.name.trim(), b.code || '', b.ddo_code || '', b.coordinator_name || '', b.contact || '', b.email || '');
        return sendJson(res, 201, { id: Number(info.lastInsertRowid) });
      }
      if (pathname.startsWith('/api/sankuls/') && method === 'PUT') {
        const id = Number(pathname.split('/').pop());
        const b = await readBody(req);
        const dup = db.prepare('SELECT id, name FROM sankuls WHERE block_id = ? AND LOWER(TRIM(name)) = LOWER(TRIM(?)) AND id != ?').get(Number(b.block_id), b.name, id);
        if (dup) return sendJson(res, 409, { error: `संकुल "${dup.name}" इस विकासखंड में पहले से दर्ज है (Duplicate Sankul)` });
        db.prepare(
          'UPDATE sankuls SET block_id=?, name=?, code=?, ddo_code=?, coordinator_name=?, contact=?, email=? WHERE id=?'
        ).run(Number(b.block_id), b.name.trim(), b.code || '', b.ddo_code || '', b.coordinator_name || '', b.contact || '', b.email || '', id);
        return sendJson(res, 200, { ok: true });
      }
      if (pathname.startsWith('/api/sankuls/') && method === 'DELETE') {
        const id = Number(pathname.split('/').pop());
        db.prepare('DELETE FROM sankuls WHERE id = ?').run(id);
        return sendJson(res, 200, { ok: true });
      }

      // Schools CRUD
      if (pathname === '/api/schools' && method === 'GET') {
        const blockId = urlObj.searchParams.get('block_id');
        const sankulId = urlObj.searchParams.get('sankul_id');
        let sql = `
          SELECT sc.*, sn.name AS sankul_name, b.name AS block_name
          FROM schools sc
          JOIN sankuls sn ON sc.sankul_id = sn.id
          JOIN blocks b ON sc.block_id = b.id
          WHERE 1=1
        `;
        const params = [];
        if (blockId) { sql += ' AND sc.block_id = ?'; params.push(Number(blockId)); }
        if (sankulId) { sql += ' AND sc.sankul_id = ?'; params.push(Number(sankulId)); }
        sql += ' ORDER BY b.name, sn.name, sc.name';
        return sendJson(res, 200, db.prepare(sql).all(...params));
      }
      if (pathname === '/api/schools' && method === 'POST') {
        const b = await readBody(req);
        if (!b.block_id || !b.sankul_id || !b.name || !b.name.trim()) {
          return sendJson(res, 400, { error: 'Block, Sankul और School का नाम आवश्यक है' });
        }
        const dupName = db.prepare('SELECT id, name FROM schools WHERE sankul_id = ? AND LOWER(TRIM(name)) = LOWER(TRIM(?))').get(Number(b.sankul_id), b.name);
        if (dupName) return sendJson(res, 409, { error: `विद्यालय "${dupName.name}" इस संकुल में पहले से दर्ज है (Duplicate School)` });
        if (b.udise_code && String(b.udise_code).trim()) {
          const dupUdise = db.prepare('SELECT id, name, udise_code FROM schools WHERE LOWER(TRIM(udise_code)) = LOWER(TRIM(?))').get(String(b.udise_code));
          if (dupUdise) return sendJson(res, 409, { error: `UDISE कोड "${dupUdise.udise_code}" पहले से "${dupUdise.name}" में दर्ज है।` });
        }
        const info = db.prepare(
          'INSERT INTO schools (block_id, sankul_id, name, udise_code, school_type, ddo_code, head_name, contact, email) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(
          Number(b.block_id), Number(b.sankul_id), b.name.trim(),
          (b.udise_code || '').trim(), b.school_type || 'Primary', b.ddo_code || '',
          b.head_name || '', b.contact || '', b.email || ''
        );
        return sendJson(res, 201, { id: Number(info.lastInsertRowid) });
      }
      if (pathname.startsWith('/api/schools/') && method === 'PUT') {
        const id = Number(pathname.split('/').pop());
        const b = await readBody(req);
        const dupName = db.prepare('SELECT id, name FROM schools WHERE sankul_id = ? AND LOWER(TRIM(name)) = LOWER(TRIM(?)) AND id != ?').get(Number(b.sankul_id), b.name, id);
        if (dupName) return sendJson(res, 409, { error: `विद्यालय "${dupName.name}" इस संकुल में पहले से दर्ज है (Duplicate School)` });
        if (b.udise_code && String(b.udise_code).trim()) {
          const dupUdise = db.prepare('SELECT id, name, udise_code FROM schools WHERE LOWER(TRIM(udise_code)) = LOWER(TRIM(?)) AND id != ?').get(String(b.udise_code), id);
          if (dupUdise) return sendJson(res, 409, { error: `UDISE कोड "${dupUdise.udise_code}" पहले से "${dupUdise.name}" में दर्ज है।` });
        }
        db.prepare(
          'UPDATE schools SET block_id=?, sankul_id=?, name=?, udise_code=?, school_type=?, ddo_code=?, head_name=?, contact=?, email=? WHERE id=?'
        ).run(
          Number(b.block_id), Number(b.sankul_id), b.name.trim(),
          (b.udise_code || '').trim(), b.school_type || 'Primary', b.ddo_code || '',
          b.head_name || '', b.contact || '', b.email || '', id
        );
        return sendJson(res, 200, { ok: true });
      }
      if (pathname.startsWith('/api/schools/') && method === 'DELETE') {
        const id = Number(pathname.split('/').pop());
        db.prepare('DELETE FROM schools WHERE id = ?').run(id);
        return sendJson(res, 200, { ok: true });
      }

      // Staff CRUD
      if (pathname === '/api/staff' && method === 'GET') {
        const rows = getStaffFiltered({
          block_id: urlObj.searchParams.get('block_id'),
          sankul_id: urlObj.searchParams.get('sankul_id'),
          school_id: urlObj.searchParams.get('school_id'),
          emp_class: urlObj.searchParams.get('emp_class'),
          employment_type: urlObj.searchParams.get('employment_type'),
          gender: urlObj.searchParams.get('gender'),
          caste: urlObj.searchParams.get('caste'),
          search: urlObj.searchParams.get('search')
        });
        return sendJson(res, 200, rows);
      }

      if (pathname === '/api/staff' && method === 'POST') {
        const b = await readBody(req);
        const errs = validateStaffPayload(b);
        if (errs.length) return sendJson(res, 400, { error: errs.join(', ') });

        const dup = findDuplicateStaff({
          emp_code: b.emp_code,
          emp_name: b.emp_name,
          dob: b.dob,
          designation: b.designation,
          sankul_id: b.sankul_id,
          school_id: b.school_id
        });
        if (dup) return sendJson(res, 409, { error: dup.message });

        const regularStatus = b.employment_type === 'Regular' ? (b.regular_status || 'Permanent') : '';
        const nonRegularType = b.employment_type === 'Non Regular' ? (b.non_regular_type || 'Contractual') : '';

        const info = db.prepare(`
          INSERT INTO staff (
            block_id, sankul_id, school_id, emp_code, emp_name, gender, caste,
            dob, doj, designation, emp_class, pay_level, employment_type,
            regular_status, non_regular_type, is_sanctioned, remark, is_sample
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        `).run(
          Number(b.block_id), Number(b.sankul_id), Number(b.school_id),
          String(b.emp_code).trim(), String(b.emp_name).trim(), b.gender, b.caste,
          b.dob || '', b.doj || '', String(b.designation).trim(), b.emp_class,
          b.pay_level || '', b.employment_type, regularStatus, nonRegularType,
          b.is_sanctioned || 'Y', b.remark || ''
        );
        return sendJson(res, 201, { id: Number(info.lastInsertRowid) });
      }

      if (pathname === '/api/staff/bulk' && method === 'POST') {
        const body = await readBody(req);
        const rows = Array.isArray(body.rows) ? body.rows : [];
        if (!rows.length) return sendJson(res, 400, { error: 'No rows provided' });

        const stmt = db.prepare(`
          INSERT INTO staff (
            block_id, sankul_id, school_id, emp_code, emp_name, gender, caste,
            dob, doj, designation, emp_class, pay_level, employment_type,
            regular_status, non_regular_type, is_sanctioned, remark, is_sample
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        `);

        let inserted = 0;
        let duplicatesSkipped = 0;
        const skipped = [];
        db.exec('BEGIN');
        try {
          rows.forEach((b, idx) => {
            const errs = validateStaffPayload(b);
            if (errs.length) {
              skipped.push({ row: idx + 1, error: errs.join('; ') });
              return;
            }
            const dup = findDuplicateStaff({
              emp_code: b.emp_code,
              emp_name: b.emp_name,
              dob: b.dob,
              designation: b.designation,
              school_id: b.school_id
            });
            if (dup) {
              duplicatesSkipped++;
              skipped.push({ row: idx + 1, error: dup.message });
              return;
            }
            const regularStatus = b.employment_type === 'Regular' ? (b.regular_status || 'Permanent') : '';
            const nonRegularType = b.employment_type === 'Non Regular' ? (b.non_regular_type || 'Contractual') : '';
            stmt.run(
              Number(b.block_id), Number(b.sankul_id), Number(b.school_id),
              String(b.emp_code).trim(), String(b.emp_name).trim(), b.gender, b.caste,
              b.dob || '', b.doj || '', String(b.designation).trim(), b.emp_class,
              b.pay_level || '', b.employment_type, regularStatus, nonRegularType,
              b.is_sanctioned || 'Y', b.remark || ''
            );
            inserted++;
          });
          db.exec('COMMIT');
        } catch (err) {
          db.exec('ROLLBACK');
          throw err;
        }
        return sendJson(res, 200, { inserted, duplicatesSkipped, skipped });
      }

      if (pathname === '/api/staff/upload-excel' && method === 'POST') {
        const body = await readBody(req);
        if (!body.fileBase64) return sendJson(res, 400, { error: 'कोई फ़ाइल प्राप्त नहीं हुई' });
        const buffer = Buffer.from(body.fileBase64, 'base64');
        const result = await importExcelForLevel({
          buffer,
          filename: body.filename || 'upload.xlsx',
          level: body.level === 'sankul' ? 'sankul' : 'school',
          block_id: body.block_id,
          sankul_id: body.sankul_id,
          school_id: body.school_id
        });
        return sendJson(res, 200, result);
      }

      if (pathname === '/api/staff/clear-samples' && method === 'POST') {
        const info = db.prepare('DELETE FROM staff WHERE is_sample = 1').run();
        return sendJson(res, 200, { deleted: info.changes });
      }

      if (pathname.startsWith('/api/staff/') && method === 'PUT') {
        const id = Number(pathname.split('/').pop());
        const b = await readBody(req);
        const errs = validateStaffPayload(b);
        if (errs.length) return sendJson(res, 400, { error: errs.join(', ') });

        const dup = findDuplicateStaff({
          emp_code: b.emp_code,
          emp_name: b.emp_name,
          dob: b.dob,
          designation: b.designation,
          sankul_id: b.sankul_id,
          school_id: b.school_id,
          excludeId: id
        });
        if (dup) return sendJson(res, 409, { error: dup.message });

        const regularStatus = b.employment_type === 'Regular' ? (b.regular_status || 'Permanent') : '';
        const nonRegularType = b.employment_type === 'Non Regular' ? (b.non_regular_type || 'Contractual') : '';

        db.prepare(`
          UPDATE staff SET
            block_id=?, sankul_id=?, school_id=?, emp_code=?, emp_name=?, gender=?, caste=?,
            dob=?, doj=?, designation=?, emp_class=?, pay_level=?, employment_type=?,
            regular_status=?, non_regular_type=?, is_sanctioned=?, remark=?, is_sample=0,
            updated_at=CURRENT_TIMESTAMP
          WHERE id=?
        `).run(
          Number(b.block_id), Number(b.sankul_id), Number(b.school_id),
          String(b.emp_code).trim(), String(b.emp_name).trim(), b.gender, b.caste,
          b.dob || '', b.doj || '', String(b.designation).trim(), b.emp_class,
          b.pay_level || '', b.employment_type, regularStatus, nonRegularType,
          b.is_sanctioned || 'Y', b.remark || '', id
        );
        return sendJson(res, 200, { ok: true });
      }

      if (pathname.startsWith('/api/staff/') && method === 'DELETE') {
        const id = Number(pathname.split('/').pop());
        db.prepare('DELETE FROM staff WHERE id = ?').run(id);
        return sendJson(res, 200, { ok: true });
      }

      // CGE Form 1 & Form 2 Report Data
      if (pathname === '/api/reports/cge' && method === 'GET') {
        const report = resolveCgeReport(urlObj.searchParams);
        return sendJson(res, 200, report);
      }

      // PDF Export (.pdf)
      if (pathname === '/api/export/pdf' && method === 'GET') {
        const report = resolveCgeReport(urlObj.searchParams);
        const mode = urlObj.searchParams.get('mode') || 'both';
        const pdfBuf = await generateCgePdfBuffer({ ...report, mode });
        const safeScope = (report.meta.scope || 'district').replace(/[^a-z0-9_-]/gi, '');
        const filename = `CGE_Form1_Form2_${safeScope}_${new Date().toISOString().slice(0, 10)}.pdf`;
        res.writeHead(200, {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Length': pdfBuf.length
        });
        return res.end(pdfBuf);
      }

      // Upload Template (.xlsx) for School or Sankul level
      if (pathname === '/api/export/template' && method === 'GET') {
        const level = urlObj.searchParams.get('level') === 'sankul' ? 'sankul' : 'school';
        const buf = generateUploadTemplateWorkbook(level);
        const filename = level === 'sankul'
          ? 'CGE_Sankul_Upload_Template.xlsx'
          : 'CGE_School_Upload_Template.xlsx';
        res.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Length': buf.length
        });
        return res.end(buf);
      }

      // Excel Export (.xlsx)
      if (pathname === '/api/export/xlsx' && method === 'GET') {
        const report = resolveCgeReport(urlObj.searchParams);
        const buf = generateCgeWorkbook(report);
        const safeScope = (report.meta.scope || 'district').replace(/[^a-z0-9_-]/gi, '');
        const filename = `CGE_Form1_Form2_${safeScope}_${new Date().toISOString().slice(0, 10)}.xlsx`;
        res.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Length': buf.length
        });
        return res.end(buf);
      }

      // CSV Export (.csv)
      if (pathname === '/api/export/csv' && method === 'GET') {
        const report = resolveCgeReport(urlObj.searchParams);
        const form = urlObj.searchParams.get('form') || 'form1';
        const csv = form === 'form2' ? buildForm2Csv(report.form2, report.meta) : buildForm1Csv(report.staff, report.meta);
        const filename = `CGE_${form}_${report.meta.scope}_${new Date().toISOString().slice(0, 10)}.csv`;
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`
        });
        return res.end(csv);
      }

      // Full JSON Backup
      if (pathname === '/api/backup' && method === 'GET') {
        const data = {
          exported_at: new Date().toISOString(),
          settings: getSettings(),
          blocks: db.prepare('SELECT * FROM blocks').all(),
          sankuls: db.prepare('SELECT * FROM sankuls').all(),
          schools: db.prepare('SELECT * FROM schools').all(),
          staff: db.prepare('SELECT * FROM staff').all()
        };
        const json = JSON.stringify(data, null, 2);
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="CGE_Backup_${new Date().toISOString().slice(0, 10)}.json"`
        });
        return res.end(json);
      }

      // Restore JSON Backup
      if (pathname === '/api/restore' && method === 'POST') {
        const data = await readBody(req);
        if (!Array.isArray(data.blocks) || !Array.isArray(data.sankuls) || !Array.isArray(data.schools) || !Array.isArray(data.staff)) {
          return sendJson(res, 400, { error: 'अमान्य बैकअप फ़ाइल (Invalid backup format)' });
        }
        db.exec('PRAGMA foreign_keys = OFF; BEGIN;');
        try {
          db.exec('DELETE FROM staff; DELETE FROM schools; DELETE FROM sankuls; DELETE FROM blocks;');
          if (data.settings) {
            const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
            for (const [k, v] of Object.entries(data.settings)) upsert.run(k, String(v ?? ''));
          }
          const insB = db.prepare('INSERT INTO blocks (id, name, code, ddo_code, contact, email) VALUES (?, ?, ?, ?, ?, ?)');
          for (const b of data.blocks) insB.run(b.id, b.name, b.code || '', b.ddo_code || '', b.contact || '', b.email || '');

          const insSn = db.prepare('INSERT INTO sankuls (id, block_id, name, code, ddo_code, coordinator_name, contact, email) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
          for (const s of data.sankuls) insSn.run(s.id, s.block_id, s.name, s.code || '', s.ddo_code || '', s.coordinator_name || '', s.contact || '', s.email || '');

          const insSc = db.prepare('INSERT INTO schools (id, block_id, sankul_id, name, udise_code, school_type, ddo_code, head_name, contact, email) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
          for (const sc of data.schools) insSc.run(sc.id, sc.block_id, sc.sankul_id, sc.name, sc.udise_code || '', sc.school_type || 'Primary', sc.ddo_code || '', sc.head_name || '', sc.contact || '', sc.email || '');

          const insSt = db.prepare(`
            INSERT INTO staff (
              id, block_id, sankul_id, school_id, emp_code, emp_name, gender, caste,
              dob, doj, designation, emp_class, pay_level, employment_type,
              regular_status, non_regular_type, is_sanctioned, remark, is_sample
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
          for (const e of data.staff) {
            insSt.run(
              e.id, e.block_id, e.sankul_id, e.school_id, e.emp_code, e.emp_name, e.gender, e.caste,
              e.dob || '', e.doj || '', e.designation, e.emp_class, e.pay_level || '', e.employment_type,
              e.regular_status || '', e.non_regular_type || '', e.is_sanctioned || 'Y', e.remark || '', e.is_sample || 0
            );
          }
          db.exec('COMMIT; PRAGMA foreign_keys = ON;');
        } catch (err) {
          db.exec('ROLLBACK; PRAGMA foreign_keys = ON;');
          throw err;
        }
        return sendJson(res, 200, { ok: true, restored: data.staff.length });
      }

      return sendJson(res, 404, { error: 'API route not found' });
    }

    // --- STATIC FILES ---
    let filePath = pathname === '/' ? '/index.html' : pathname;
    filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, '');
    const fullPath = path.join(PUBLIC_DIR, filePath);

    if (!fullPath.startsWith(PUBLIC_DIR) || !fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not Found');
    }

    const ext = path.extname(fullPath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    fs.createReadStream(fullPath).pipe(res);
  } catch (err) {
    console.error('Server error:', err);
    if (!res.headersSent) {
      sendJson(res, 500, { error: err.message || 'Internal Server Error' });
    }
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`CGE Staff Census Software running at http://localhost:${PORT}`);
});
