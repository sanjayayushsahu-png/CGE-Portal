const state = {
  settings: {},
  blocks: [],
  sankuls: [],
  schools: [],
  staff: [],
  allStaff: [],
  dashboard: null,
  currentView: 'dashboard',
  cgeReport: null
};

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

function initials(name) {
  const parts = String(name || 'S').trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || 'ST';
}

const AVATAR_PALETTE = [
  ['#dcfce7', '#166534'],
  ['#dbeafe', '#1e40af'],
  ['#fef3c7', '#92400e'],
  ['#fce7f3', '#9d174d'],
  ['#ede9fe', '#5b21b6'],
  ['#ccfbf1', '#115e59']
];

let toastTimer;
function showToast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3200);
}

async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// --- NAVIGATION ---
const VIEW_META = {
  dashboard: ['डैशबोर्ड', 'सभी विद्यालय, संकुल एवं विकासखंड के कर्मचारियों की CGE प्रपत्र-01 व 02 गणना आसानी से प्रबंधित करें।'],
  staff: ['कर्मचारी प्रविष्टि (Form 1)', 'समस्त विद्यालयों के अधिकारियों एवं कर्मचारियों का पूरा CGE डेटाबेस।'],
  reports: ['वार रिपोर्ट्स (School / Sankul / Block)', 'विद्यालय, संकुल एवं विकासखंड स्तर पर समेकित कर्मचारी रिपोर्ट।'],
  cge: ['आधिकारिक CGE प्रपत्र-01 एवं 02', 'प्रिंट, PDF एवं Excel (.xlsx) डाउनलोड हेतु तैयार आधिकारिक फॉर्मेट।'],
  masters: ['मास्टर डेटा प्रबंधन', 'विकासखंड, संकुल एवं विद्यालयों का पंजीकरण व प्रबंधन।'],
  settings: ['सेटिंग्स एवं बैकअप', 'जिला, गणना तिथि, विभाग एवं डेटाबेस बैकअप प्रबंधन।']
};

function switchView(view) {
  state.currentView = view;
  document.querySelectorAll('.nav-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === view);
  });
  document.querySelectorAll('.view-section').forEach((s) => {
    s.classList.toggle('active', s.id === `view-${view}`);
  });
  const [title, sub] = VIEW_META[view] || ['CGE', ''];
  document.getElementById('pageTitle').textContent = title;
  document.getElementById('pageSubtitle').textContent = sub;

  if (view === 'dashboard' || view === 'reports') loadDashboard();
  if (view === 'staff') loadStaffList();
  if (view === 'cge') loadCgeReport();
  if (view === 'masters') renderMasterTables();
}

// --- INITIAL LOAD ---
async function init() {
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  // Ctrl+K Global Search Shortcut
  const globalSearch = document.getElementById('globalSearchInput');
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      globalSearch.focus();
    }
  });
  globalSearch.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('fltSearch').value = globalSearch.value;
      switchView('staff');
      loadStaffList();
    }
  });

  // Report tabs
  document.querySelectorAll('[data-report-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-report-tab]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.reportTab;
      document.querySelectorAll('.report-pane').forEach((p) => {
        p.style.display = p.id === `report-${tab}` ? 'block' : 'none';
      });
    });
  });

  // Master tabs
  document.querySelectorAll('[data-master-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-master-tab]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.masterTab;
      document.querySelectorAll('.master-pane').forEach((p) => {
        p.style.display = p.id === `master-${tab}` ? 'block' : 'none';
      });
    });
  });

  bindFormEvents();
  await reloadAllMasters();
  await loadStaffList();
  await loadDashboard();
}

async function reloadAllMasters() {
  const [settings, blocks, sankuls, schools] = await Promise.all([
    api('/api/settings'),
    api('/api/blocks'),
    api('/api/sankuls'),
    api('/api/schools')
  ]);
  state.settings = settings;
  state.blocks = blocks;
  state.sankuls = sankuls;
  state.schools = schools;

  const dist = settings.district_name || 'बेमेतरा';
  const cDate = settings.census_date || '31 मार्च, 2024';
  document.getElementById('sidebarDistrict').textContent = `जिला ${dist} • प्रपत्र 01/02`;
  document.getElementById('sidebarCensusDate').textContent = `गणना तिथि: ${cDate} • प्रपत्र-01 व 02`;
  document.getElementById('topDistrictName').textContent = `जिला ${dist}`;
  document.getElementById('topDeptEmail').textContent = settings.default_email || settings.department_name || 'स्कूल शिक्षा विभाग';
  const badge = document.getElementById('dashCensusBadge');
  if (badge) badge.textContent = cDate;

  document.getElementById('setDistrict').value = settings.district_name || '';
  document.getElementById('setCensusDate').value = settings.census_date || '';
  document.getElementById('setDepartment').value = settings.department_name || '';
  document.getElementById('setEmail').value = settings.default_email || '';
  document.getElementById('setContact').value = settings.default_contact || '';

  populateAllDropdowns();
  renderMasterTables();
}

function fillSelect(el, items, { placeholder = '-- सभी (All) --', valueKey = 'id', labelFn = (x) => x.name, preserve = true } = {}) {
  const prev = preserve ? el.value : '';
  el.innerHTML = (placeholder !== null ? `<option value="">${esc(placeholder)}</option>` : '') +
    items.map((item) => `<option value="${esc(item[valueKey])}">${esc(labelFn(item))}</option>`).join('');
  if (preserve && prev && items.some((i) => String(i[valueKey]) === String(prev))) {
    el.value = prev;
  }
}

function populateAllDropdowns() {
  fillSelect(document.getElementById('fltBlock'), state.blocks);
  syncFilterSankuls();

  fillSelect(document.getElementById('repSchBlock'), state.blocks, { placeholder: 'सभी विकासखंड (All Blocks)' });
  fillSelect(document.getElementById('repSnkBlock'), state.blocks, { placeholder: 'सभी विकासखंड (All Blocks)' });
  syncReportSchoolSankuls();

  fillSelect(document.getElementById('snkBlockId'), state.blocks, { placeholder: '-- विकासखंड चुनें --' });
  fillSelect(document.getElementById('schBlockId'), state.blocks, { placeholder: '-- विकासखंड चुनें --' });
  syncMasterSchoolSankuls();

  fillSelect(document.getElementById('stBlockId'), state.blocks, { placeholder: '-- विकासखंड चुनें --' });
  syncStaffModalSankuls();

  fillSelect(document.getElementById('impBlockId'), state.blocks, { placeholder: '-- विकासखंड चुनें --' });
  syncImportSankuls();

  fillSelect(document.getElementById('cgeBlockId'), state.blocks, { placeholder: '-- विकासखंड चुनें --' });
  syncCgeDropdowns();
}

function syncFilterSankuls() {
  const blk = document.getElementById('fltBlock').value;
  const snks = blk ? state.sankuls.filter((s) => String(s.block_id) === String(blk)) : state.sankuls;
  fillSelect(document.getElementById('fltSankul'), snks);
  syncFilterSchools();
}

function syncFilterSchools() {
  const blk = document.getElementById('fltBlock').value;
  const snk = document.getElementById('fltSankul').value;
  let schs = state.schools;
  if (blk) schs = schs.filter((s) => String(s.block_id) === String(blk));
  if (snk) schs = schs.filter((s) => String(s.sankul_id) === String(snk));
  fillSelect(document.getElementById('fltSchool'), schs);
}

