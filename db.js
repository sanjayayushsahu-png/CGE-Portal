const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'cge_staff.db');
const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      code TEXT DEFAULT '',
      ddo_code TEXT DEFAULT '',
      contact TEXT DEFAULT '',
      email TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sankuls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      block_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      code TEXT DEFAULT '',
      ddo_code TEXT DEFAULT '',
      coordinator_name TEXT DEFAULT '',
      contact TEXT DEFAULT '',
      email TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (block_id) REFERENCES blocks(id) ON DELETE CASCADE,
      UNIQUE(block_id, name)
    );

    CREATE TABLE IF NOT EXISTS schools (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      block_id INTEGER NOT NULL,
      sankul_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      udise_code TEXT DEFAULT '',
      school_type TEXT DEFAULT 'Primary',
      ddo_code TEXT DEFAULT '',
      head_name TEXT DEFAULT '',
      contact TEXT DEFAULT '',
      email TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (block_id) REFERENCES blocks(id) ON DELETE CASCADE,
      FOREIGN KEY (sankul_id) REFERENCES sankuls(id) ON DELETE CASCADE,
      UNIQUE(sankul_id, name)
    );

    CREATE TABLE IF NOT EXISTS staff (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      block_id INTEGER NOT NULL,
      sankul_id INTEGER NOT NULL,
      school_id INTEGER NOT NULL,
      emp_code TEXT NOT NULL,
      emp_name TEXT NOT NULL,
      gender TEXT NOT NULL CHECK(gender IN ('M', 'F', 'Transgender')),
      caste TEXT NOT NULL CHECK(caste IN ('SC', 'ST', 'OBC', 'Gen.')),
      dob TEXT DEFAULT '',
      doj TEXT DEFAULT '',
      designation TEXT NOT NULL,
      emp_class TEXT NOT NULL CHECK(emp_class IN ('I', 'II', 'III (Executive)', 'III (Ministerial)', 'IV')),
      pay_level TEXT DEFAULT '',
      employment_type TEXT NOT NULL CHECK(employment_type IN ('Regular', 'Non Regular')),
      regular_status TEXT DEFAULT '',
      non_regular_type TEXT DEFAULT '',
      is_sanctioned TEXT NOT NULL DEFAULT 'Y' CHECK(is_sanctioned IN ('Y', 'N')),
      remark TEXT DEFAULT '',
      is_sample INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (block_id) REFERENCES blocks(id) ON DELETE CASCADE,
      FOREIGN KEY (sankul_id) REFERENCES sankuls(id) ON DELETE CASCADE,
      FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_staff_block ON staff(block_id);
    CREATE INDEX IF NOT EXISTS idx_staff_sankul ON staff(sankul_id);
    CREATE INDEX IF NOT EXISTS idx_staff_school ON staff(school_id);
    CREATE INDEX IF NOT EXISTS idx_staff_code ON staff(emp_code);
  `);

  // Enforce case-insensitive unique Employee Code at DB level (ignoring placeholder values like NA/-)
  try {
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_emp_code_unique
      ON staff(LOWER(TRIM(emp_code)))
      WHERE TRIM(emp_code) != ''
        AND LOWER(TRIM(emp_code)) NOT IN ('na', 'n/a', '-', 'nil', '0', 'none');
    `);
  } catch (err) {
    console.warn('Could not create unique emp_code index (existing duplicates present):', err.message);
  }

  seedDefaults();
}

