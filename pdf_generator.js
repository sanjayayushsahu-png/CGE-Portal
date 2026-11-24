const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { pathToFileURL } = require('node:url');

function findBrowserExecutable() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(iso) {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : iso;
}

function buildCgePrintHtml({ staff, form2, meta, mode = 'both' }) {
  const contactLine = [meta.contact, meta.email].filter(Boolean).join(' / ') || '__________';

  const form1Html = `
    <div class="sheet">
      <div class="header">
        <div class="form-tag">प्रपत्र-01</div>
        <div class="form-title">प्रशासनिक क्षेत्र में नियोजन गणना ${esc(meta.censusDate)}</div>
        <div class="form-subtitle">${esc(meta.censusDate)} की स्थिति में इस ${esc(meta.scopeLabel)} में कार्यरत अधिकारियों एवं कर्मचारियों की जानकारी</div>
      </div>
      <div class="meta-row">
        <span>जिला: ${esc(meta.district)}</span>
        <span>${esc(meta.scopeLabel)} का नाम: ${esc(meta.entityName)}</span>
        <span>डी.डी.ओ. कोड: ${esc(meta.ddoCode || '__________')}</span>
      </div>
      <div class="meta-row meta-sub">
        <span>विभाग का नाम: ${esc(meta.department)}</span>
        <span>सम्पर्क नम्बर / ई-मेल आई.डी.: ${esc(contactLine)}</span>
      </div>
      <table>
        <thead>
          <tr>
            <th style="width:3%">S.NO.</th>
            <th style="width:7%">Employee Code</th>
            <th style="width:11%">Employee Name</th>
            <th style="width:5%">Gender<br>M/F/TG</th>
            <th style="width:5%">Caste<br>SC/ST/OBC/Gen</th>
            <th style="width:6%">Date of Birth</th>
            <th style="width:6%">Date of First Joining</th>
            <th style="width:10%">Designation</th>
            <th style="width:8%">Class<br>I/II/III(Exec/Min)/IV</th>
            <th style="width:7%">Level in Pay Matrix / Grade Pay</th>
            <th style="width:6%">Type of Employment</th>
            <th style="width:6%">If Regular<br>Perm / Temp</th>
            <th style="width:10%">If Non Regular Specify</th>
            <th style="width:4%">Post Sanc.<br>Y/N</th>
            <th style="width:6%">Remark</th>
          </tr>
          <tr>
            ${Array.from({ length: 15 }, (_, i) => `<th>(${i + 1})</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${staff.length ? staff.map((e, idx) => `
            <tr>
              <td class="c">${idx + 1}</td>
              <td class="c">${esc(e.emp_code)}</td>
              <td>${esc(e.emp_name)}</td>
              <td class="c">${esc(e.gender)}</td>
              <td class="c">${esc(e.caste)}</td>
              <td class="c">${fmtDate(e.dob)}</td>
              <td class="c">${fmtDate(e.doj)}</td>
              <td>${esc(e.designation)}</td>
              <td class="c">${esc(e.emp_class)}</td>
              <td class="c">${esc(e.pay_level)}</td>
              <td class="c">${esc(e.employment_type)}</td>
              <td class="c">${e.employment_type === 'Regular' ? esc(e.regular_status) : ''}</td>
              <td>${e.employment_type === 'Non Regular' ? esc(e.non_regular_type) : ''}</td>
              <td class="c">${esc(e.is_sanctioned)}</td>
              <td>${esc(e.remark)}</td>
            </tr>
          `).join('') : `<tr><td colspan="15" class="c" style="padding:14px;">कोई कर्मचारी प्रविष्टि नहीं है।</td></tr>`}
        </tbody>
      </table>
      <div class="footer">
        <div class="note">Note: Please read instructions carefully before editing in the database.</div>
        <div class="sig">${esc(meta.signatureLabel)}</div>
      </div>
    </div>
  `;

  const t = form2.totals;
  const form2Html = `
    <div class="sheet">
      <div class="header">
        <div class="form-tag">प्रपत्र-02 (प्रपत्र-01 का गोश्वारा)</div>
        <div class="form-title">प्रशासनिक क्षेत्र में नियोजन गणना की जानकारी</div>
        <div class="form-subtitle">${esc(meta.censusDate)} की स्थिति में इस ${esc(meta.scopeLabel)} में कार्यरत अधिकारियों एवं कर्मचारियों की संख्या</div>
      </div>
      <div class="meta-row">
        <span>जिला: ${esc(meta.district)}</span>
        <span>${esc(meta.scopeLabel)} का नाम: ${esc(meta.entityName)}</span>
        <span>डी.डी.ओ. कोड: ${esc(meta.ddoCode || '__________')}</span>
      </div>
      <div class="meta-row meta-sub">
        <span>विभाग का नाम: ${esc(meta.department)}</span>
        <span>सम्पर्क नम्बर एवं ई-मेल आई.डी.: ${esc(contactLine)}</span>
      </div>
      <table class="f2">
        <thead>
          <tr>
            <th rowspan="2" style="width:18%">वर्ग / श्रेणी</th>
            <th colspan="5">पुरुष (Male)</th>
            <th colspan="5">महिला (Female)</th>
            <th colspan="5">योग (Male + Female)</th>
            <th rowspan="2" style="width:7%">Transgender</th>
            <th rowspan="2" style="width:6%">Total</th>
          </tr>
          <tr>
            <th>SC</th><th>ST</th><th>OBC</th><th>GEN</th><th>Total</th>
            <th>SC</th><th>ST</th><th>OBC</th><th>GEN</th><th>Total</th>
            <th>SC</th><th>ST</th><th>OBC</th><th>GEN</th><th>Total</th>
          </tr>
        </thead>
        <tbody>
          ${form2.rows.map((r) => `
            <tr>
              <td><strong>${esc(r.label)}</strong></td>
              <td class="c">${r.m_sc}</td><td class="c">${r.m_st}</td><td class="c">${r.m_obc}</td><td class="c">${r.m_gen}</td><td class="c b">${r.m_total}</td>
              <td class="c">${r.f_sc}</td><td class="c">${r.f_st}</td><td class="c">${r.f_obc}</td><td class="c">${r.f_gen}</td><td class="c b">${r.f_total}</td>
              <td class="c">${r.t_sc}</td><td class="c">${r.t_st}</td><td class="c">${r.t_obc}</td><td class="c">${r.t_gen}</td><td class="c b">${r.t_total}</td>
              <td class="c">${r.transgender}</td>
              <td class="c b">${r.grand_total}</td>
            </tr>
          `).join('')}
          <tr class="total-row">
            <td>${esc(t.label)}</td>
            <td class="c">${t.m_sc}</td><td class="c">${t.m_st}</td><td class="c">${t.m_obc}</td><td class="c">${t.m_gen}</td><td class="c">${t.m_total}</td>
            <td class="c">${t.f_sc}</td><td class="c">${t.f_st}</td><td class="c">${t.f_obc}</td><td class="c">${t.f_gen}</td><td class="c">${t.f_total}</td>
            <td class="c">${t.t_sc}</td><td class="c">${t.t_st}</td><td class="c">${t.t_obc}</td><td class="c">${t.t_gen}</td><td class="c">${t.t_total}</td>
            <td class="c">${t.transgender}</td>
            <td class="c">${t.grand_total}</td>
          </tr>
        </tbody>
      </table>
      <div class="footer">
        <div class="note"><strong>टीप:-</strong> कृपया प्रपत्र 01 के आधार पर भरा जावे।</div>
        <div class="sig">${esc(meta.signatureLabel)}</div>
      </div>
    </div>
  `;

  const bodyContent =
    mode === 'form1' ? form1Html :
    mode === 'form2' ? form2Html :
    `${form1Html}<div class="page-break"></div>${form2Html}`;

  return `<!DOCTYPE html>
<html lang="hi">
<head>
<meta charset="UTF-8" />
<style>
  @page { size: A4 landscape; margin: 9mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: 'Nirmala UI', 'Segoe UI', 'Noto Sans Devanagari', sans-serif;
    color: #000;
    font-size: 10px;
    line-height: 1.35;
  }
  .header { text-align: center; margin-bottom: 8px; }
  .form-tag { font-size: 15px; font-weight: 800; text-decoration: underline; }
  .form-title { font-size: 13px; font-weight: 700; margin-top: 2px; }
  .form-subtitle { font-size: 11.5px; font-weight: 600; margin-top: 2px; }
  .meta-row {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    font-size: 11px;
    font-weight: 700;
    padding: 4px 0;
    border-top: 1px solid #64748b;
    border-bottom: 1px dashed #94a3b8;
  }
  .meta-sub { border-top: none; margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5px; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  th, td { border: 1px solid #1e293b; padding: 4px 4px; vertical-align: middle; word-wrap: break-word; }
  th { background: #e2e8f0; text-align: center; font-weight: 700; }
  .f2 { font-size: 10.5px; }
  .f2 th, .f2 td { padding: 5px 5px; }
  .c { text-align: center; }
  .b { font-weight: 700; }
  .total-row td { background: #dcfce7; font-weight: 800; }
  .footer {
    margin-top: 20px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    font-size: 11px;
  }
  .note { font-style: italic; }
  .sig { font-weight: 700; text-align: center; min-width: 240px; padding-top: 32px; }
  .page-break { page-break-before: always; }
</style>
</head>
<body>${bodyContent}</body>
</html>`;
}

function generateCgePdfBuffer({ staff, form2, meta, mode = 'both' }) {
  return new Promise((resolve, reject) => {
    const browser = findBrowserExecutable();
    if (!browser) {
      return reject(new Error('Chrome या Edge ब्राउज़र नहीं मिला (PDF जनरेटर हेतु आवश्यक)'));
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cge-pdf-'));
    const htmlPath = path.join(tmpDir, 'report.html');
    const pdfPath = path.join(tmpDir, 'report.pdf');

    const cleanup = () => {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    };

    try {
      const html = buildCgePrintHtml({ staff, form2, meta, mode });
      fs.writeFileSync(htmlPath, html, 'utf8');
    } catch (err) {
      cleanup();
      return reject(err);
    }

    const args = [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-extensions',
      '--no-pdf-header-footer',
      `--print-to-pdf=${pdfPath}`,
      pathToFileURL(htmlPath).href
    ];

    execFile(browser, args, { timeout: 30000 }, (err, _stdout, stderr) => {
      if (err || !fs.existsSync(pdfPath)) {
        cleanup();
        return reject(new Error(err ? `PDF generation failed: ${err.message}` : `PDF not created: ${stderr}`));
      }
      try {
        const buf = fs.readFileSync(pdfPath);
        cleanup();
        resolve(buf);
      } catch (readErr) {
        cleanup();
        reject(readErr);
      }
    });
  });
}

module.exports = { generateCgePdfBuffer, buildCgePrintHtml };