function syncReportSchoolSankuls() {
  const blk = document.getElementById('repSchBlock').value;
  const snks = blk ? state.sankuls.filter((s) => String(s.block_id) === String(blk)) : state.sankuls;
  fillSelect(document.getElementById('repSchSankul'), snks, { placeholder: 'सभी संकुल (All Sankuls)' });
}

function syncMasterSchoolSankuls() {
  const blk = document.getElementById('schBlockId').value;
  const snks = blk ? state.sankuls.filter((s) => String(s.block_id) === String(blk)) : [];
  fillSelect(document.getElementById('schSankulId'), snks, { placeholder: '-- संकुल चुनें --' });
}

function syncStaffModalSankuls(targetSankulId = null, targetSchoolId = null) {
  const blk = document.getElementById('stBlockId').value;
  const snks = blk ? state.sankuls.filter((s) => String(s.block_id) === String(blk)) : [];
  fillSelect(document.getElementById('stSankulId'), snks, { placeholder: '-- संकुल चुनें --', preserve: false });
  if (targetSankulId) document.getElementById('stSankulId').value = String(targetSankulId);
  else if (snks.length === 1) document.getElementById('stSankulId').value = String(snks[0].id);
  syncStaffModalSchools(targetSchoolId);
}

function syncStaffModalSchools(targetSchoolId = null) {
  const snk = document.getElementById('stSankulId').value;
  const schs = snk ? state.schools.filter((s) => String(s.sankul_id) === String(snk)) : [];
  fillSelect(document.getElementById('stSchoolId'), schs, { placeholder: '-- विद्यालय चुनें --', preserve: false });
  if (targetSchoolId) document.getElementById('stSchoolId').value = String(targetSchoolId);
  else if (schs.length === 1) document.getElementById('stSchoolId').value = String(schs[0].id);
}

function syncImportSankuls() {
  const blk = document.getElementById('impBlockId').value;
  const snks = blk ? state.sankuls.filter((s) => String(s.block_id) === String(blk)) : [];
  fillSelect(document.getElementById('impSankulId'), snks, { placeholder: '-- संकुल चुनें --', preserve: false });
  syncImportSchools();
}

function syncImportSchools() {
  const snk = document.getElementById('impSankulId').value;
  const schs = snk ? state.schools.filter((s) => String(s.sankul_id) === String(snk)) : [];
  fillSelect(document.getElementById('impSchoolId'), schs, { placeholder: '-- विद्यालय चुनें --', preserve: false });
}

function syncCgeDropdowns() {
  const scope = document.getElementById('cgeScope').value;
  document.getElementById('cgeBlockWrap').style.display = (scope === 'block' || scope === 'sankul' || scope === 'school') ? 'flex' : 'none';
  document.getElementById('cgeSankulWrap').style.display = (scope === 'sankul' || scope === 'school') ? 'flex' : 'none';
  document.getElementById('cgeSchoolWrap').style.display = (scope === 'school') ? 'flex' : 'none';

  const blk = document.getElementById('cgeBlockId').value;
  const snks = blk ? state.sankuls.filter((s) => String(s.block_id) === String(blk)) : state.sankuls;
  fillSelect(document.getElementById('cgeSankulId'), snks, { placeholder: '-- संकुल चुनें --' });

  const snk = document.getElementById('cgeSankulId').value;
  let schs = state.schools;
  if (blk) schs = schs.filter((s) => String(s.block_id) === String(blk));
  if (snk) schs = schs.filter((s) => String(s.sankul_id) === String(snk));
  fillSelect(document.getElementById('cgeSchoolId'), schs, { placeholder: '-- विद्यालय चुनें --' });
}