function seedDefaults() {
  const defaultSettings = {
    district_name: 'बेमेतरा (Bemetara)',
    census_date: '31 मार्च, 2024',
    department_name: 'स्कूल शिक्षा विभाग',
    default_email: 'deo-bemetara.cg@gov.in',
    default_contact: ''
  };

  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(defaultSettings)) {
    insertSetting.run(k, v);
  }

  const blockCount = db.prepare('SELECT COUNT(*) as cnt FROM blocks').get().cnt;
  if (blockCount === 0) {
    const insertBlock = db.prepare(
      'INSERT INTO blocks (name, code, ddo_code, contact, email) VALUES (?, ?, ?, ?, ?)'
    );
    const b1 = insertBlock.run('बेमेतरा (Bemetara)', 'BLK-01', '2201001', '', 'beo.bemetara@cg.gov.in').lastInsertRowid;
    const b2 = insertBlock.run('बेरला (Berla)', 'BLK-02', '2201002', '', 'beo.berla@cg.gov.in').lastInsertRowid;
    insertBlock.run('नवागढ़ (Nawagarh)', 'BLK-03', '2201003', '', 'beo.nawagarh@cg.gov.in');
    insertBlock.run('साजा (Saja)', 'BLK-04', '2201004', '', 'beo.saja@cg.gov.in');

    const insertSankul = db.prepare(
      'INSERT INTO sankuls (block_id, name, code, ddo_code, coordinator_name, contact, email) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    const s1 = insertSankul.run(b1, 'शासकीय उच्चतर माध्यमिक विद्यालय बेमेतरा (संकुल)', 'SNK-101', '2201101', 'श्री आर. के. वर्मा', '9826000001', 'sankul.bemetara@cg.gov.in').lastInsertRowid;
    const s2 = insertSankul.run(b2, 'शासकीय उच्चतर माध्यमिक विद्यालय बेरला (संकुल)', 'SNK-201', '2201201', 'श्री एस. एल. साहू', '9826000002', 'sankul.berla@cg.gov.in').lastInsertRowid;

    const insertSchool = db.prepare(
      'INSERT INTO schools (block_id, sankul_id, name, udise_code, school_type, ddo_code, head_name) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    const sch1 = insertSchool.run(b1, s1, 'शासकीय उच्चतर माध्यमिक विद्यालय बेमेतरा', '22230100101', 'Higher Secondary', '2201101', 'श्री ए. के. शर्मा').lastInsertRowid;
    const sch2 = insertSchool.run(b1, s1, 'शासकीय प्राथमिक शाला बालक बेमेतरा', '22230100102', 'Primary', '2201101', 'श्रीमती गीता साहू').lastInsertRowid;
    const sch3 = insertSchool.run(b2, s2, 'शासकीय पूर्व माध्यमिक शाला बेरला', '22230200101', 'Middle', '2201201', 'श्री पी. के. देवांगन').lastInsertRowid;

    const insertStaff = db.prepare(`
      INSERT INTO staff (
        block_id, sankul_id, school_id, emp_code, emp_name, gender, caste,
        dob, doj, designation, emp_class, pay_level, employment_type,
        regular_status, non_regular_type, is_sanctioned, remark, is_sample
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);

    const sampleStaff = [
      [b1, s1, sch1, 'CG220001', 'Ashok Kumar Sharma', 'M', 'Gen.', '1975-06-15', '2001-07-10', 'Principal', 'I', 'Level-12', 'Regular', 'Permanent', '', 'Y', 'Sample Entry'],
      [b1, s1, sch1, 'CG220002', 'Sunita Verma', 'F', 'OBC', '1982-03-20', '2008-08-01', 'Lecturer (LB)', 'II', 'Level-9', 'Regular', 'Permanent', '', 'Y', 'Sample Entry'],
      [b1, s1, sch1, 'CG220003', 'Rajesh Kumar Satnami', 'M', 'SC', '1986-11-12', '2012-09-15', 'Assistant Grade-III', 'III (Ministerial)', 'Level-4', 'Regular', 'Permanent', '', 'Y', 'Sample Entry'],
      [b1, s1, sch1, 'CG220004', 'Kamlesh Markam', 'M', 'ST', '1990-04-05', '2018-07-01', 'Peon', 'IV', 'Level-1', 'Regular', 'Permanent', '', 'Y', 'Sample Entry'],
      [b1, s1, sch2, 'CG220005', 'Geeta Sahu', 'F', 'OBC', '1980-08-25', '2005-07-05', 'Headmaster (Primary)', 'III (Executive)', 'Level-8', 'Regular', 'Permanent', '', 'Y', 'Sample Entry'],
      [b1, s1, sch2, 'CG220006', 'Ramesh Yadav', 'M', 'OBC', '1992-01-18', '2021-07-12', 'Part Time Sweeper', 'IV', 'Collector Rate', 'Non Regular', '', 'Part time', 'N', 'Sample Entry'],
      [b2, s2, sch3, 'CG220007', 'Prakash Kumar Dewangan', 'M', 'OBC', '1979-12-02', '2006-08-14', 'Teacher (LB)', 'III (Executive)', 'Level-8', 'Regular', 'Permanent', '', 'Y', 'Sample Entry'],
      [b2, s2, sch3, 'CG220008', 'Meena Dhruv', 'F', 'ST', '1994-05-10', '2022-08-01', 'Atithi Shikshak', 'III (Executive)', 'Fixed', 'Non Regular', '', 'Contractual', 'N', 'Sample Entry']
    ];

    for (const row of sampleStaff) {
      insertStaff.run(...row);
    }
  }
}

const FORM2_CATEGORIES = [
  { key: 'CLASS_I', label: 'प्रथम श्रेणी', eng: 'Class I' },
  { key: 'CLASS_II', label: 'द्वितीय श्रेणी', eng: 'Class II' },
  { key: 'CLASS_III_MIN', label: 'तृतीय श्रेणी (अनुसचिवीय)', eng: 'Class III (Ministerial)' },
  { key: 'CLASS_III_EXEC', label: 'तृतीय श्रेणी (कार्यपालिक)', eng: 'Class III (Executive)' },
  { key: 'CLASS_IV', label: 'चतुर्थ श्रेणी', eng: 'Class IV' },
  { key: 'WORK_CHARGED', label: 'कार्यभारित', eng: 'Work Charged' },
  { key: 'CONTINGENCY', label: 'आकस्मिक निधि', eng: 'Contingency' },
  { key: 'DAILY_WAGES', label: 'दैनिक वेतन भोगी', eng: 'Daily Wages / Collector Rate' },
  { key: 'CONTRACTUAL', label: 'संविदा', eng: 'Contractual' },
  { key: 'PLACEMENT', label: 'प्लेसमेंट', eng: 'Placement' },
  { key: 'HONORARY', label: 'मानसेवी', eng: 'Honorary' },
  { key: 'PART_TIME', label: 'अंशकालीन', eng: 'Part time' }
];

function classifyForForm2(emp) {
  const desig = String(emp.designation || '').trim();
  if (/\bcook\b|रसोईया|रसोइया|मानसेवी/i.test(desig)) {
    return 'HONORARY';
  }
  if (/part[\s-]*time|paert[\s-]*time|अंशकालीन/i.test(desig)) {
    return 'PART_TIME';
  }

  if (emp.employment_type === 'Regular') {
    switch (emp.emp_class) {
      case 'I': return 'CLASS_I';
      case 'II': return 'CLASS_II';
      case 'III (Ministerial)': return 'CLASS_III_MIN';
      case 'III (Executive)': return 'CLASS_III_EXEC';
      case 'IV': return 'CLASS_IV';
      default: return 'CLASS_III_EXEC';
    }
  }
  switch (emp.non_regular_type) {
    case 'Work Charged': return 'WORK_CHARGED';
    case 'Contingency': return 'CONTINGENCY';
    case 'Daily Wages':
    case 'Collector Rate': return 'DAILY_WAGES';
    case 'Contractual': return 'CONTRACTUAL';
    case 'Placement': return 'PLACEMENT';
    case 'Honorary': return 'HONORARY';
    case 'Part time': return 'PART_TIME';
    default: return 'CONTRACTUAL';
  }
}

function emptyRow(key, label, eng) {
  return {
    key, label, eng,
    m_sc: 0, m_st: 0, m_obc: 0, m_gen: 0, m_total: 0,
    f_sc: 0, f_st: 0, f_obc: 0, f_gen: 0, f_total: 0,
    t_sc: 0, t_st: 0, t_obc: 0, t_gen: 0, t_total: 0,
    transgender: 0,
    grand_total: 0
  };
}

function computeForm2(staffRows) {
  const rowMap = new Map();
  for (const cat of FORM2_CATEGORIES) {
    rowMap.set(cat.key, emptyRow(cat.key, cat.label, cat.eng));
  }
  const totals = emptyRow('TOTAL', 'योग', 'Total');

  for (const emp of staffRows) {
    const catKey = classifyForForm2(emp);
    const row = rowMap.get(catKey);
    if (!row) continue;

    const casteKey =
      emp.caste === 'SC' ? 'sc' :
      emp.caste === 'ST' ? 'st' :
      emp.caste === 'OBC' ? 'obc' : 'gen';

    if (emp.gender === 'M') {
      row[`m_${casteKey}`]++;
      row.m_total++;
      row[`t_${casteKey}`]++;
      row.t_total++;
      totals[`m_${casteKey}`]++;
      totals.m_total++;
      totals[`t_${casteKey}`]++;
      totals.t_total++;
    } else if (emp.gender === 'F') {
      row[`f_${casteKey}`]++;
      row.f_total++;
      row[`t_${casteKey}`]++;
      row.t_total++;
      totals[`f_${casteKey}`]++;
      totals.f_total++;
      totals[`t_${casteKey}`]++;
      totals.t_total++;
    } else {
      row.transgender++;
      totals.transgender++;
    }

    row.grand_total++;
    totals.grand_total++;
  }

  return {
    rows: Array.from(rowMap.values()),
    totals
  };
}

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const obj = {};
  for (const r of rows) obj[r.key] = r.value;
  return obj;
}

function getStaffFiltered({ block_id, sankul_id, school_id, emp_class, employment_type, gender, caste, search } = {}) {
  let sql = `
    SELECT s.*,
           b.name AS block_name, b.ddo_code AS block_ddo,
           sn.name AS sankul_name, sn.ddo_code AS sankul_ddo, sn.coordinator_name,
           sc.name AS school_name, sc.udise_code, sc.school_type, sc.ddo_code AS school_ddo
    FROM staff s
    JOIN blocks b ON s.block_id = b.id
    JOIN sankuls sn ON s.sankul_id = sn.id
    JOIN schools sc ON s.school_id = sc.id
    WHERE 1=1
  `;
  const params = [];

  if (block_id) { sql += ' AND s.block_id = ?'; params.push(Number(block_id)); }
  if (sankul_id) { sql += ' AND s.sankul_id = ?'; params.push(Number(sankul_id)); }
  if (school_id) { sql += ' AND s.school_id = ?'; params.push(Number(school_id)); }
  if (emp_class) { sql += ' AND s.emp_class = ?'; params.push(emp_class); }
  if (employment_type) { sql += ' AND s.employment_type = ?'; params.push(employment_type); }
  if (gender) { sql += ' AND s.gender = ?'; params.push(gender); }
  if (caste) { sql += ' AND s.caste = ?'; params.push(caste); }
  if (search && search.trim()) {
    const q = `%${search.trim()}%`;
    sql += ' AND (s.emp_name LIKE ? OR s.emp_code LIKE ? OR s.designation LIKE ? OR sc.name LIKE ? OR sn.name LIKE ?)';
    params.push(q, q, q, q, q);
  }

  sql += ' ORDER BY b.name, sn.name, sc.name, s.id ASC';
  return db.prepare(sql).all(...params);
}

function normText(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function normCode(s) {
  return String(s || '').replace(/\s+/g, '').trim().toLowerCase();
}

function isPlaceholderCode(code) {
  const s = normCode(code);
  return !s || ['na', 'n/a', '-', 'nil', '0', 'none'].includes(s);
}

function findDuplicateStaff({ emp_code, emp_name, dob, designation, sankul_id, school_id, excludeId = null }) {
  const code = normCode(emp_code);
  const name = normText(emp_name);
  const dobClean = String(dob || '').trim();
  const desigClean = normText(designation);
  const schId = Number(school_id || 0);
  const snkId = Number(sankul_id || 0);

  // 1. Check duplicate Employee Code (ignoring spaces & case) across entire database
  if (!isPlaceholderCode(code)) {
    let sql = `
      SELECT s.id, s.emp_code, s.emp_name, sc.name AS school_name
      FROM staff s
      JOIN schools sc ON s.school_id = sc.id
      WHERE LOWER(REPLACE(TRIM(s.emp_code), ' ', '')) = ?
    `;
    const params = [code];
    if (excludeId) { sql += ' AND s.id != ?'; params.push(Number(excludeId)); }
    const hit = db.prepare(sql).get(...params);
    if (hit) {
      return {
        type: 'emp_code',
        existing: hit,
        message: `डुप्लिकेट प्रविष्टि! Employee Code "${hit.emp_code}" पहले से "${hit.emp_name}" (${hit.school_name}) में दर्ज है।`
      };
    }
  }

  // 2. Check same normalized Employee Name + DOB in same Sankul (or same School)
  if (name && (snkId || schId)) {
    let sql = `
      SELECT s.id, s.emp_code, s.emp_name, s.dob, s.designation, s.school_id, sc.name AS school_name
      FROM staff s
      JOIN schools sc ON s.school_id = sc.id
      WHERE ${snkId ? 's.sankul_id = ?' : 's.school_id = ?'}
    `;
    const params = [snkId || schId];
    if (excludeId) { sql += ' AND s.id != ?'; params.push(Number(excludeId)); }
    const candidates = db.prepare(sql).all(...params);

    for (const row of candidates) {
      if (normText(row.emp_name) !== name) continue;
      if (dobClean && String(row.dob || '').trim() === dobClean) {
        return {
          type: 'name_dob',
          existing: row,
          message: `डुप्लिकेट प्रविष्टि! "${row.emp_name}" (जन्मतिथि: ${dobClean}) पहले से "${row.school_name}" में दर्ज है (Code: ${row.emp_code})।`
        };
      }
      if (!dobClean && schId && row.school_id === schId && desigClean && normText(row.designation) === desigClean) {
        return {
          type: 'name_desig_school',
          existing: row,
          message: `डुप्लिकेट प्रविष्टि! "${row.emp_name}" (${row.designation}) पहले से "${row.school_name}" में दर्ज है (Code: ${row.emp_code})।`
        };
      }
    }
  }

  return null;
}

initSchema();

module.exports = {
  db,
  DB_PATH,
  FORM2_CATEGORIES,
  computeForm2,
  getSettings,
  getStaffFiltered,
  isPlaceholderCode,
  findDuplicateStaff
};