// --- DASHBOARD BENTO RENDERING ---
async function loadDashboard() {
  const [data, allStaff] = await Promise.all([
    api('/api/dashboard'),
    api('/api/staff')
  ]);
  state.dashboard = data;
  state.allStaff = allStaff;
  const c = data.counts;

  // Sidebar live badge
  document.getElementById('navStaffBadge').textContent = c.staff > 99 ? '99+' : String(c.staff);

  // Sample banner
  const sampleBanner = document.getElementById('sampleBanner');
  if (c.sampleCount > 0) {
    sampleBanner.style.display = 'flex';
    document.getElementById('sampleCountText').textContent = c.sampleCount;
  } else {
    sampleBanner.style.display = 'none';
  }

  // Row 1: 4 Donezo KPI Cards
  document.getElementById('dashboardKpis').innerHTML = `
    <div class="kpi-card featured" onclick="switchView('staff')">
      <div class="kpi-top">
        <span class="kpi-label">कुल कर्मचारी (Total Staff)</span>
        <span class="kpi-arrow">↗</span>
      </div>
      <div class="kpi-value">${c.staff}</div>
      <div class="kpi-foot">
        <span class="kpi-pill">${c.sanctioned} स्वीकृत</span>
        <span>असृजित: ${Math.max(0, c.staff - c.sanctioned)}</span>
      </div>
    </div>

    <div class="kpi-card" onclick="switchView('staff')">
      <div class="kpi-top">
        <span class="kpi-label">नियमित (Regular)</span>
        <span class="kpi-arrow">↗</span>
      </div>
      <div class="kpi-value">${c.regular}</div>
      <div class="kpi-foot">
        <span class="kpi-pill">${c.staff ? Math.round((c.regular / c.staff) * 100) : 0}%</span>
        <span>स्थायी / अस्थायी</span>
      </div>
    </div>

    <div class="kpi-card" onclick="switchView('staff')">
      <div class="kpi-top">
        <span class="kpi-label">अनियमित (Non-Regular)</span>
        <span class="kpi-arrow">↗</span>
      </div>
      <div class="kpi-value">${c.nonRegular}</div>
      <div class="kpi-foot">
        <span class="kpi-pill">${c.staff ? Math.round((c.nonRegular / c.staff) * 100) : 0}%</span>
        <span>संविदा / अंशकालीन आदि</span>
      </div>
    </div>

    <div class="kpi-card" onclick="switchView('masters')">
      <div class="kpi-top">
        <span class="kpi-label">पंजीकृत विद्यालय</span>
        <span class="kpi-arrow">↗</span>
      </div>
      <div class="kpi-value">${c.schools}</div>
      <div class="kpi-foot">
        <span class="kpi-pill">${c.blocks} ब्लॉक</span>
        <span>${c.sankuls} संकुल</span>
      </div>
    </div>
  `;

  // Row 2 Left: Pill Bar Chart (Caste & Gender Distribution)
  const scCnt = data.blockSummary.reduce((a, b) => a + (b.sc_count || 0), 0);
  const stCnt = data.blockSummary.reduce((a, b) => a + (b.st_count || 0), 0);
  const obcCnt = data.blockSummary.reduce((a, b) => a + (b.obc_count || 0), 0);
  const genCnt = data.blockSummary.reduce((a, b) => a + (b.gen_count || 0), 0);

  const chartItems = [
    { label: 'SC', val: scCnt, cls: scCnt ? 'solid-mid' : 'hatched' },
    { label: 'ST', val: stCnt, cls: stCnt ? 'solid-light' : 'hatched' },
    { label: 'OBC', val: obcCnt, cls: obcCnt ? 'solid-dark' : 'hatched' },
    { label: 'GEN', val: genCnt, cls: genCnt ? 'solid-mid' : 'hatched' },
    { label: 'पुरुष', val: c.male, cls: c.male ? 'solid-dark' : 'hatched' },
    { label: 'महिला', val: c.female, cls: c.female ? 'solid-light' : 'hatched' },
    { label: 'TG', val: c.transgender, cls: c.transgender ? 'solid-mid' : 'hatched' }
  ];
  const maxVal = Math.max(1, ...chartItems.map((x) => x.val));

  document.getElementById('dashPillChart').innerHTML = chartItems.map((item) => {
    const pct = item.val > 0 ? Math.max(24, Math.round((item.val / maxVal) * 100)) : 52;
    return `
      <div class="pill-col">
        <div class="pill-bar-wrap">
          <div class="pill-bar ${item.cls}" style="height:${pct}%;">
            ${item.val > 0 ? `<span class="pill-val">${item.val}</span>` : ''}
          </div>
        </div>
        <span class="pill-label">${item.label}</span>
      </div>
    `;
  }).join('');

  // Row 2 Right: Block Quick List
  document.getElementById('dashBlockList').innerHTML = data.blockSummary.slice(0, 5).map((b, i) => {
    const [bg, fg] = AVATAR_PALETTE[i % AVATAR_PALETTE.length];
    return `
      <div class="mini-item">
        <div class="mini-avatar" style="background:${bg}; color:${fg};">${initials(b.name)}</div>
        <div class="mini-meta">
          <div class="mini-title">${esc(b.name)}</div>
          <div class="mini-sub">${b.sankul_count} संकुल • ${b.school_count} विद्यालय • <strong>${b.total_staff || 0} स्टाफ</strong></div>
        </div>
        <button class="btn btn-sm btn-accent" onclick="openCgeFor('block', ${b.id})">CGE</button>
      </div>
    `;
  }).join('') || '<div style="color:var(--text-muted);font-size:13px;">कोई विकासखंड नहीं</div>';

  // Row 3 Left: Recent Staff (Team Collaboration style)
  const recent = [...allStaff].reverse().slice(0, 4);
  document.getElementById('dashRecentStaff').innerHTML = recent.map((e, i) => {
    const [bg, fg] = AVATAR_PALETTE[(i + 2) % AVATAR_PALETTE.length];
    const isReg = e.employment_type === 'Regular';
    return `
      <div class="mini-item">
        <div class="mini-avatar" style="background:${bg}; color:${fg};">${initials(e.emp_name)}</div>
        <div class="mini-meta">
          <div class="mini-title">${esc(e.emp_name)} <span class="badge ${isReg ? 'badge-green' : 'badge-amber'}" style="margin-left:4px;">${isReg ? 'Regular' : 'Non-Reg'}</span></div>
          <div class="mini-sub">${esc(e.designation)} • ${esc(e.school_name)}</div>
        </div>
        <div class="action-btns">
          <button class="btn btn-icon-sm" title="संपादित करें (Edit)" onclick="editStaff(${e.id})">✏️</button>
          <button class="btn btn-icon-sm btn-danger" title="हटाएं (Delete)" onclick="deleteStaff(${e.id})">🗑️</button>
        </div>
      </div>
    `;
  }).join('') || '<div style="color:var(--text-muted);font-size:13px;">अभी कोई कर्मचारी प्रविष्टि नहीं है।</div>';

  // Row 3 Middle: Semi-Circular Arc Gauge (Regular %)
  const regPct = c.staff ? Math.round((c.regular / c.staff) * 100) : 0;
  const arcLen = 251.2; // PI * 80
  const dashOffset = arcLen - (arcLen * regPct) / 100;
  document.getElementById('dashGaugeWrap').innerHTML = `
    <svg width="210" height="122" viewBox="0 0 210 122">
      <defs>
        <pattern id="diagHatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="8" stroke="#cbd5e1" stroke-width="4" />
        </pattern>
      </defs>
      <path d="M 25 105 A 80 80 0 0 1 185 105" fill="none" stroke="url(#diagHatch)" stroke-width="24" stroke-linecap="round" />
      <path d="M 25 105 A 80 80 0 0 1 185 105" fill="none" stroke="#165b38" stroke-width="24" stroke-linecap="round"
        stroke-dasharray="${arcLen}" stroke-dashoffset="${dashOffset}" />
      <text x="105" y="88" text-anchor="middle" font-size="30" font-weight="800" fill="#111827">${regPct}%</text>
      <text x="105" y="108" text-anchor="middle" font-size="11.5" font-weight="600" fill="#6b7280">नियमित कर्मचारी</text>
    </svg>
    <div class="gauge-legend">
      <span><span class="legend-dot" style="background:#165b38;"></span>नियमित (${c.regular})</span>
      <span><span class="legend-dot" style="background:#cbd5e1;"></span>अनियमित (${c.nonRegular})</span>
      <span><span class="legend-dot" style="background:#2eb66c;"></span>स्वीकृत (${c.sanctioned})</span>
    </div>
  `;

  // Row 3 Right: Dark Emerald Tracker Card
  document.getElementById('trackerTotalCount').textContent = String(c.staff).padStart(2, '0');
  document.getElementById('trackerStatusText').textContent = `प्रपत्र-01 (${c.staff}) == प्रपत्र-02 (${c.staff}) सत्यापित ✓`;

  renderReportTables();
}

function renderReportTables() {
  if (!state.dashboard) return;
  const { blockSummary, sankulSummary, schoolSummary } = state.dashboard;

  const schBlk = document.getElementById('repSchBlock').value;
  const schSnk = document.getElementById('repSchSankul').value;
  let schools = schoolSummary;
  if (schBlk) schools = schools.filter((s) => String(s.block_id) === String(schBlk));
  if (schSnk) schools = schools.filter((s) => String(s.sankul_id) === String(schSnk));

  document.getElementById('repSchoolTbody').innerHTML = schools.map((s, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${esc(s.name)}</strong><div style="font-size:11px;color:var(--text-muted);">${esc(s.udise_code || '')} • ${esc(s.school_type)}</div></td>
      <td>${esc(s.sankul_name)}</td>
      <td>${esc(s.block_name)}</td>
      <td class="text-center">${s.regular_count || 0}</td>
      <td class="text-center">${s.non_regular_count || 0}</td>
      <td class="text-center">${s.male_count || 0}</td>
      <td class="text-center">${s.female_count || 0}</td>
      <td class="text-center">${s.sc_count || 0}</td>
      <td class="text-center">${s.st_count || 0}</td>
      <td class="text-center">${s.obc_count || 0}</td>
      <td class="text-center">${s.gen_count || 0}</td>
      <td class="text-center"><strong>${s.total_staff || 0}</strong></td>
      <td class="text-center">
        <button class="btn btn-sm btn-primary" onclick="openCgeFor('school', ${s.id}, ${s.block_id}, ${s.sankul_id})">CGE</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="14" class="text-center">कोई विद्यालय डेटा नहीं</td></tr>';

  const snkBlk = document.getElementById('repSnkBlock').value;
  const sankuls = snkBlk ? sankulSummary.filter((s) => String(s.block_id) === String(snkBlk)) : sankulSummary;

  document.getElementById('repSankulTbody').innerHTML = sankuls.map((s, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${esc(s.name)}</strong><div style="font-size:11px;color:var(--text-muted);">समन्वयक: ${esc(s.coordinator_name || '-')}</div></td>
      <td>${esc(s.block_name)}</td>
      <td>${esc(s.ddo_code || '-')}</td>
      <td class="text-center">${s.school_count}</td>
      <td class="text-center">${s.regular_count || 0}</td>
      <td class="text-center">${s.non_regular_count || 0}</td>
      <td class="text-center">${s.male_count || 0}</td>
      <td class="text-center">${s.female_count || 0}</td>
      <td class="text-center">${s.sc_count || 0}</td>
      <td class="text-center">${s.st_count || 0}</td>
      <td class="text-center">${s.obc_count || 0}</td>
      <td class="text-center">${s.gen_count || 0}</td>
      <td class="text-center"><strong>${s.total_staff || 0}</strong></td>
      <td class="text-center">
        <button class="btn btn-sm btn-primary" onclick="openCgeFor('sankul', ${s.id}, ${s.block_id})">CGE</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="15" class="text-center">कोई संकुल डेटा नहीं</td></tr>';

  document.getElementById('repBlockTbody').innerHTML = blockSummary.map((b, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${esc(b.name)}</strong></td>
      <td>${esc(b.ddo_code || '-')}</td>
      <td class="text-center">${b.sankul_count}</td>
      <td class="text-center">${b.school_count}</td>
      <td class="text-center">${b.regular_count || 0}</td>
      <td class="text-center">${b.non_regular_count || 0}</td>
      <td class="text-center">${b.male_count || 0}</td>
      <td class="text-center">${b.female_count || 0}</td>
      <td class="text-center">${b.sc_count || 0}</td>
      <td class="text-center">${b.st_count || 0}</td>
      <td class="text-center">${b.obc_count || 0}</td>
      <td class="text-center">${b.gen_count || 0}</td>
      <td class="text-center"><strong>${b.total_staff || 0}</strong></td>
      <td class="text-center">
        <button class="btn btn-sm btn-primary" onclick="openCgeFor('block', ${b.id})">CGE</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="15" class="text-center">कोई विकासखंड डेटा नहीं</td></tr>';
}

function openCgeFor(scope, id, blockId = null, sankulId = null) {
  switchView('cge');
  document.getElementById('cgeScope').value = scope;
  if (scope === 'block') {
    document.getElementById('cgeBlockId').value = String(id);
    syncCgeDropdowns();
  } else if (scope === 'sankul') {
    if (blockId) document.getElementById('cgeBlockId').value = String(blockId);
    syncCgeDropdowns();
    document.getElementById('cgeSankulId').value = String(id);
  } else if (scope === 'school') {
    if (blockId) document.getElementById('cgeBlockId').value = String(blockId);
    syncCgeDropdowns();
    if (sankulId) document.getElementById('cgeSankulId').value = String(sankulId);
    syncCgeDropdowns();
    document.getElementById('cgeSchoolId').value = String(id);
  } else {
    syncCgeDropdowns();
  }
  loadCgeReport();
}

// --- STAFF LIST & CRUD ---
async function loadStaffList() {
  const params = new URLSearchParams();
  const blk = document.getElementById('fltBlock').value;
  const snk = document.getElementById('fltSankul').value;
  const sch = document.getElementById('fltSchool').value;
  const typ = document.getElementById('fltEmpType').value;
  const q = document.getElementById('fltSearch').value.trim();

  if (blk) params.set('block_id', blk);
  if (snk) params.set('sankul_id', snk);
  if (sch) params.set('school_id', sch);
  if (typ) params.set('employment_type', typ);
  if (q) params.set('search', q);

  const rows = await api(`/api/staff?${params.toString()}`);
  state.staff = rows;

  document.getElementById('staffTbody').innerHTML = rows.map((e, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><code>${esc(e.emp_code)}</code></td>
      <td>
        <strong>${esc(e.emp_name)}</strong>
        ${e.is_sample ? '<span class="badge badge-amber" style="margin-left:4px;">Demo</span>' : ''}
        <div style="font-size:11px;color:var(--text-muted);">DOB: ${fmtDate(e.dob) || '-'} | DOJ: ${fmtDate(e.doj) || '-'}</div>
      </td>
      <td>${esc(e.gender)} / <span class="badge badge-blue">${esc(e.caste)}</span></td>
      <td>${esc(e.designation)}</td>
      <td>${esc(e.emp_class)}</td>
      <td>${esc(e.pay_level || '-')}</td>
      <td>
        <span class="badge ${e.employment_type === 'Regular' ? 'badge-green' : 'badge-amber'}">${esc(e.employment_type)}</span>
        <div style="font-size:11px;color:var(--text-muted);">${esc(e.employment_type === 'Regular' ? e.regular_status : e.non_regular_type)}</div>
      </td>
      <td class="text-center"><span class="badge ${e.is_sanctioned === 'Y' ? 'badge-green' : 'badge-red'}">${esc(e.is_sanctioned)}</span></td>
      <td>
        <div style="font-weight:600;font-size:12.5px;">${esc(e.school_name)}</div>
        <div style="font-size:11px;color:var(--text-muted);">${esc(e.sankul_name)} • ${esc(e.block_name)}</div>
      </td>
      <td class="text-center sticky-action-col">
        <div class="action-btns">
          <button class="btn btn-sm" onclick="editStaff(${e.id})">✏️ Edit</button>
          <button class="btn btn-sm btn-danger" onclick="deleteStaff(${e.id})">🗑️ Delete</button>
        </div>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="11" class="text-center">कोई कर्मचारी प्रविष्टि नहीं मिली। नया कर्मचारी जोड़ें।</td></tr>';

  document.getElementById('staffCountBar').textContent = `कुल प्रदर्शित कर्मचारी: ${rows.length}`;
}

function resetStaffFilters() {
  document.getElementById('fltBlock').value = '';
  syncFilterSankuls();
  document.getElementById('fltEmpType').value = '';
  document.getElementById('fltSearch').value = '';
  document.getElementById('globalSearchInput').value = '';
  loadStaffList();
}

function onDesignationChange() {
  const desig = (document.getElementById('stDesignation').value || '').trim();
  const empTypeEl = document.getElementById('stEmpType');
  const nonRegEl = document.getElementById('stNonRegType');
  if (/\bcook\b|रसोईया|रसोइया|मानसेवी/i.test(desig)) {
    empTypeEl.value = 'Non Regular';
    toggleEmploymentFields();
    nonRegEl.value = 'Honorary';
  } else if (/part[\s-]*time|paert[\s-]*time|अंशकालीन/i.test(desig)) {
    empTypeEl.value = 'Non Regular';
    toggleEmploymentFields();
    nonRegEl.value = 'Part time';
  }
}

function toggleEmploymentFields() {
  const typ = document.getElementById('stEmpType').value;
  const reg = document.getElementById('stRegStatus');
  const nonReg = document.getElementById('stNonRegType');
  if (typ === 'Regular') {
    reg.disabled = false;
    nonReg.disabled = true;
    nonReg.value = '';
  } else {
    reg.disabled = true;
    nonReg.disabled = false;
    if (!nonReg.value) nonReg.value = 'Contractual';
  }
}

function openStaffModal(emp = null) {
  document.getElementById('staffForm').reset();
  document.getElementById('stEditId').value = emp ? emp.id : '';
  document.getElementById('staffModalTitle').textContent = emp
    ? `कर्मचारी संपादित करें — ${emp.emp_name}`
    : 'नया कर्मचारी प्रविष्टि (CGE प्रपत्र-01)';

  if (emp) {
    document.getElementById('stBlockId').value = String(emp.block_id);
    syncStaffModalSankuls(emp.sankul_id, emp.school_id);
    document.getElementById('stEmpCode').value = emp.emp_code;
    document.getElementById('stEmpName').value = emp.emp_name;
    document.getElementById('stGender').value = emp.gender;
    document.getElementById('stCaste').value = emp.caste;
    document.getElementById('stDob').value = emp.dob || '';
    document.getElementById('stDoj').value = emp.doj || '';
    document.getElementById('stDesignation').value = emp.designation;
    document.getElementById('stClass').value = emp.emp_class;
    document.getElementById('stPayLevel').value = emp.pay_level || '';
    document.getElementById('stEmpType').value = emp.employment_type;
    document.getElementById('stRegStatus').value = emp.regular_status || 'Permanent';
    document.getElementById('stNonRegType').value = emp.non_regular_type || '';
    document.getElementById('stSanctioned').value = emp.is_sanctioned || 'Y';
    document.getElementById('stRemark').value = emp.remark || '';
  } else {
    if (state.blocks.length) {
      document.getElementById('stBlockId').value = document.getElementById('fltBlock').value || String(state.blocks[0].id);
    }
    syncStaffModalSankuls(document.getElementById('fltSankul').value || null, document.getElementById('fltSchool').value || null);
    document.getElementById('stEmpType').value = 'Regular';
    document.getElementById('stRegStatus').value = 'Permanent';
    document.getElementById('stSanctioned').value = 'Y';
  }
  toggleEmploymentFields();
  document.getElementById('staffModal').classList.add('open');
}

function closeStaffModal() {
  document.getElementById('staffModal').classList.remove('open');
}

function findStaffById(id) {
  return (
    state.staff.find((s) => s.id === id) ||
    state.allStaff.find((s) => s.id === id) ||
    (state.cgeReport?.staff || []).find((s) => s.id === id) ||
    null
  );
}

function editStaff(id) {
  const emp = findStaffById(id);
  if (emp) openStaffModal(emp);
  else showToast('कर्मचारी रिकॉर्ड नहीं मिला', 'error');
}

async function deleteStaff(id) {
  const emp = findStaffById(id);
  const label = emp ? `${emp.emp_name} (${emp.emp_code})` : `#${id}`;
  if (!confirm(`क्या आप वाकई "${label}" की प्रविष्टि स्थायी रूप से हटाना चाहते हैं?`)) return;
  try {
    await api(`/api/staff/${id}`, { method: 'DELETE' });
    showToast('कर्मचारी प्रविष्टि सफलतापूर्वक हटाई गई');
    await loadStaffList();
    await loadDashboard();
    if (state.currentView === 'cge') await loadCgeReport();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function clearSampleStaff() {
  if (!confirm('क्या आप सभी डेमो (Sample) कर्मचारी हटाना चाहते हैं?')) return;
  try {
    const res = await api('/api/staff/clear-samples', { method: 'POST' });
    showToast(`${res.deleted} डेमो कर्मचारी हटाए गए`);
    await loadDashboard();
    await loadStaffList();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// --- CGE FORM 1 & FORM 2 RENDERING ---
function getCgeQueryParams() {
  const scope = document.getElementById('cgeScope').value;
  const params = new URLSearchParams({ scope });
  if (scope === 'block') {
    const id = document.getElementById('cgeBlockId').value;
    if (id) params.set('id', id);
  } else if (scope === 'sankul') {
    const id = document.getElementById('cgeSankulId').value;
    if (id) params.set('id', id);
  } else if (scope === 'school') {
    const id = document.getElementById('cgeSchoolId').value;
    if (id) params.set('id', id);
  }
  return params;
}

async function loadCgeReport() {
  const params = getCgeQueryParams();
  const data = await api(`/api/reports/cge?${params.toString()}`);
  state.cgeReport = data;
  renderCgePreview();
}

function renderCgePreview() {
  const data = state.cgeReport;
  if (!data) return;
  const { meta, staff, form2 } = data;
  const mode = document.getElementById('cgeDisplayMode').value;

  const verifyEl = document.getElementById('cgeVerifyBanner');
  const matched = staff.length === form2.totals.grand_total;
  verifyEl.className = `banner ${matched ? 'success' : ''}`;
  verifyEl.innerHTML = `
    <div>
      <strong>सत्यापन (Auto-Check):</strong>
      प्रपत्र-01 कुल कर्मचारी = <strong>${staff.length}</strong> |
      प्रपत्र-02 (गोश्वारा) कुल योग = <strong>${form2.totals.grand_total}</strong>
      ${matched ? '✅ दोनों प्रपत्र पूर्णतः मेल खाते हैं।' : '⚠️ योग में अंतर है!'}
    </div>
    <div style="font-size:12.5px;">स्तर: <strong>${esc(meta.scopeLabel)} — ${esc(meta.entityName)}</strong></div>
  `;

  let html = '';

  if (mode === 'both' || mode === 'form1') {
    html += `
      <div class="cge-sheet">
        <div class="cge-header">
          <div class="form-tag">प्रपत्र-01</div>
          <div class="form-title">प्रशासनिक क्षेत्र में नियोजन गणना ${esc(meta.censusDate)}</div>
          <div class="form-subtitle">${esc(meta.censusDate)} की स्थिति में इस ${esc(meta.scopeLabel)} में कार्यरत अधिकारियों एवं कर्मचारियों की जानकारी</div>
        </div>
        <div class="cge-meta-row">
          <span>जिला: ${esc(meta.district)}</span>
          <span>${esc(meta.scopeLabel)} का नाम: ${esc(meta.entityName)}</span>
          <span>डी.डी.ओ. कोड: ${esc(meta.ddoCode || '__________')}</span>
        </div>
        <div class="cge-meta-row" style="border-top:none; padding-top:0;">
          <span>विभाग का नाम: ${esc(meta.department)}</span>
          <span>सम्पर्क नम्बर / ई-मेल आई.डी.: ${esc([meta.contact, meta.email].filter(Boolean).join(' / ') || '__________')}</span>
        </div>
        <div class="table-wrap">
          <table class="cge-table">
            <thead>
              <tr>
                <th>S.NO.</th><th>Employee Code</th><th>Employee Name</th>
                <th>Gender<br>M/F/Transgender</th><th>Caste<br>SC/ST/OBC/Gen.</th>
                <th>Date of Birth</th><th>Date of First Joining</th><th>Designation</th>
                <th>Class<br>I/II/III (Exec/Min)/IV</th><th>Level in Pay Matrix / Grade Pay</th>
                <th>Type of Employment<br>Regular / Non Regular</th>
                <th>If Regular then<br>Permanent / Temporary</th>
                <th>If Non Regular then Specify</th>
                <th>Is Post Sanctioned<br>Y/N</th><th>Remark If any</th>
                <th class="no-print">Edit / Delete</th>
              </tr>
              <tr>${Array.from({ length: 15 }, (_, i) => `<th>(${i + 1})</th>`).join('')}<th class="no-print">क्रिया</th></tr>
            </thead>
            <tbody>
              ${staff.length ? staff.map((e, idx) => `
                <tr>
                  <td class="text-center">${idx + 1}</td>
                  <td class="text-center">${esc(e.emp_code)}</td>
                  <td>${esc(e.emp_name)}</td>
                  <td class="text-center">${esc(e.gender)}</td>
                  <td class="text-center">${esc(e.caste)}</td>
                  <td class="text-center">${fmtDate(e.dob)}</td>
                  <td class="text-center">${fmtDate(e.doj)}</td>
                  <td>${esc(e.designation)}</td>
                  <td class="text-center">${esc(e.emp_class)}</td>
                  <td class="text-center">${esc(e.pay_level)}</td>
                  <td class="text-center">${esc(e.employment_type)}</td>
                  <td class="text-center">${e.employment_type === 'Regular' ? esc(e.regular_status) : ''}</td>
                  <td>${e.employment_type === 'Non Regular' ? esc(e.non_regular_type) : ''}</td>
                  <td class="text-center">${esc(e.is_sanctioned)}</td>
                  <td>${esc(e.remark)}</td>
                  <td class="text-center no-print">
                    <div class="action-btns">
                      <button class="btn btn-icon-sm" title="संपादित करें" onclick="editStaff(${e.id})">✏️</button>
                      <button class="btn btn-icon-sm btn-danger" title="हटाएं" onclick="deleteStaff(${e.id})">🗑️</button>
                    </div>
                  </td>
                </tr>
              `).join('') : `<tr><td colspan="16" class="text-center" style="padding:18px;">इस चयन के अंतर्गत कोई कर्मचारी प्रविष्टि नहीं है।</td></tr>`}
            </tbody>
          </table>
        </div>
        <div class="cge-footer">
          <div><em>Note: Please read instructions carefully before editing in the database.</em></div>
          <div class="cge-signature">${esc(meta.signatureLabel)}</div>
        </div>
      </div>
    `;
  }

  if (mode === 'both' || mode === 'form2') {
    const t = form2.totals;
    html += `
      <div class="cge-sheet">
        <div class="cge-header">
          <div class="form-tag">प्रपत्र-02 (प्रपत्र-01 का गोश्वारा)</div>
          <div class="form-title">प्रशासनिक क्षेत्र में नियोजन गणना की जानकारी</div>
          <div class="form-subtitle">${esc(meta.censusDate)} की स्थिति में इस ${esc(meta.scopeLabel)} में कार्यरत अधिकारियों एवं कर्मचारियों की संख्या</div>
        </div>
        <div class="cge-meta-row">
          <span>जिला: ${esc(meta.district)}</span>
          <span>${esc(meta.scopeLabel)} का नाम: ${esc(meta.entityName)}</span>
          <span>डी.डी.ओ. कोड: ${esc(meta.ddoCode || '__________')}</span>
        </div>
        <div class="cge-meta-row" style="border-top:none; padding-top:0;">
          <span>विभाग का नाम: ${esc(meta.department)}</span>
          <span>सम्पर्क नम्बर एवं ई-मेल आई.डी.: ${esc([meta.contact, meta.email].filter(Boolean).join(' / ') || '__________')}</span>
        </div>
        <div class="table-wrap">
          <table class="cge-table">
            <thead>
              <tr>
                <th rowspan="2" style="min-width:170px;">वर्ग / श्रेणी</th>
                <th colspan="5">पुरुष (Male)</th>
                <th colspan="5">महिला (Female)</th>
                <th colspan="5">योग (Male + Female)</th>
                <th rowspan="2">Transgender</th>
                <th rowspan="2">Total</th>
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
                  <td class="text-center">${r.m_sc}</td><td class="text-center">${r.m_st}</td><td class="text-center">${r.m_obc}</td><td class="text-center">${r.m_gen}</td><td class="text-center"><strong>${r.m_total}</strong></td>
                  <td class="text-center">${r.f_sc}</td><td class="text-center">${r.f_st}</td><td class="text-center">${r.f_obc}</td><td class="text-center">${r.f_gen}</td><td class="text-center"><strong>${r.f_total}</strong></td>
                  <td class="text-center">${r.t_sc}</td><td class="text-center">${r.t_st}</td><td class="text-center">${r.t_obc}</td><td class="text-center">${r.t_gen}</td><td class="text-center"><strong>${r.t_total}</strong></td>
                  <td class="text-center">${r.transgender}</td>
                  <td class="text-center"><strong>${r.grand_total}</strong></td>
                </tr>
              `).join('')}
              <tr class="total-row">
                <td>${esc(t.label)}</td>
                <td class="text-center">${t.m_sc}</td><td class="text-center">${t.m_st}</td><td class="text-center">${t.m_obc}</td><td class="text-center">${t.m_gen}</td><td class="text-center">${t.m_total}</td>
                <td class="text-center">${t.f_sc}</td><td class="text-center">${t.f_st}</td><td class="text-center">${t.f_obc}</td><td class="text-center">${t.f_gen}</td><td class="text-center">${t.f_total}</td>
                <td class="text-center">${t.t_sc}</td><td class="text-center">${t.t_st}</td><td class="text-center">${t.t_obc}</td><td class="text-center">${t.t_gen}</td><td class="text-center">${t.t_total}</td>
                <td class="text-center">${t.transgender}</td>
                <td class="text-center">${t.grand_total}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="cge-footer">
          <div><strong>टीप:-</strong> कृपया प्रपत्र 01 के आधार पर भरा जावे।</div>
          <div class="cge-signature">${esc(meta.signatureLabel)}</div>
        </div>
      </div>
    `;
  }

  document.getElementById('cgePreviewContainer').innerHTML = html;
}

async function downloadCgePdf() {
  const btn = document.getElementById('btnDownloadPdf');
  const origText = btn ? btn.textContent : '';
  try {
    if (btn) { btn.disabled = true; btn.textContent = '⏳ PDF बन रहा है...'; }
    const params = getCgeQueryParams();
    params.set('mode', document.getElementById('cgeDisplayMode').value || 'both');
    const res = await fetch(`/api/export/pdf?${params.toString()}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'PDF डाउनलोड विफल रहा');
    }
    const blob = await res.blob();
    const disp = res.headers.get('Content-Disposition') || '';
    const match = disp.match(/filename="([^"]+)"/);
    const filename = match ? match[1] : `CGE_Form1_Form2_${new Date().toISOString().slice(0, 10)}.pdf`;

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    showToast('PDF सफलतापूर्वक डाउनलोड हुआ');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = origText; }
  }
}

function downloadCgeXlsx() {
  window.location.href = `/api/export/xlsx?${getCgeQueryParams().toString()}`;
}

function downloadCgeCsv(form) {
  const params = getCgeQueryParams();
  params.set('form', form);
  window.location.href = `/api/export/csv?${params.toString()}`;
}

// --- MASTER DATA TABLES & CRUD ---
function renderMasterTables() {
  document.getElementById('masterBlocksTbody').innerHTML = state.blocks.map((b, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${esc(b.name)}</strong></td>
      <td>${esc(b.code || '-')}</td>
      <td>${esc(b.ddo_code || '-')}</td>
      <td>${esc([b.contact, b.email].filter(Boolean).join(' / ') || '-')}</td>
      <td class="text-center" style="white-space:nowrap;">
        <div class="action-btns">
          <button class="btn btn-sm" onclick="editBlock(${b.id})">✏️ Edit</button>
          <button class="btn btn-sm btn-danger" onclick="deleteBlock(${b.id})">🗑️ Delete</button>
        </div>
      </td>
    </tr>
  `).join('');

  document.getElementById('masterSankulsTbody').innerHTML = state.sankuls.map((s, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${esc(s.name)}</strong></td>
      <td>${esc(s.block_name)}</td>
      <td>${esc(s.ddo_code || '-')}</td>
      <td>${esc(s.coordinator_name || '-')}</td>
      <td>${esc([s.contact, s.email].filter(Boolean).join(' / ') || '-')}</td>
      <td class="text-center" style="white-space:nowrap;">
        <div class="action-btns">
          <button class="btn btn-sm" onclick="editSankul(${s.id})">✏️ Edit</button>
          <button class="btn btn-sm btn-danger" onclick="deleteSankul(${s.id})">🗑️ Delete</button>
        </div>
      </td>
    </tr>
  `).join('');

  document.getElementById('masterSchoolsTbody').innerHTML = state.schools.map((sc, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${esc(sc.name)}</strong></td>
      <td>${esc(sc.udise_code || '-')}</td>
      <td>${esc(sc.school_type)}</td>
      <td>${esc(sc.sankul_name)}</td>
      <td>${esc(sc.block_name)}</td>
      <td>${esc(sc.head_name || '-')}</td>
      <td class="text-center" style="white-space:nowrap;">
        <div class="action-btns">
          <button class="btn btn-sm" onclick="editSchool(${sc.id})">✏️ Edit</button>
          <button class="btn btn-sm btn-danger" onclick="deleteSchool(${sc.id})">🗑️ Delete</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function editBlock(id) {
  const b = state.blocks.find((x) => x.id === id);
  if (!b) return;
  document.getElementById('blkEditId').value = b.id;
  document.getElementById('blkName').value = b.name;
  document.getElementById('blkCode').value = b.code || '';
  document.getElementById('blkDdo').value = b.ddo_code || '';
  document.getElementById('blkContact').value = b.contact || '';
  document.getElementById('blkEmail').value = b.email || '';
  document.getElementById('blkSubmitBtn').textContent = 'अपडेट करें';
}
function resetBlockForm() {
  document.getElementById('blockForm').reset();
  document.getElementById('blkEditId').value = '';
  document.getElementById('blkSubmitBtn').textContent = 'विकासखंड सुरक्षित करें';
}
async function deleteBlock(id) {
  const b = state.blocks.find((x) => x.id === id);
  const name = b ? b.name : `#${id}`;
  if (!confirm(`"${name}" को हटाने से इसके अंतर्गत सभी संकुल, विद्यालय और कर्मचारी हट जाएंगे। क्या आप सुनिश्चित हैं?`)) return;
  await api(`/api/blocks/${id}`, { method: 'DELETE' });
  showToast('विकासखंड हटाया गया');
  await reloadAllMasters();
  await loadDashboard();
}

function editSankul(id) {
  const s = state.sankuls.find((x) => x.id === id);
  if (!s) return;
  document.getElementById('snkEditId').value = s.id;
  document.getElementById('snkBlockId').value = String(s.block_id);
  document.getElementById('snkName').value = s.name;
  document.getElementById('snkCode').value = s.code || '';
  document.getElementById('snkDdo').value = s.ddo_code || '';
  document.getElementById('snkCoord').value = s.coordinator_name || '';
  document.getElementById('snkContact').value = s.contact || '';
  document.getElementById('snkEmail').value = s.email || '';
  document.getElementById('snkSubmitBtn').textContent = 'अपडेट करें';
}
function resetSankulForm() {
  document.getElementById('sankulForm').reset();
  document.getElementById('snkEditId').value = '';
  document.getElementById('snkSubmitBtn').textContent = 'संकुल सुरक्षित करें';
}
async function deleteSankul(id) {
  const s = state.sankuls.find((x) => x.id === id);
  const name = s ? s.name : `#${id}`;
  if (!confirm(`"${name}" को हटाने से इसके अंतर्गत सभी विद्यालय और कर्मचारी हट जाएंगे। क्या आप सुनिश्चित हैं?`)) return;
  await api(`/api/sankuls/${id}`, { method: 'DELETE' });
  showToast('संकुल हटाया गया');
  await reloadAllMasters();
  await loadDashboard();
}

function editSchool(id) {
  const sc = state.schools.find((x) => x.id === id);
  if (!sc) return;
  document.getElementById('schEditId').value = sc.id;
  document.getElementById('schBlockId').value = String(sc.block_id);
  syncMasterSchoolSankuls();
  document.getElementById('schSankulId').value = String(sc.sankul_id);
  document.getElementById('schName').value = sc.name;
  document.getElementById('schUdise').value = sc.udise_code || '';
  document.getElementById('schType').value = sc.school_type || 'Primary';
  document.getElementById('schDdo').value = sc.ddo_code || '';
  document.getElementById('schHead').value = sc.head_name || '';
  document.getElementById('schSubmitBtn').textContent = 'अपडेट करें';
}
function resetSchoolForm() {
  document.getElementById('schoolForm').reset();
  document.getElementById('schEditId').value = '';
  document.getElementById('schSubmitBtn').textContent = 'विद्यालय सुरक्षित करें';
}
async function deleteSchool(id) {
  const sc = state.schools.find((x) => x.id === id);
  const name = sc ? sc.name : `#${id}`;
  if (!confirm(`"${name}" को हटाने से इसके अंतर्गत सभी कर्मचारी हट जाएंगे। क्या आप सुनिश्चित हैं?`)) return;
  await api(`/api/schools/${id}`, { method: 'DELETE' });
  showToast('विद्यालय हटाया गया');
  await reloadAllMasters();
  await loadDashboard();
}

// --- EXCEL (.XLS / .XLSX / .CSV) UPLOAD AT SCHOOL & SANKUL LEVEL ---
let currentImportLevel = 'school';

function setImportLevel(level) {
  currentImportLevel = level === 'sankul' ? 'sankul' : 'school';
  document.getElementById('impTabSchool').classList.toggle('active', currentImportLevel === 'school');
  document.getElementById('impTabSankul').classList.toggle('active', currentImportLevel === 'sankul');
  document.getElementById('impSchoolWrap').style.display = currentImportLevel === 'school' ? 'flex' : 'none';
  document.getElementById('btnDownloadTemplate').textContent =
    currentImportLevel === 'sankul'
      ? '📥 संकुल Excel टेम्पलेट (.xlsx)'
      : '📥 विद्यालय Excel टेम्पलेट (.xlsx)';
  document.getElementById('impLevelDesc').innerHTML =
    currentImportLevel === 'sankul'
      ? 'विकासखंड और संकुल चुनें, फिर पूरे संकुल की <strong>.xls, .xlsx या .csv</strong> फ़ाइल अपलोड करें। फ़ाइल में <strong>School Name</strong> कॉलम होने पर नए विद्यालय स्वतः बन जाएंगे।'
      : 'विकासखंड, संकुल और विद्यालय चुनें, फिर <strong>.xls, .xlsx या .csv</strong> फ़ाइल अपलोड करें। आप सीधे CGE प्रपत्र-01 की Excel फ़ाइल भी अपलोड कर सकते हैं।';
}

function openImportModal(level = 'school') {
  setImportLevel(level);
  document.getElementById('excelFileInput').value = '';
  document.getElementById('importPreviewMsg').textContent = '';
  if (state.blocks.length && !document.getElementById('impBlockId').value) {
    document.getElementById('impBlockId').value = String(state.blocks[0].id);
    syncImportSankuls();
  }
  document.getElementById('importModal').classList.add('open');
}

function closeImportModal() {
  document.getElementById('importModal').classList.remove('open');
}

function downloadExcelTemplate() {
  window.location.href = `/api/export/template?level=${currentImportLevel}`;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('फ़ाइल पढ़ने में त्रुटि'));
    reader.readAsDataURL(file);
  });
}

async function processExcelUpload() {
  const block_id = document.getElementById('impBlockId').value;
  const sankul_id = document.getElementById('impSankulId').value;
  const school_id = document.getElementById('impSchoolId').value;
  const file = document.getElementById('excelFileInput').files[0];

  if (!block_id || !sankul_id) {
    return showToast('कृपया पहले विकासखंड और संकुल चुनें', 'error');
  }
  if (currentImportLevel === 'school' && !school_id) {
    return showToast('कृपया विद्यालय चुनें', 'error');
  }
  if (!file) {
    return showToast('कृपया .xls, .xlsx या .csv फ़ाइल चुनें', 'error');
  }

  const btn = document.getElementById('btnStartUpload');
  const orig = btn.textContent;
  try {
    btn.disabled = true;
    btn.textContent = '⏳ अपलोड हो रहा है...';
    const fileBase64 = await fileToBase64(file);
    const res = await api('/api/staff/upload-excel', {
      method: 'POST',
      body: JSON.stringify({
        level: currentImportLevel,
        block_id: Number(block_id),
        sankul_id: Number(sankul_id),
        school_id: school_id ? Number(school_id) : null,
        filename: file.name,
        fileBase64
      })
    });

    const extra = res.schoolsCreated ? ` | नए विद्यालय जुड़े: ${res.schoolsCreated}` : '';
    const dupTxt = res.duplicatesSkipped ? ` | डुप्लिकेट छोड़े गए: ${res.duplicatesSkipped}` : '';
    const otherSkip = (res.skipped?.length || 0) - (res.duplicatesSkipped || 0);
    const skipTxt = otherSkip > 0 ? ` | अमान्य पंक्तियाँ: ${otherSkip}` : '';

    if (res.inserted === 0 && res.duplicatesSkipped > 0) {
      const msg = `⚠️ कोई नई एंट्री नहीं जोड़ी गई — सभी ${res.duplicatesSkipped} कर्मचारी पहले से दर्ज (Duplicate) हैं।`;
      document.getElementById('importPreviewMsg').textContent = msg;
      showToast(msg, 'error');
    } else {
      showToast(`✅ ${res.inserted} कर्मचारी अपलोड हुए${extra}${dupTxt}${skipTxt}`);
      closeImportModal();
    }
    await reloadAllMasters();
    await loadStaffList();
    await loadDashboard();
    if (state.currentView === 'cge') await loadCgeReport();
  } catch (err) {
    showToast(err.message, 'error');
    document.getElementById('importPreviewMsg').textContent = `त्रुटि: ${err.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
}

async function restoreBackup() {
  const file = document.getElementById('restoreFile').files[0];
  if (!file) return showToast('कृपया पहले .json बैकअप फ़ाइल चुनें', 'error');
  if (!confirm('चेतावनी: बैकअप रिस्टोर करने से वर्तमान डेटा बदल जाएगा। क्या आप आगे बढ़ना चाहते हैं?')) return;
  try {
    const json = JSON.parse(await file.text());
    const res = await api('/api/restore', { method: 'POST', body: JSON.stringify(json) });
    showToast(`डेटाबेस सफलतापूर्वक रिस्टोर हुआ (${res.restored} कर्मचारी)`);
    await reloadAllMasters();
    await loadDashboard();
    await loadStaffList();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function bindFormEvents() {
  document.getElementById('fltBlock').addEventListener('change', () => { syncFilterSankuls(); loadStaffList(); });
  document.getElementById('fltSankul').addEventListener('change', () => { syncFilterSchools(); loadStaffList(); });
  document.getElementById('fltSchool').addEventListener('change', loadStaffList);
  document.getElementById('fltEmpType').addEventListener('change', loadStaffList);
  document.getElementById('fltSearch').addEventListener('input', loadStaffList);

  document.getElementById('repSchBlock').addEventListener('change', () => { syncReportSchoolSankuls(); renderReportTables(); });
  document.getElementById('repSchSankul').addEventListener('change', renderReportTables);
  document.getElementById('repSnkBlock').addEventListener('change', renderReportTables);

  document.getElementById('cgeScope').addEventListener('change', () => { syncCgeDropdowns(); loadCgeReport(); });
  document.getElementById('cgeBlockId').addEventListener('change', () => { syncCgeDropdowns(); loadCgeReport(); });
  document.getElementById('cgeSankulId').addEventListener('change', () => { syncCgeDropdowns(); loadCgeReport(); });
  document.getElementById('cgeSchoolId').addEventListener('change', loadCgeReport);
  document.getElementById('cgeDisplayMode').addEventListener('change', renderCgePreview);

  document.getElementById('stBlockId').addEventListener('change', () => syncStaffModalSankuls());
  document.getElementById('stSankulId').addEventListener('change', () => syncStaffModalSchools());
  document.getElementById('schBlockId').addEventListener('change', syncMasterSchoolSankuls);
  document.getElementById('impBlockId').addEventListener('change', syncImportSankuls);
  document.getElementById('impSankulId').addEventListener('change', syncImportSchools);

  document.getElementById('staffForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn && submitBtn.disabled) return;
    if (submitBtn) submitBtn.disabled = true;
    const id = document.getElementById('stEditId').value;
    const payload = {
      block_id: Number(document.getElementById('stBlockId').value),
      sankul_id: Number(document.getElementById('stSankulId').value),
      school_id: Number(document.getElementById('stSchoolId').value),
      emp_code: document.getElementById('stEmpCode').value,
      emp_name: document.getElementById('stEmpName').value,
      gender: document.getElementById('stGender').value,
      caste: document.getElementById('stCaste').value,
      dob: document.getElementById('stDob').value,
      doj: document.getElementById('stDoj').value,
      designation: document.getElementById('stDesignation').value,
      emp_class: document.getElementById('stClass').value,
      pay_level: document.getElementById('stPayLevel').value,
      employment_type: document.getElementById('stEmpType').value,
      regular_status: document.getElementById('stRegStatus').value,
      non_regular_type: document.getElementById('stNonRegType').value,
      is_sanctioned: document.getElementById('stSanctioned').value,
      remark: document.getElementById('stRemark').value
    };
    try {
      await api(id ? `/api/staff/${id}` : '/api/staff', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      showToast(id ? 'कर्मचारी जानकारी अपडेट हुई' : 'नया कर्मचारी जोड़ा गया');
      closeStaffModal();
      await loadStaffList();
      await loadDashboard();
      if (state.currentView === 'cge') await loadCgeReport();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  document.getElementById('blockForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('blkEditId').value;
    const payload = {
      name: document.getElementById('blkName').value,
      code: document.getElementById('blkCode').value,
      ddo_code: document.getElementById('blkDdo').value,
      contact: document.getElementById('blkContact').value,
      email: document.getElementById('blkEmail').value
    };
    try {
      await api(id ? `/api/blocks/${id}` : '/api/blocks', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      showToast('विकासखंड सुरक्षित हुआ');
      resetBlockForm();
      await reloadAllMasters();
      await loadDashboard();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('sankulForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('snkEditId').value;
    const payload = {
      block_id: Number(document.getElementById('snkBlockId').value),
      name: document.getElementById('snkName').value,
      code: document.getElementById('snkCode').value,
      ddo_code: document.getElementById('snkDdo').value,
      coordinator_name: document.getElementById('snkCoord').value,
      contact: document.getElementById('snkContact').value,
      email: document.getElementById('snkEmail').value
    };
    try {
      await api(id ? `/api/sankuls/${id}` : '/api/sankuls', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      showToast('संकुल सुरक्षित हुआ');
      resetSankulForm();
      await reloadAllMasters();
      await loadDashboard();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('schoolForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('schEditId').value;
    const payload = {
      block_id: Number(document.getElementById('schBlockId').value),
      sankul_id: Number(document.getElementById('schSankulId').value),
      name: document.getElementById('schName').value,
      udise_code: document.getElementById('schUdise').value,
      school_type: document.getElementById('schType').value,
      ddo_code: document.getElementById('schDdo').value,
      head_name: document.getElementById('schHead').value
    };
    try {
      await api(id ? `/api/schools/${id}` : '/api/schools', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      showToast('विद्यालय सुरक्षित हुआ');
      resetSchoolForm();
      await reloadAllMasters();
      await loadDashboard();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({
          district_name: document.getElementById('setDistrict').value,
          census_date: document.getElementById('setCensusDate').value,
          department_name: document.getElementById('setDepartment').value,
          default_email: document.getElementById('setEmail').value,
          default_contact: document.getElementById('setContact').value
        })
      });
      showToast('सेटिंग्स सुरक्षित हुईं');
      await reloadAllMasters();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
