const API_BASE = '/api';

document.addEventListener('DOMContentLoaded', async () => {
    const ok = await requireAuth();
    if (!ok) return;
    setupMobileSidebar();
    setupRealtime();

    // Section navigation
    document.querySelectorAll('.nav-link[data-section]').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            const section = link.dataset.section;
            if (section === 'osm') loadMgmtOsmReport();
            else if (section === 'efficiency') loadMgmtEfficiencyReport();
            else if (section === 'worker-individual-eff') loadMgmtWorkerIndividualEff();
            else if (section === 'graphs') loadMgmtWorkerEfficiencyGraphs();
            else loadManagementDashboard();
        });
    });

    loadManagementDashboard();
});

async function requireAuth() {
    try {
        const response = await fetch('/auth/session', { credentials: 'include' });
        if (!response.ok) {
            window.location.href = '/';
            return false;
        }
        const result = await response.json();
        if (!result.success) {
            window.location.href = '/';
            return false;
        }
        return true;
    } catch (err) {
        window.location.href = '/';
        return false;
    }
}

function setupMobileSidebar() {
    const toggle = document.getElementById('sidebar-toggle');
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (!toggle || !sidebar || !overlay) return;

    toggle.addEventListener('click', () => {
        const isOpen = sidebar.classList.toggle('open');
        overlay.classList.toggle('active', isOpen);
    });

    overlay.addEventListener('click', () => {
        sidebar.classList.remove('open');
        overlay.classList.remove('active');
    });
}

let mgmtRealtimeTimer = null;
function setupRealtime() {
    const handleChange = (payload) => {
        if (!payload) return;
        const date = document.getElementById('mgmt-date')?.value;
        if (payload.work_date && date && payload.work_date !== date) {
            return;
        }
        if (payload.entity && !['progress', 'daily_plans', 'lines', 'products', 'employees', 'materials'].includes(payload.entity)) {
            return;
        }
        if (mgmtRealtimeTimer) clearTimeout(mgmtRealtimeTimer);
        mgmtRealtimeTimer = setTimeout(() => {
            mgmtRealtimeTimer = null;
            refreshManagementData();
            if (payload.entity === 'progress') {
                const lineId = document.getElementById('mgmt-line-select')?.value;
                if (payload.line_id && lineId && String(payload.line_id) !== String(lineId)) {
                    return;
                }
                const hourSelect = document.getElementById('mgmt-hour-select');
                if (hourSelect && payload.hour_slot !== undefined) {
                    hourSelect.value = String(payload.hour_slot);
                }
                refreshEmployeeEfficiency();
            }
        }, 300);
    };

    if (typeof SSEManager !== 'undefined') {
        SSEManager.init('/events');
        SSEManager.on('data_change', handleChange);
    } else {
        const source = new EventSource('/events');
        source.addEventListener('data_change', (event) => {
            let payload = {};
            try {
                payload = JSON.parse(event.data || '{}');
            } catch (err) {
                return;
            }
            handleChange(payload);
        });
        source.onerror = () => {
            source.close();
            setTimeout(setupRealtime, 3000);
        };
    }
}

async function loadManagementDashboard() {
    const content = document.getElementById('main-content');
    const today = new Date().toISOString().slice(0, 10);
    content.innerHTML = `
        <div class="page-header">
            <div>
                <h1 class="page-title">Management Dashboard</h1>
                <p class="page-subtitle">Performance overview and efficiency tracking</p>
            </div>
            <div class="ie-actions">
                <div class="ie-date">
                    <label for="mgmt-date">Date</label>
                    <input type="date" id="mgmt-date" value="${today}">
                </div>
                <button class="btn btn-secondary" id="mgmt-download">Download Daily</button>
                <div class="ie-date">
                    <label for="mgmt-start">Start</label>
                    <input type="date" id="mgmt-start" value="${today}">
                </div>
                <div class="ie-date">
                    <label for="mgmt-end">End</label>
                    <input type="date" id="mgmt-end" value="${today}">
                </div>
                <button class="btn btn-secondary" id="mgmt-download-range">Download Range</button>
            </div>
        </div>

        <div class="stats-grid" id="mgmt-stats"></div>

        <div class="card">
            <div class="card-header">
                <h3 class="card-title">Line Performance</h3>
            </div>
            <div class="card-body table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Line</th>
                            <th>Style</th>
                            <th>Target</th>
                            <th>Output</th>
                            <th>Efficiency</th>
                            <th>Completion</th>
                        </tr>
                    </thead>
                    <tbody id="mgmt-lines"></tbody>
                </table>
            </div>
        </div>

        <div class="card">
            <div class="card-header">
                <h3 class="card-title">Employee Efficiency</h3>
            </div>
            <div class="card-body">
                <div class="ie-settings">
                    <div>
                        <label class="form-label">Line</label>
                        <select class="form-control" id="mgmt-line-select"></select>
                    </div>
                    <div>
                        <label class="form-label">Hour</label>
                        <select class="form-control" id="mgmt-hour-select"></select>
                    </div>
                </div>
                <div class="table-container" style="margin-top: 16px;">
                    <table>
                        <thead>
                            <tr>
                                <th>Employee</th>
                                <th>Operation</th>
                                <th>Output</th>
                                <th>Rejection</th>
                                <th>Efficiency</th>
                            </tr>
                        </thead>
                        <tbody id="mgmt-employees"></tbody>
                    </table>
                </div>
            </div>
        </div>
        <div class="card">
            <div class="card-header">
                <h3 class="card-title">Final Stitching / Final QA Status</h3>
            </div>
            <div class="card-body table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Line</th>
                            <th>Final Stitching Done</th>
                            <th>Remaining</th>
                            <th>Final QA Done</th>
                            <th>QA Rejection</th>
                            <th>Remaining</th>
                        </tr>
                    </thead>
                    <tbody id="mgmt-final-status"></tbody>
                </table>
            </div>
        </div>
    `;

    document.getElementById('mgmt-date').addEventListener('change', refreshManagementData);
    document.getElementById('mgmt-download').addEventListener('click', downloadReport);
    document.getElementById('mgmt-download-range').addEventListener('click', downloadRangeReport);
    await loadLineOptions();
    loadHourOptions();
    refreshManagementData();
}

function downloadReport() {
    const date = document.getElementById('mgmt-date').value;
    window.location.href = `${API_BASE}/reports/daily?date=${date}`;
}

function downloadRangeReport() {
    const start = document.getElementById('mgmt-start').value;
    const end = document.getElementById('mgmt-end').value;
    if (!start || !end) {
        alert('Select start and end dates.');
        return;
    }
    if (end < start) {
        alert('End date must be on or after start date.');
        return;
    }
    window.location.href = `${API_BASE}/reports/range?start=${start}&end=${end}`;
}

async function loadLineOptions() {
    const select = document.getElementById('mgmt-line-select');
    if (!select) return;
    const response = await fetch(`${API_BASE}/lines`, { credentials: 'include' });
    const result = await response.json();
    if (!result.success) return;
    select.innerHTML = result.data
        .filter(line => line.is_active)
        .map(line => `<option value="${line.id}">${line.line_name}</option>`)
        .join('');
    select.addEventListener('change', refreshEmployeeEfficiency);
}

function loadHourOptions() {
    const select = document.getElementById('mgmt-hour-select');
    if (!select) return;
    const hourStart = 8;
    const hourEnd = 19;
    const now = new Date();
    const defaultHour = Math.min(Math.max(now.getHours(), hourStart), hourEnd);
    select.innerHTML = Array.from({ length: hourEnd - hourStart + 1 }).map((_, i) => {
        const value = hourStart + i;
        return `<option value="${value}" ${value === defaultHour ? 'selected' : ''}>${String(value).padStart(2, '0')}:00</option>`;
    }).join('');
    select.addEventListener('change', refreshEmployeeEfficiency);
}

async function mgmtSetLatestHour(lineId, date) {
    const select = document.getElementById('mgmt-hour-select');
    if (!select || !lineId || !date) return false;
    try {
        const response = await fetch(`${API_BASE}/supervisor/progress?line_id=${lineId}&work_date=${date}`, { credentials: 'include' });
        const result = await response.json();
        if (!result.success) return false;
        const rows = result.data || [];
        if (!rows.length) return false;
        const latest = rows.reduce((max, row) => Math.max(max, parseInt(row.hour_slot || 0, 10)), 0);
        if (latest) {
            select.value = String(latest);
            return true;
        }
    } catch (err) {
        return false;
    }
    return false;
}

async function refreshManagementData() {
    await Promise.all([
        loadLineMetrics(),
        refreshEmployeeEfficiency(),
        loadFinalStatus()
    ]);
}

async function loadLineMetrics() {
    const date = document.getElementById('mgmt-date').value;
    const stats = document.getElementById('mgmt-stats');
    const body = document.getElementById('mgmt-lines');
    const response = await fetch(`${API_BASE}/lines-metrics?date=${date}`, { credentials: 'include' });
    const result = await response.json();
    if (!result.success) return;

    const metrics = result.data || [];
    const totalOutput = metrics.reduce((sum, row) => sum + (parseInt(row.actual_output) || 0), 0);
    const totalTarget = metrics.reduce((sum, row) => sum + (parseInt(row.target) || 0), 0);
    const avgEfficiency = metrics.length
        ? (metrics.reduce((sum, row) => sum + (parseFloat(row.efficiency_percent) || 0), 0) / metrics.length).toFixed(2)
        : '0.00';

    stats.innerHTML = `
        <div class="stat-card">
            <div class="stat-info">
                <h3>${metrics.length}</h3>
                <p>Active Lines</p>
            </div>
        </div>
        <div class="stat-card">
            <div class="stat-info">
                <h3>${totalTarget}</h3>
                <p>Total Target</p>
            </div>
        </div>
        <div class="stat-card">
            <div class="stat-info">
                <h3>${totalOutput}</h3>
                <p>Total Output</p>
            </div>
        </div>
        <div class="stat-card">
            <div class="stat-info">
                <h3>${avgEfficiency}%</h3>
                <p>Avg Efficiency</p>
            </div>
        </div>
    `;

    body.innerHTML = metrics.map(row => `
        <tr>
            <td><strong>${row.line_name}</strong><div style="color: var(--secondary); font-size: 12px;">${row.line_code}</div></td>
            <td>
                ${row.product_code || '-'} ${row.product_name || ''}
                ${row.changeover ? `<div style="margin-top:2px;"><span style="background:#fef3c7;color:#92400e;padding:1px 6px;border-radius:3px;font-size:11px;font-weight:600;">CHANGEOVER</span><div style="font-size:11px;color:#92400e;margin-top:2px;">Incoming: ${row.incoming_product_code}</div></div>` : ''}
            </td>
            <td>${row.target}${row.changeover && row.incoming_target ? `<div style="font-size:11px;color:#92400e;">+${row.incoming_target}</div>` : ''}</td>
            <td>${row.actual_output}</td>
            <td>${row.efficiency_percent}%</td>
            <td>${row.completion_percent}%</td>
        </tr>
    `).join('');
}

async function refreshEmployeeEfficiency() {
    const lineId = document.getElementById('mgmt-line-select').value;
    const date = document.getElementById('mgmt-date').value;
    const hour = document.getElementById('mgmt-hour-select')?.value;
    const tbody = document.getElementById('mgmt-employees');
    if (!lineId) {
        tbody.innerHTML = '<tr><td colspan="5">Select a line</td></tr>';
        return;
    }
    const response = await fetch(`${API_BASE}/supervisor/employee-hourly-efficiency?line_id=${lineId}&date=${date}&hour=${hour}`, { credentials: 'include' });
    const result = await response.json();
    if (!result.success) {
        tbody.innerHTML = `<tr><td colspan="5">${result.error || 'No data'}</td></tr>`;
        return;
    }
    let employees = result.data || [];
    if (!employees.length) {
        const updated = await mgmtSetLatestHour(lineId, date);
        if (updated) {
            const retryHour = document.getElementById('mgmt-hour-select')?.value;
            const retryResponse = await fetch(`${API_BASE}/supervisor/employee-hourly-efficiency?line_id=${lineId}&date=${date}&hour=${retryHour}`, { credentials: 'include' });
            const retryResult = await retryResponse.json();
            if (retryResult.success) {
                employees = retryResult.data || [];
            }
        }
    }
    if (!employees.length) {
        tbody.innerHTML = '<tr><td colspan="5">No employee data</td></tr>';
        return;
    }
    tbody.innerHTML = employees.map(emp => `
        <tr>
            <td><strong>${emp.emp_code}</strong><div style="color: var(--secondary); font-size: 12px;">${emp.emp_name}</div></td>
            <td>${emp.operation_code} - ${emp.operation_name}</td>
            <td>${emp.total_output}</td>
            <td>${emp.total_rejection || 0}</td>
            <td>${emp.efficiency_percent || 0}%</td>
        </tr>
    `).join('');
}

async function loadFinalStatus() {
    const date = document.getElementById('mgmt-date').value;
    const tbody = document.getElementById('mgmt-final-status');
    if (!tbody) return;
    const response = await fetch(`${API_BASE}/lines-final-status?date=${date}`, { credentials: 'include' });
    const result = await response.json();
    if (!result.success) {
        tbody.innerHTML = `<tr><td colspan="6">${result.error || 'No data'}</td></tr>`;
        return;
    }
    const rows = result.data || [];
    if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="6">No data</td></tr>';
        return;
    }
    tbody.innerHTML = rows.map(row => `
        <tr>
            <td><strong>${row.line_name}</strong><div style="color: var(--secondary); font-size: 12px;">${row.line_code}</div></td>
            <td>${row.final_stitch_output}</td>
            <td>${row.final_stitch_remaining}</td>
            <td>${row.final_qa_output}</td>
            <td>${row.final_qa_rejection}</td>
            <td>${row.final_qa_remaining}</td>
        </tr>
    `).join('');
}

// ============================================================================
// OSM REPORT (Management Panel)
// ============================================================================
async function loadMgmtOsmReport() {
    const content = document.getElementById('main-content');
    const today = new Date().toISOString().slice(0, 10);
    content.innerHTML = `
        <div class="page-header">
            <div>
                <h1 class="page-title">Stagewise Hourly OSM Report</h1>
                <p class="page-subtitle">OSM observation points</p>
            </div>
        </div>
        <div style="display:flex;gap:0;border-bottom:2px solid #e5e7eb;margin-bottom:16px;">
            <button id="mgmt-osm-tab-daily" onclick="mgmtOsmSwitchTab('daily')"
                style="padding:8px 22px;font-size:13px;font-weight:600;border:none;background:#1e3a5f;color:#fff;cursor:pointer;border-radius:6px 6px 0 0;margin-right:4px;">
                Daily OSM
            </button>
            <button id="mgmt-osm-tab-range" onclick="mgmtOsmSwitchTab('range')"
                style="padding:8px 22px;font-size:13px;font-weight:600;border:none;background:#e5e7eb;color:#374151;cursor:pointer;border-radius:6px 6px 0 0;">
                Date to Date
            </button>
        </div>
        <div id="mgmt-osm-ctrl-daily" style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;margin-bottom:16px;">
            <div class="ie-date"><label>Line</label>
                <select id="mgmt-osm-line-daily" class="form-control" style="min-width:180px;" onchange="refreshMgmtOsmReport()"></select>
            </div>
            <div class="ie-date"><label>Date</label>
                <input type="date" id="mgmt-osm-date-daily" value="${today}" onchange="refreshMgmtOsmReport()">
            </div>
            <button class="btn btn-secondary" onclick="refreshMgmtOsmReport()">Refresh</button>
            <button class="btn btn-secondary" onclick="printMgmtOsmReport()">&#9113; Print</button>
            <button class="btn btn-secondary" onclick="downloadMgmtOsmExcel()" style="background:#1d6f42;color:#fff;border-color:#1d6f42;">&#8595; Excel</button>
        </div>
        <div id="mgmt-osm-ctrl-range" style="display:none;flex-wrap:wrap;gap:8px;align-items:flex-end;margin-bottom:16px;">
            <div class="ie-date"><label>Line</label>
                <select id="mgmt-osm-line-range" class="form-control" style="min-width:180px;" onchange="refreshMgmtOsmRangeReport()"></select>
            </div>
            <div class="ie-date"><label>From</label>
                <input type="date" id="mgmt-osm-from-range" value="${today}" onchange="refreshMgmtOsmRangeReport()">
            </div>
            <div class="ie-date"><label>To</label>
                <input type="date" id="mgmt-osm-to-range" value="${today}" onchange="refreshMgmtOsmRangeReport()">
            </div>
            <button class="btn btn-secondary" onclick="refreshMgmtOsmRangeReport()">Refresh</button>
            <button class="btn btn-secondary" onclick="printMgmtOsmReport()">&#9113; Print</button>
        </div>
        <div id="osm-content">
            <div style="text-align:center;padding:40px;color:var(--secondary);">Select a line to load the report.</div>
        </div>
    `;

    try {
        const r = await fetch(`${API_BASE}/lines`, { credentials: 'include' });
        const result = await r.json();
        if (result.success) {
            const opts = '<option value="">-- Select Line --</option>' +
                result.data.filter(l => l.is_active).map(l =>
                    `<option value="${l.id}">${l.line_name} (${l.line_code})</option>`
                ).join('');
            document.getElementById('mgmt-osm-line-daily').innerHTML = opts;
            document.getElementById('mgmt-osm-line-range').innerHTML = opts;
        }
    } catch (e) { /* ignore */ }
}

function mgmtOsmSwitchTab(tab) {
    const isDaily = tab === 'daily';
    document.getElementById('mgmt-osm-tab-daily').style.background = isDaily ? '#1e3a5f' : '#e5e7eb';
    document.getElementById('mgmt-osm-tab-daily').style.color = isDaily ? '#fff' : '#374151';
    document.getElementById('mgmt-osm-tab-range').style.background = isDaily ? '#e5e7eb' : '#1e3a5f';
    document.getElementById('mgmt-osm-tab-range').style.color = isDaily ? '#374151' : '#fff';
    document.getElementById('mgmt-osm-ctrl-daily').style.display = isDaily ? 'flex' : 'none';
    document.getElementById('mgmt-osm-ctrl-range').style.display = isDaily ? 'none' : 'flex';
    document.getElementById('osm-content').innerHTML =
        '<div style="text-align:center;padding:40px;color:var(--secondary);">Select a line to load the report.</div>';
}

async function refreshMgmtOsmReport() {
    const lineId = document.getElementById('mgmt-osm-line-daily')?.value;
    const date   = document.getElementById('mgmt-osm-date-daily')?.value;
    const container = document.getElementById('osm-content');
    if (!container) return;
    if (!lineId) {
        container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--secondary);">Select a line to load the report.</div>';
        return;
    }
    container.innerHTML = '<div style="text-align:center;padding:40px;"><div class="spinner" style="display:inline-block;"></div></div>';
    try {
        const r = await fetch(`${API_BASE}/osm-report?line_id=${lineId}&to_date=${date}`, { credentials: 'include' });
        const data = await r.json();
        if (!data.success) {
            container.innerHTML = `<div class="card"><div class="card-body" style="color:#dc2626;">${data.error || 'Failed'}</div></div>`;
            return;
        }
        if (data.no_osm_points || !data.osm_points?.length) {
            container.innerHTML = `<div class="card"><div class="card-body" style="text-align:center;padding:40px;color:var(--secondary);">
                No OSM points configured for <strong>${data.line_name}</strong>.<br>Ask IE/Admin to check OSM on relevant processes.
            </div></div>`;
            return;
        }
        container.innerHTML = _buildMgmtOsmTable(data);
    } catch (err) {
        container.innerHTML = `<div class="card"><div class="card-body" style="color:#dc2626;">Error: ${err.message}</div></div>`;
    }
}

async function refreshMgmtOsmRangeReport() {
    const lineId   = document.getElementById('mgmt-osm-line-range')?.value;
    const fromDate = document.getElementById('mgmt-osm-from-range')?.value;
    const toDate   = document.getElementById('mgmt-osm-to-range')?.value;
    const container = document.getElementById('osm-content');
    if (!container) return;
    if (!lineId || !fromDate || !toDate) {
        container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--secondary);">Select a line and date range.</div>';
        return;
    }
    container.innerHTML = '<div style="text-align:center;padding:40px;"><div class="spinner" style="display:inline-block;"></div></div>';
    try {
        const r = await fetch(`${API_BASE}/osm-report-range?line_id=${lineId}&from_date=${fromDate}&to_date=${toDate}`, { credentials: 'include' });
        const data = await r.json();
        if (!data.success) {
            container.innerHTML = `<div class="card"><div class="card-body" style="color:#dc2626;">${data.error || 'Failed'}</div></div>`;
            return;
        }
        if (data.no_osm_points || !data.osm_points?.length) {
            container.innerHTML = `<div class="card"><div class="card-body" style="text-align:center;padding:40px;color:var(--secondary);">
                No OSM points configured for <strong>${data.line_name}</strong>.
            </div></div>`;
            return;
        }
        container.innerHTML = _buildMgmtOsmRangeTable(data);
    } catch (err) {
        container.innerHTML = `<div class="card"><div class="card-body" style="color:#dc2626;">Error: ${err.message}</div></div>`;
    }
}

function _buildMgmtOsmTable(data) {
    const { osm_points, target_units, total_target, working_hours, in_time, out_time, to_date, buyer_name, product_code, product_name } = data;
    const toDate = to_date || data.date;
    const inH  = parseInt((in_time  || '08:00').split(':')[0]);
    const outH = parseInt((out_time || '17:00').split(':')[0]);

    const hours = [];
    for (let h = inH; h < outH; h++) hours.push(h);

    const perHourTarget = (working_hours > 0 && target_units > 0)
        ? Math.round(target_units / working_hours) : 0;

    let maxDataHour = -1;
    for (const pt of osm_points) {
        for (const h of Object.keys(pt.hourly || {})) {
            const hInt = parseInt(h);
            if (hInt > maxDataHour) maxDataHour = hInt;
        }
    }
    const elapsedHours = maxDataHour >= inH ? hours.filter(h => h <= maxDataHour).length : 0;
    const totalTargetSoFar = elapsedHours * perHourTarget;

    const ordinals = ['1ST','2ND','3RD','4TH','5TH','6TH','7TH','8TH','9TH','10TH','11TH','12TH'];
    const thS = 'background:#1e3a5f;color:#fff;padding:5px 6px;text-align:center;white-space:nowrap;font-size:11px;border:1px solid #0f2744;';
    const tdS = 'padding:4px 6px;border:1px solid #d1d5db;font-size:12px;';
    const tcS = tdS + 'text-align:center;';

    const hourHeaders = hours.map((_, i) =>
        `<th style="${thS}min-width:52px;">${ordinals[i] || (i+1)+'TH'}<br>HOUR</th>`
    ).join('');
    const targetRow = hours.map(() =>
        `<td style="${tcS}font-weight:700;">${perHourTarget}</td>`
    ).join('');

    const dataRows = osm_points.map(pt => {
        const hourCells = hours.map(h => {
            const d = (pt.hourly || {})[h];
            const qty = (d && d.quantity != null) ? d.quantity : '';
            return `<td style="${tcS}">${qty}</td>`;
        }).join('');

        const todayOutput = Object.values(pt.hourly || {}).reduce((s, d) => s + (d.quantity || 0), 0);

        let combinedBacklog = 0;
        for (const h of hours.filter(h => h <= maxDataHour)) {
            const qty = (pt.hourly || {})[h]?.quantity || 0;
            if (qty < perHourTarget) combinedBacklog += (qty - perHourTarget);
        }
        const backlog = combinedBacklog < 0 ? combinedBacklog : 0;

        let combinedExtra = 0;
        for (const h of hours.filter(h => h <= maxDataHour)) {
            const qty = (pt.hourly || {})[h]?.quantity || 0;
            if (qty > perHourTarget) combinedExtra += (qty - perHourTarget);
        }
        const extra = combinedExtra > 0 ? combinedExtra : 0;
        const balToProd = totalTargetSoFar - todayOutput;
        const orderBalProd = (total_target || 0) - (pt.cumulative_output || 0);
        const remainingDays = (target_units > 0 && orderBalProd > 0)
            ? Math.ceil(orderBalProd / target_units) : 0;

        const reasons = [...new Set(
            Object.values(pt.hourly || {}).map(d => d.shortfall_reason).filter(Boolean)
        )].join('; ');

        return `<tr>
            <td style="${tcS}font-weight:700;color:#1e3a5f;">${pt.osm_label}</td>
            <td style="${tcS}font-weight:600;">${pt.cumulative_output != null ? pt.cumulative_output : '-'}</td>
            <td style="${tcS}font-size:11px;min-width:180px;max-width:260px;white-space:normal;word-break:break-word;">${pt.operation_code} — ${pt.operation_name}</td>
            ${hourCells}
            <td style="${tcS}font-weight:700;">${totalTargetSoFar}</td>
            <td style="${tcS}font-weight:700;">${todayOutput}</td>
            <td style="${tcS}font-weight:700;color:#dc2626;">${backlog < 0 ? backlog : ''}</td>
            <td style="${tcS}font-weight:700;color:#16a34a;">${extra > 0 ? '+'+extra : ''}</td>
            <td style="${tcS}font-weight:700;color:${balToProd > 0 ? '#dc2626' : '#16a34a'};">${balToProd}</td>
            <td style="${tcS}font-weight:700;color:${orderBalProd > 0 ? '#dc2626' : '#16a34a'};">${orderBalProd}</td>
            <td style="${tcS}font-weight:700;color:${remainingDays > 0 ? '#b45309' : '#16a34a'};">${remainingDays}</td>
            <td style="${tdS}font-size:11px;">${reasons}</td>
        </tr>`;
    }).join('');

    return `<div class="card" id="mgmt-osm-print-area"
        data-buyer="${(buyer_name||'').replace(/"/g,'&quot;')}"
        data-style="${(product_code||'').replace(/"/g,'&quot;')}"
        data-from="${toDate}"
        data-to="${toDate}">
        <div class="card-header"><div>
            <h3 class="card-title">STAGEWISE HOURLY OSM REPORT — DAILY</h3>
            <div style="font-size:12px;color:var(--secondary);margin-top:2px;">
                ${data.line_name} (${data.line_code}) &nbsp;&bull;&nbsp; Style: ${product_code} — ${product_name}
                &nbsp;&bull;&nbsp; Date: ${toDate} &nbsp;&bull;&nbsp; Daily Target: ${target_units}
                &nbsp;&bull;&nbsp; Per Hour: ${perHourTarget} &nbsp;&bull;&nbsp; Target as on time: ${totalTargetSoFar}
            </div>
        </div></div>
        <div class="card-body" style="overflow-x:auto;padding:0;">
            <table style="border-collapse:collapse;white-space:nowrap;width:100%;">
                <thead>
                    <tr>
                        <th style="${thS}min-width:60px;">OSM<br>POINT</th>
                        <th style="${thS}min-width:90px;">CUMULATIVE<br>OUTPUT</th>
                        <th style="${thS}min-width:200px;white-space:normal;">PROCESS DETAILS</th>
                        ${hourHeaders}
                        <th style="${thS}min-width:80px;white-space:normal;">TOTAL TARGET<br>(AS ON TIME)</th>
                        <th style="${thS}min-width:80px;">TOTAL OUTPUT<br>(AS ON TIME)</th>
                        <th style="${thS}min-width:65px;">B.LOG</th>
                        <th style="${thS}min-width:75px;">EXTRA<br>PRODUCED</th>
                        <th style="${thS}min-width:90px;white-space:normal;">BAL TO PROD<br>(TODAY'S TARGET)</th>
                        <th style="${thS}min-width:90px;white-space:normal;">ORDER BAL<br>PROD</th>
                        <th style="${thS}min-width:80px;white-space:normal;">REMAINING<br>DAYS</th>
                        <th style="${thS}min-width:120px;white-space:normal;">REASON</th>
                    </tr>
                    <tr style="background:#dbeafe;">
                        <td colspan="3" style="${tdS}text-align:right;font-weight:700;padding:4px 10px;">TARGET / HOUR</td>
                        ${targetRow}
                        <td style="${tcS}font-weight:700;">${target_units}</td>
                        <td colspan="6" style="${tdS}"></td>
                    </tr>
                </thead>
                <tbody>${dataRows}</tbody>
            </table>
        </div>
    </div>`;
}

function _buildMgmtOsmRangeTable(data) {
    const { osm_points, range_target, day_count, from_date, to_date, buyer_name, product_code, product_name, target_units } = data;
    const thS = 'background:#1e3a5f;color:#fff;padding:5px 6px;text-align:center;white-space:nowrap;font-size:11px;border:1px solid #0f2744;';
    const tdS = 'padding:4px 6px;border:1px solid #d1d5db;font-size:12px;';
    const tcS = tdS + 'text-align:center;';

    const dataRows = osm_points.map(pt => {
        const blog = pt.blog;
        const balToProd = range_target - pt.total_output;
        const orderBalProd = (total_target || 0) - pt.total_output;
        const remainingDays = (target_units > 0 && orderBalProd > 0)
            ? Math.ceil(orderBalProd / target_units) : 0;
        return `<tr>
            <td style="${tcS}font-weight:700;">${pt.workstation_number || ''}</td>
            <td style="${tcS}font-weight:700;color:#1e3a5f;">${pt.osm_label}</td>
            <td style="${tcS}font-weight:600;">${pt.workstation_code}</td>
            <td style="${tdS}font-size:11px;min-width:180px;max-width:260px;white-space:normal;word-break:break-word;">${pt.operation_code} — ${pt.operation_name}</td>
            <td style="${tcS}font-weight:700;">${range_target}</td>
            <td style="${tcS}font-weight:700;">${pt.total_output}</td>
            <td style="${tcS}font-weight:700;color:#dc2626;">${blog < 0 ? blog : ''}</td>
            <td style="${tcS}font-weight:700;color:${balToProd > 0 ? '#dc2626' : '#16a34a'};">${balToProd}</td>
            <td style="${tcS}font-weight:700;color:${orderBalProd > 0 ? '#dc2626' : '#16a34a'};">${orderBalProd}</td>
            <td style="${tcS}font-weight:700;color:${remainingDays > 0 ? '#b45309' : '#16a34a'};">${remainingDays}</td>
            <td style="${tdS}font-size:11px;white-space:normal;word-break:break-word;">${pt.reasons || ''}</td>
        </tr>`;
    }).join('');

    return `<div class="card" id="mgmt-osm-print-area"
        data-buyer="${(buyer_name||'').replace(/"/g,'&quot;')}"
        data-style="${(product_code||'').replace(/"/g,'&quot;')}"
        data-from="${from_date}"
        data-to="${to_date}">
        <div class="card-header"><div>
            <h3 class="card-title">STAGEWISE OSM REPORT — DATE TO DATE</h3>
            <div style="font-size:12px;color:var(--secondary);margin-top:2px;">
                ${data.line_name} (${data.line_code}) &nbsp;&bull;&nbsp; Style: ${product_code} — ${product_name}
                &nbsp;&bull;&nbsp; ${from_date} → ${to_date} &nbsp;&bull;&nbsp; Days: ${day_count}
                &nbsp;&bull;&nbsp; Daily Target: ${target_units} &nbsp;&bull;&nbsp; Range Target: ${range_target}
            </div>
        </div></div>
        <div class="card-body" style="overflow-x:auto;padding:0;">
            <table style="border-collapse:collapse;white-space:nowrap;width:100%;">
                <thead><tr>
                    <th style="${thS}min-width:60px;">GROUP</th>
                    <th style="${thS}min-width:55px;">OSM</th>
                    <th style="${thS}min-width:60px;">WORK<br>STATION</th>
                    <th style="${thS}min-width:200px;white-space:normal;">PROCESS DETAILS</th>
                    <th style="${thS}min-width:80px;white-space:normal;">TOTAL TARGET<br>(${from_date} – ${to_date})</th>
                    <th style="${thS}min-width:80px;white-space:normal;">TOTAL OUTPUT<br>(${from_date} – ${to_date})</th>
                    <th style="${thS}min-width:65px;">B.LOG</th>
                    <th style="${thS}min-width:90px;white-space:normal;">BAL TO PROD</th>
                    <th style="${thS}min-width:90px;white-space:normal;">ORDER BAL<br>PROD</th>
                    <th style="${thS}min-width:80px;white-space:normal;">REMAINING<br>DAYS</th>
                    <th style="${thS}min-width:160px;white-space:normal;">REASON</th>
                </tr></thead>
                <tbody>${dataRows}</tbody>
            </table>
        </div>
    </div>`;
}

function printMgmtOsmReport() {
    const area = document.getElementById('mgmt-osm-print-area');
    if (!area) { alert('No report loaded.'); return; }
    const buyer  = area.dataset.buyer  || '';
    const style  = area.dataset.style  || '';
    const fromDt = area.dataset.from   || '';
    const toDt   = area.dataset.to     || '';
    const parts  = [buyer, style, 'OSM', fromDt, toDt !== fromDt ? toDt : ''].filter(Boolean);
    const title  = parts.join(' - ');
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;left:-9999px;top:0;width:1400px;height:1000px;border:0;visibility:hidden;';
    iframe.srcdoc = `<!DOCTYPE html><html><head><title>${title}</title><style>
        *{box-sizing:border-box;margin:0;padding:0;}
        body{font-family:Arial,sans-serif;color:#111;background:#fff;}
        .card{border:none;}.card-header{padding:6px 10px;background:#f8fafc;border-bottom:1px solid #e5e7eb;}
        .card-title{font-size:12px;font-weight:700;margin:0 0 2px;}.card-header div{font-size:9px;}
        .card-body{padding:0;overflow:visible;}
        table{border-collapse:collapse;width:100%;table-layout:auto;}
        th,td{padding:2px 4px!important;font-size:8px!important;white-space:normal!important;min-width:0!important;max-width:none!important;word-break:break-word;border:1px solid #ccc!important;}
        th{background:#1e3a5f!important;color:#fff!important;font-weight:700;text-align:center;}
        @media print{@page{size:A4 landscape;margin:5mm;}body{margin:0;padding:0;}}
    </style></head><body>${area.outerHTML}</body></html>`;
    iframe.onload = function() {
        setTimeout(() => {
            const doc = iframe.contentDocument;
            const printArea = doc.getElementById('mgmt-osm-print-area');
            const table = doc.querySelector('table');
            if (table && printArea) {
                const pageW = 1084;
                const tableW = table.offsetWidth;
                if (tableW > pageW) printArea.style.zoom = (pageW / tableW).toFixed(4);
            }
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
            setTimeout(() => document.body.removeChild(iframe), 2000);
        }, 250);
    };
    document.body.appendChild(iframe);
}

function downloadMgmtOsmExcel() {
    const area = document.getElementById('mgmt-osm-print-area');
    if (!area) { alert('No report loaded.'); return; }
    const fromDt = area.dataset.from || '';
    const toDt   = area.dataset.to   || '';
    const style  = area.dataset.style || 'OSM';
    const filename = `OSM_${style.replace(/[^a-zA-Z0-9]/g,'_')}_${fromDt}_${toDt}.xls`;
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
        <head><meta charset="UTF-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets>
        <x:ExcelWorksheet><x:Name>OSM</x:Name></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
        <style>table{border-collapse:collapse;}th,td{border:1px solid #999;padding:4px 6px;font-size:11px;font-family:Arial,sans-serif;}
        th{background:#1e3a5f;color:#fff;font-weight:bold;}</style></head><body>${area.innerHTML}</body></html>`;
    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ============================================================================
// EFFICIENCY REPORT
// ============================================================================
async function loadMgmtEfficiencyReport() {
    const content = document.getElementById('main-content');
    const today = new Date().toISOString().slice(0, 10);
    content.innerHTML = `
        <div class="page-header">
            <div>
                <h1 class="page-title">Efficiency Report</h1>
                <p class="page-subtitle">Line Efficiency &amp; Worker Efficiency per workstation</p>
            </div>
            <div class="ie-actions" style="flex-wrap:wrap;gap:8px;">
                <div class="ie-date">
                    <label for="mgmt-eff-line">Line</label>
                    <select id="mgmt-eff-line" class="form-control" style="min-width:180px;"></select>
                </div>
                <div class="ie-date">
                    <label for="mgmt-eff-date">Date</label>
                    <input type="date" id="mgmt-eff-date" value="${today}">
                </div>
                <button class="btn btn-secondary" onclick="refreshMgmtEfficiencyReport()">Refresh</button>
                <button class="btn btn-secondary" onclick="printMgmtEfficiencyReport()">&#9113; Print</button>
                <button class="btn btn-secondary" onclick="downloadMgmtEfficiencyExcel()" style="background:#1d6f42;color:#fff;border-color:#1d6f42;">&#8595; Excel</button>
            </div>
        </div>
        <div id="mgmt-eff-content">
            <div style="text-align:center;padding:40px;color:var(--secondary);">Select a line to load the report.</div>
        </div>
    `;

    try {
        const r = await fetch(`${API_BASE}/lines`, { credentials: 'include' });
        const result = await r.json();
        if (result.success) {
            const sel = document.getElementById('mgmt-eff-line');
            sel.innerHTML = '<option value="">-- Select Line --</option>' +
                result.data.filter(l => l.is_active).map(l =>
                    `<option value="${l.id}">${l.line_name} (${l.line_code})</option>`
                ).join('');
            sel.addEventListener('change', refreshMgmtEfficiencyReport);
        }
    } catch (e) { /* ignore */ }

    document.getElementById('mgmt-eff-date').addEventListener('change', refreshMgmtEfficiencyReport);
}

async function refreshMgmtEfficiencyReport() {
    const lineId = document.getElementById('mgmt-eff-line')?.value;
    const date   = document.getElementById('mgmt-eff-date')?.value;
    const container = document.getElementById('mgmt-eff-content');
    if (!container) return;

    if (!lineId) {
        container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--secondary);">Select a line to load the report.</div>';
        return;
    }

    container.innerHTML = '<div style="text-align:center;padding:40px;"><div class="spinner" style="display:inline-block;"></div></div>';

    try {
        const r = await fetch(`${API_BASE}/efficiency-report?line_id=${lineId}&date=${date}`, { credentials: 'include' });
        const resp = await r.json();

        if (!resp.success) {
            container.innerHTML = `<div class="card"><div class="card-body" style="color:#dc2626;">${resp.error || 'Failed to load report'}</div></div>`;
            return;
        }
        if (!resp.data) {
            container.innerHTML = `<div class="card"><div class="card-body" style="text-align:center;padding:40px;color:var(--secondary);">${resp.message || 'No plan found for this line on the selected date.'}</div></div>`;
            return;
        }
        if (!resp.data.workstations?.length) {
            container.innerHTML = `<div class="card"><div class="card-body" style="text-align:center;padding:40px;color:var(--secondary);">No workstation plan found for <strong>${resp.data.line.line_name}</strong> on <strong>${date}</strong>.<br>Upload a line plan or generate workstations first.</div></div>`;
            return;
        }

        container.innerHTML = _buildMgmtEfficiencyTable(resp.data, date);
    } catch (err) {
        container.innerHTML = `<div class="card"><div class="card-body" style="color:#dc2626;">Error: ${err.message}</div></div>`;
    }
}

function _buildMgmtEfficiencyTable(data, date) {
    const { line, plan, summary, ot_summary, workstations } = data;
    const thS = 'background:#1e3a5f;color:#fff;padding:5px 6px;text-align:center;white-space:nowrap;font-size:11px;border:1px solid #0f2744;';
    const tdS = 'padding:4px 6px;border:1px solid #d1d5db;font-size:12px;';
    const tcS = tdS + 'text-align:center;';

    const le = summary.line_efficiency_pct;
    const leColor = le === null ? '#6b7280' : le >= 75 ? '#16a34a' : le >= 50 ? '#d97706' : '#dc2626';
    const leText = le === null ? 'N/A' : le.toFixed(2) + '%';

    const summaryBar = `
        <div style="display:flex;flex-wrap:wrap;gap:12px;padding:12px 16px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px;margin-bottom:12px;align-items:center;">
            <span style="font-size:12px;"><strong>Style:</strong> ${plan.product_code || '-'} — ${plan.product_name || '-'}</span>
            <span style="font-size:12px;"><strong>Style SAH:</strong> ${plan.style_sah.toFixed(4)} h</span>
            <span style="font-size:12px;"><strong>Manpower:</strong> ${summary.manpower}</span>
            <span style="font-size:12px;"><strong>Working Hours:</strong> ${plan.working_hours.toFixed(1)} h</span>
            <span style="font-size:12px;"><strong>Takt Time:</strong> ${plan.takt_time_seconds} s</span>
            <span style="font-size:12px;"><strong>Line Output:</strong> ${summary.line_output}</span>
            <span style="font-size:12px;"><strong>Target:</strong> ${plan.target_units}</span>
            ${summary.total_ot_hours > 0 ? `<span style="font-size:12px;"><strong>Total OT Hours:</strong> ${summary.total_ot_hours.toFixed(2)} h</span>` : ''}
            <span style="font-size:14px;font-weight:700;color:${leColor};margin-left:auto;">LINE EFFICIENCY: ${leText}</span>
        </div>`;

    const otRow = ot_summary ? `
        <tr style="background:#fef9c3;">
            <td colspan="10" style="${tdS}font-size:12px;font-weight:600;text-align:center;">
                OT: ${ot_summary.active_ot_workstations} active workstations
                &nbsp;&bull;&nbsp; OT Output: ${ot_summary.total_ot_output}
                &nbsp;&bull;&nbsp; OT Target: ${ot_summary.ot_target_units}
            </td>
        </tr>` : '';

    const dataRows = workstations.map(ws => {
        const wl = parseFloat(ws.workload_pct || 0);
        const wlColor = wl >= 100 ? '#dc2626' : wl >= 80 ? '#d97706' : '#16a34a';
        const wlBg    = wl >= 100 ? '#fee2e2' : wl >= 80 ? '#fef3c7' : '#dcfce7';

        const we = ws.worker_efficiency_pct;
        let weText, weColor, weBg;
        if (we === null || !ws.employee_code) {
            weText = '—'; weColor = '#6b7280'; weBg = '#f9fafb';
        } else {
            weText = we.toFixed(2) + '%';
            weColor = we >= 75 ? '#16a34a' : we >= 50 ? '#d97706' : '#dc2626';
            weBg    = we >= 75 ? '#dcfce7'  : we >= 50 ? '#fef3c7'  : '#fee2e2';
        }

        return `<tr>
            <td style="${tcS}font-weight:600;">${ws.group_name || '-'}</td>
            <td style="${tcS}font-weight:600;">${ws.workstation_code}</td>
            <td style="${tdS}">${ws.employee_code ? `${ws.employee_name} (${ws.employee_code})` : '<span style="color:#9ca3af;">Unassigned</span>'}</td>
            <td style="${tcS}">${ws.actual_sam_seconds.toFixed(2)}</td>
            <td style="${tcS}">${ws.takt_time_seconds.toFixed(0)}</td>
            <td style="${tcS}font-weight:700;color:${wlColor};background:${wlBg};">${wl.toFixed(1)}%</td>
            <td style="${tcS}font-weight:700;">${ws.regular_output}</td>
            <td style="${tcS}color:#7c3aed;">${ws.ot_minutes > 0 ? ws.ot_minutes.toFixed(0) + ' min' : '—'}</td>
            <td style="${tcS}color:#7c3aed;">${ws.ot_output > 0 ? ws.ot_output : '—'}</td>
            <td style="${tcS}font-weight:700;color:${weColor};background:${weBg};">${weText}</td>
        </tr>`;
    }).join('');

    return `<div id="mgmt-efficiency-print-area">
        <div class="card">
            <div class="card-header">
                <div>
                    <h3 class="card-title">EFFICIENCY REPORT</h3>
                    <div style="font-size:12px;color:var(--secondary);margin-top:2px;">
                        ${line.line_name} (${line.line_code})
                        &nbsp;&bull;&nbsp; Date: ${date}
                    </div>
                </div>
            </div>
            <div class="card-body">
                ${summaryBar}
                <div style="overflow-x:auto;">
                    <table style="border-collapse:collapse;width:100%;white-space:nowrap;">
                        <thead>
                            <tr>
                                <th style="${thS}min-width:60px;">GROUP</th>
                                <th style="${thS}min-width:70px;">WS</th>
                                <th style="${thS}min-width:160px;white-space:normal;">EMPLOYEE</th>
                                <th style="${thS}min-width:80px;">CYCLE TIME<br>(s)</th>
                                <th style="${thS}min-width:75px;">TAKT TIME<br>(s)</th>
                                <th style="${thS}min-width:70px;">WKLD%</th>
                                <th style="${thS}min-width:70px;">OUTPUT</th>
                                <th style="${thS}min-width:70px;">OT MIN</th>
                                <th style="${thS}min-width:75px;">OT OUTPUT</th>
                                <th style="${thS}min-width:90px;">WORKER EFF%</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${dataRows}
                            ${otRow}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    </div>`;
}

function printMgmtEfficiencyReport() {
    const area = document.getElementById('mgmt-efficiency-print-area');
    if (!area) { alert('No report loaded.'); return; }
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;';
    iframe.srcdoc = `<!DOCTYPE html><html><head><style>
        *{box-sizing:border-box;margin:0;padding:0;}
        body{font-family:Arial,sans-serif;font-size:11px;color:#111;padding:8mm;}
        .card{border:1px solid #d1d5db;border-radius:4px;overflow:hidden;}
        .card-header{padding:10px 14px;background:#f8fafc;border-bottom:1px solid #e5e7eb;}
        .card-title{font-size:14px;font-weight:700;margin:0 0 4px;}
        .card-body{padding:8px;}
        table{border-collapse:collapse;width:100%;}
        @media print{@page{size:A4 landscape;margin:8mm;}body{padding:0;}}
    </style></head><body>${area.outerHTML}</body></html>`;
    iframe.onload = function() {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
        setTimeout(() => { document.body.removeChild(iframe); }, 1000);
    };
    document.body.appendChild(iframe);
}

function downloadMgmtEfficiencyExcel() {
    const area = document.getElementById('mgmt-efficiency-print-area');
    if (!area) { alert('No report loaded.'); return; }
    const sel = document.getElementById('mgmt-eff-line');
    const lineText = sel ? (sel.options[sel.selectedIndex]?.text || '') : '';
    const date = document.getElementById('mgmt-eff-date')?.value || '';
    const filename = `Efficiency_${lineText.replace(/[^a-zA-Z0-9]/g, '_')}_${date}.xls`;
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office"
        xmlns:x="urn:schemas-microsoft-com:office:excel"
        xmlns="http://www.w3.org/TR/REC-html40">
        <head><meta charset="UTF-8">
        <!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets>
        <x:ExcelWorksheet><x:Name>Efficiency</x:Name>
        <x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
        </x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
        <style>
            table { border-collapse: collapse; }
            th, td { border: 1px solid #999; padding: 4px 6px; font-size: 11px; font-family: Arial, sans-serif; }
            th { background: #1e3a5f; color: #fff; font-weight: bold; }
        </style>
        </head><body>${area.innerHTML}</body></html>`;
    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ============================================================================
// WORKER INDIVIDUAL EFFICIENCY REPORT (Management)
// ============================================================================
let _mgmtWieData = null;
let _mgmtWieMetric = 'all';
let _mgmtWieSelectedEmps = new Set();
let _mgmtGraphData = null;
let _mgmtGraphSelectedEmps = new Set();
let _mgmtGraphEffBand = 'all';
let _mgmtGraphSearch = '';

async function loadMgmtWorkerIndividualEff() {
    const content = document.getElementById('main-content');
    const today = new Date().toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 6 * 24 * 3600000).toISOString().slice(0, 10);
    _mgmtWieData = null;
    _mgmtWieMetric = 'all';
    _mgmtWieSelectedEmps.clear();
    content.innerHTML = `
        <div class="page-header">
            <div>
                <h1 class="page-title">Worker Efficiency</h1>
                <p class="page-subtitle">Target · Output · Efficiency across all active lines</p>
            </div>
            <div class="ie-actions" style="flex-wrap:wrap;gap:8px;">
                <div class="ie-date">
                    <label for="mgmt-wie-from">From</label>
                    <input type="date" id="mgmt-wie-from" value="${weekAgo}">
                </div>
                <div class="ie-date">
                    <label for="mgmt-wie-to">To</label>
                    <input type="date" id="mgmt-wie-to" value="${today}">
                </div>
                <button class="btn btn-primary" onclick="refreshMgmtWorkerIndividualEff()">Load</button>
                <button class="btn btn-secondary" onclick="printMgmtWorkerIndividualEff()">&#9113; Print</button>
                <button class="btn btn-secondary" onclick="downloadMgmtWorkerIndividualEffExcel()" style="background:#1d6f42;color:#fff;border-color:#1d6f42;">&#8595; Excel</button>
            </div>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:14px;">
            <div style="display:flex;gap:4px;background:#f3f4f6;border-radius:8px;padding:3px;">
                <button id="mgmt-wie-btn-all" onclick="setMgmtWieMetric('all')" style="padding:5px 14px;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;background:#1e40af;color:#fff;">All</button>
                <button id="mgmt-wie-btn-target" onclick="setMgmtWieMetric('target')" style="padding:5px 14px;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;background:transparent;color:#374151;">Target</button>
                <button id="mgmt-wie-btn-wip" onclick="setMgmtWieMetric('wip')" style="padding:5px 14px;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;background:transparent;color:#374151;">WIP</button>
                <button id="mgmt-wie-btn-output" onclick="setMgmtWieMetric('output')" style="padding:5px 14px;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;background:transparent;color:#374151;">Output</button>
                <button id="mgmt-wie-btn-efficiency" onclick="setMgmtWieMetric('efficiency')" style="padding:5px 14px;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;background:transparent;color:#374151;">Efficiency</button>
            </div>
            <div style="position:relative;" id="mgmt-wie-emp-picker">
                <label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:3px;">Employee</label>
                <button type="button" id="mgmt-wie-emp-btn" onclick="toggleMgmtWieEmpDropdown()"
                    style="min-width:220px;max-width:320px;padding:7px 12px;border:1px solid #d1d5db;border-radius:6px;background:#fff;font-size:13px;text-align:left;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:8px;">
                    <span id="mgmt-wie-emp-label">All Employees</span>
                    <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
                </button>
                <div id="mgmt-wie-emp-dropdown" style="display:none;position:absolute;top:100%;left:0;z-index:999;background:#fff;border:1px solid #d1d5db;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.12);min-width:280px;max-width:360px;overflow:hidden;">
                    <div style="padding:8px;">
                        <input type="text" id="mgmt-wie-emp-search" placeholder="Search employees..." oninput="filterMgmtWieEmpList()"
                            style="width:100%;padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;box-sizing:border-box;">
                    </div>
                    <div style="padding:4px 8px 4px;border-bottom:1px solid #f3f4f6;display:flex;gap:10px;">
                        <button type="button" onclick="selectAllMgmtWieEmp()" style="font-size:11px;color:#3b82f6;background:none;border:none;cursor:pointer;padding:2px 0;font-weight:600;">Select All</button>
                        <button type="button" onclick="clearAllMgmtWieEmp()" style="font-size:11px;color:#6b7280;background:none;border:none;cursor:pointer;padding:2px 0;">Clear</button>
                    </div>
                    <div id="mgmt-wie-emp-list" style="max-height:220px;overflow-y:auto;padding:4px 0;"></div>
                </div>
            </div>
        </div>
        <div id="mgmt-wie-content" style="overflow-x:auto;">
            <div style="text-align:center;padding:60px;color:#9ca3af;">Select a date range and click <strong>Load</strong>.</div>
        </div>
    `;
}

function setMgmtWieMetric(metric) {
    _mgmtWieMetric = metric;
    ['all', 'target', 'wip', 'output', 'efficiency'].forEach(m => {
        const btn = document.getElementById(`mgmt-wie-btn-${m}`);
        if (!btn) return;
        btn.style.background = m === metric ? '#1e40af' : 'transparent';
        btn.style.color = m === metric ? '#fff' : '#374151';
    });
    renderMgmtWieFiltered();
}

function toggleMgmtWieEmpDropdown() {
    const dd = document.getElementById('mgmt-wie-emp-dropdown');
    if (!dd) return;
    const isOpen = dd.style.display !== 'none';
    dd.style.display = isOpen ? 'none' : 'block';
    if (!isOpen) document.getElementById('mgmt-wie-emp-search')?.focus();
}

function filterMgmtWieEmpList() {
    const q = (document.getElementById('mgmt-wie-emp-search')?.value || '').toLowerCase();
    document.querySelectorAll('#mgmt-wie-emp-list .mgmt-wie-emp-item').forEach(item => {
        item.style.display = item.dataset.label.toLowerCase().includes(q) ? '' : 'none';
    });
}

function updateMgmtWieEmpLabel() {
    const label = document.getElementById('mgmt-wie-emp-label');
    if (!label) return;
    if (_mgmtWieSelectedEmps.size === 0) {
        label.textContent = 'All Employees';
        return;
    }
    if (_mgmtWieSelectedEmps.size === 1) {
        const id = [..._mgmtWieSelectedEmps][0];
        const item = document.querySelector(`#mgmt-wie-emp-list .mgmt-wie-emp-item[data-id="${id}"]`);
        label.textContent = item ? item.dataset.label : '1 employee selected';
        return;
    }
    label.textContent = `${_mgmtWieSelectedEmps.size} employees selected`;
}

function toggleMgmtWieEmp(id) {
    if (_mgmtWieSelectedEmps.has(id)) _mgmtWieSelectedEmps.delete(id);
    else _mgmtWieSelectedEmps.add(id);
    updateMgmtWieEmpLabel();
    renderMgmtWieFiltered();
}

function selectAllMgmtWieEmp() {
    document.querySelectorAll('#mgmt-wie-emp-list .mgmt-wie-emp-item input[type=checkbox]').forEach(cb => {
        cb.checked = true;
        _mgmtWieSelectedEmps.add(cb.dataset.id);
    });
    updateMgmtWieEmpLabel();
    renderMgmtWieFiltered();
}

function clearAllMgmtWieEmp() {
    _mgmtWieSelectedEmps.clear();
    document.querySelectorAll('#mgmt-wie-emp-list .mgmt-wie-emp-item input[type=checkbox]').forEach(cb => { cb.checked = false; });
    updateMgmtWieEmpLabel();
    renderMgmtWieFiltered();
}

function populateMgmtWieEmpList(rows) {
    const empMap = new Map();
    rows.forEach(row => {
        if (row.employee_id) empMap.set(String(row.employee_id), { code: row.emp_code, name: row.emp_name });
    });
    const sorted = [...empMap.entries()].sort((a, b) => (a[1].name || '').localeCompare(b[1].name || ''));
    const list = document.getElementById('mgmt-wie-emp-list');
    if (!list) return;
    list.innerHTML = sorted.map(([id, emp]) => {
        const label = `${emp.name} (${emp.code})`;
        return `<label class="mgmt-wie-emp-item" data-id="${id}" data-label="${label}"
            style="display:flex;align-items:center;gap:8px;padding:6px 12px;cursor:pointer;font-size:13px;user-select:none;"
            onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background=''">
            <input type="checkbox" data-id="${id}" ${_mgmtWieSelectedEmps.has(id) ? 'checked' : ''}
                onchange="toggleMgmtWieEmp('${id}')" style="width:15px;height:15px;accent-color:#1e40af;cursor:pointer;">
            <span>${label}</span>
        </label>`;
    }).join('');
}

function renderMgmtWieFiltered() {
    const container = document.getElementById('mgmt-wie-content');
    if (!container || !_mgmtWieData) return;
    let rows = _mgmtWieData.rows;
    if (_mgmtWieSelectedEmps.size > 0) {
        rows = rows.filter(row => _mgmtWieSelectedEmps.has(String(row.employee_id)));
    }
    if (!rows.length) {
        container.innerHTML = '<div class="card"><div class="card-body" style="text-align:center;padding:40px;color:var(--secondary);">No data for selected employees.</div></div>';
        return;
    }
    const filteredData = { ..._mgmtWieData, rows };
    container.innerHTML = buildMgmtWorkerIndividualEffTable(filteredData, _mgmtWieMetric);
}

function buildMgmtWorkerEfficiencyGraphs(data) {
    const { dates, rows } = data;

    const dayStats = dates.map(date => {
        const values = rows
            .map(row => Number(row.dates?.[date]?.eff ?? 0))
            .filter(v => Number.isFinite(v));
        const avg = values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
        return { date, avg };
    });

    const topRows = [...rows]
        .sort((a, b) => Number(b.overall_eff || 0) - Number(a.overall_eff || 0))
        .slice(0, 10)
        .map(row => ({
            label: `${row.emp_name || '-'} (${row.emp_code || '-'})`,
            value: Number(row.overall_eff || 0)
        }));

    const bands = [
        { label: '75%+', color: '#16a34a', count: 0 },
        { label: '50-74%', color: '#d97706', count: 0 },
        { label: '1-49%', color: '#dc2626', count: 0 },
        { label: '0%', color: '#64748b', count: 0 }
    ];
    rows.forEach(row => {
        const eff = Number(row.overall_eff || 0);
        if (eff >= 75) bands[0].count++;
        else if (eff >= 50) bands[1].count++;
        else if (eff > 0) bands[2].count++;
        else bands[3].count++;
    });

    const allEmployeeBars = rows
        .map(row => ({
            label: `${row.emp_name || '-'} (${row.emp_code || '-'})`,
            value: Number(row.overall_eff || 0),
            emp_name: row.emp_name || '',
            emp_code: row.emp_code || '',
            total_output: Number(row.total_output || 0)
        }))
        .filter(item => mgmtGraphMatchesEffBand(item.value) && mgmtGraphMatchesSearch(item))
        .sort((a, b) => {
            const eff = b.value - a.value;
            if (eff !== 0) return eff;
            return itemLabel(itemSortKey(a)).localeCompare(itemLabel(itemSortKey(b)));
        });

    return `
        <div class="card" style="margin-bottom:16px;">
            <div class="card-header">
                <h3 class="card-title">Graphs</h3>
            </div>
            <div class="card-body">
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;">
                    <div style="border:1px solid #e5e7eb;border-radius:10px;padding:14px;background:#fff;">
                        <div style="font-size:13px;font-weight:700;color:#0f172a;margin-bottom:10px;">Daily Average Efficiency</div>
                        ${buildMgmtWieMiniBarChart(
                            dayStats.map(d => ({ label: formatMgmtWieChartDate(d.date), value: d.avg, color: '#2563eb' })),
                            { height: 160, emptyText: 'No dates in range.' }
                        )}
                    </div>
                    <div style="border:1px solid #e5e7eb;border-radius:10px;padding:14px;background:#fff;">
                        <div style="font-size:13px;font-weight:700;color:#0f172a;margin-bottom:10px;">Top 10 Workers by Overall Efficiency</div>
                        ${buildMgmtWieHorizontalBars(topRows, { emptyText: 'No worker data available.' })}
                    </div>
                    <div style="border:1px solid #e5e7eb;border-radius:10px;padding:14px;background:#fff;">
                        <div style="font-size:13px;font-weight:700;color:#0f172a;margin-bottom:10px;">Efficiency Distribution</div>
                        ${buildMgmtWieDistribution(bands, rows.length)}
                    </div>
                </div>
            </div>
        </div>
        <div class="card" style="margin-bottom:16px;">
            <div class="card-header">
                <h3 class="card-title">All Employee Bars</h3>
            </div>
            <div class="card-body">
                <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin-bottom:14px;">
                    <div style="min-width:180px;">
                        <label style="font-size:12px;font-weight:700;color:#64748b;display:block;margin-bottom:4px;">Efficiency Filter</label>
                        <select id="mgmt-graph-eff-band" class="form-control" onchange="setMgmtGraphEffBand(this.value)">
                            <option value="all" ${_mgmtGraphEffBand === 'all' ? 'selected' : ''}>All</option>
                            <option value="ge75" ${_mgmtGraphEffBand === 'ge75' ? 'selected' : ''}>75% and above</option>
                            <option value="50to74" ${_mgmtGraphEffBand === '50to74' ? 'selected' : ''}>50% to 74.9%</option>
                            <option value="1to49" ${_mgmtGraphEffBand === '1to49' ? 'selected' : ''}>1% to 49.9%</option>
                            <option value="zero" ${_mgmtGraphEffBand === 'zero' ? 'selected' : ''}>0%</option>
                        </select>
                    </div>
                    <div style="flex:1;min-width:220px;">
                        <label style="font-size:12px;font-weight:700;color:#64748b;display:block;margin-bottom:4px;">Employee Name / Code</label>
                        <input id="mgmt-graph-search" class="form-control" type="text" value="${escapeMgmtGraphAttr(_mgmtGraphSearch)}"
                            placeholder="Search by employee name or code" oninput="setMgmtGraphSearch(this.value)">
                    </div>
                    <div style="font-size:12px;color:#64748b;padding-bottom:8px;">
                        Showing <strong style="color:#0f172a;">${allEmployeeBars.length}</strong> of <strong style="color:#0f172a;">${rows.length}</strong> employees
                    </div>
                </div>
                ${buildMgmtGraphAllEmployeeBars(allEmployeeBars)}
            </div>
        </div>
    `;
}

function itemSortKey(item) {
    return `${item.emp_name || ''} ${item.emp_code || ''}`.trim();
}

function itemLabel(value) {
    return String(value || '').toLowerCase();
}

function escapeMgmtGraphAttr(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function formatMgmtWieChartDate(dateStr) {
    const [, m, d] = String(dateStr || '').split('-');
    if (!m || !d) return dateStr || '';
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${parseInt(d, 10)}-${months[parseInt(m, 10) - 1] || m}`;
}

function buildMgmtWieMiniBarChart(items, { height = 160, emptyText = 'No data.' } = {}) {
    if (!items.length) {
        return `<div style="height:${height}px;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:12px;">${emptyText}</div>`;
    }
    const maxValue = Math.max(100, ...items.map(item => Number(item.value || 0)));
    return `
        <div style="height:${height}px;display:flex;align-items:flex-end;gap:8px;padding-top:8px;">
            ${items.map(item => {
                const value = Number(item.value || 0);
                const pct = Math.max(0, Math.min(100, (value / maxValue) * 100));
                return `
                    <div style="flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:6px;">
                        <div style="font-size:11px;font-weight:700;color:#334155;">${value.toFixed(1)}%</div>
                        <div style="height:${height - 48}px;width:100%;display:flex;align-items:flex-end;">
                            <div style="width:100%;height:${pct}%;background:${item.color || '#2563eb'};border-radius:8px 8px 0 0;min-height:${value > 0 ? '4px' : '0'};"></div>
                        </div>
                        <div style="font-size:10px;color:#64748b;text-align:center;line-height:1.2;word-break:break-word;">${item.label}</div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

function buildMgmtWieHorizontalBars(items, { emptyText = 'No data.' } = {}) {
    if (!items.length) {
        return `<div style="height:160px;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:12px;">${emptyText}</div>`;
    }
    const maxValue = Math.max(100, ...items.map(item => Number(item.value || 0)));
    return `
        <div style="display:flex;flex-direction:column;gap:10px;">
            ${items.map(item => {
                const value = Number(item.value || 0);
                const pct = Math.max(0, Math.min(100, (value / maxValue) * 100));
                const color = value >= 75 ? '#16a34a' : value >= 50 ? '#d97706' : '#dc2626';
                return `
                    <div>
                        <div style="display:flex;justify-content:space-between;gap:10px;font-size:11px;margin-bottom:4px;">
                            <span style="color:#334155;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${item.label}</span>
                            <strong style="color:${color};flex-shrink:0;">${value.toFixed(1)}%</strong>
                        </div>
                        <div style="height:10px;background:#e5e7eb;border-radius:999px;overflow:hidden;">
                            <div style="height:100%;width:${pct}%;background:${color};border-radius:999px;"></div>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

function buildMgmtWieDistribution(bands, total) {
    if (!total) {
        return `<div style="height:160px;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:12px;">No worker data available.</div>`;
    }
    return `
        <div style="display:flex;flex-direction:column;gap:14px;">
            ${bands.map(band => {
                const pct = total > 0 ? (band.count / total) * 100 : 0;
                return `
                    <div>
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;font-size:12px;">
                            <span style="font-weight:600;color:#334155;">${band.label}</span>
                            <span style="color:#64748b;">${band.count} workers</span>
                        </div>
                        <div style="height:12px;background:#e5e7eb;border-radius:999px;overflow:hidden;">
                            <div style="height:100%;width:${pct}%;background:${band.color};border-radius:999px;"></div>
                        </div>
                        <div style="font-size:11px;color:#64748b;margin-top:4px;">${pct.toFixed(1)}%</div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

function mgmtGraphMatchesEffBand(value) {
    if (_mgmtGraphEffBand === 'ge75') return value >= 75;
    if (_mgmtGraphEffBand === '50to74') return value >= 50 && value < 75;
    if (_mgmtGraphEffBand === '1to49') return value > 0 && value < 50;
    if (_mgmtGraphEffBand === 'zero') return value <= 0;
    return true;
}

function mgmtGraphMatchesSearch(item) {
    const q = String(_mgmtGraphSearch || '').trim().toLowerCase();
    if (!q) return true;
    return `${item.emp_name} ${item.emp_code}`.toLowerCase().includes(q);
}

function setMgmtGraphEffBand(value) {
    _mgmtGraphEffBand = value || 'all';
    renderMgmtWorkerEfficiencyGraphs();
}

function setMgmtGraphSearch(value) {
    _mgmtGraphSearch = value || '';
    renderMgmtWorkerEfficiencyGraphs();
}

function buildMgmtGraphAllEmployeeBars(items) {
    if (!items.length) {
        return `<div style="height:180px;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:12px;border:1px dashed #cbd5e1;border-radius:10px;">No employees match the selected filters.</div>`;
    }
    const maxValue = Math.max(100, ...items.map(item => Number(item.value || 0)));
    return `
        <div style="max-height:560px;overflow:auto;border:1px solid #e5e7eb;border-radius:10px;padding:12px;background:#f8fafc;">
            <div style="display:flex;flex-direction:column;gap:10px;">
                ${items.map(item => {
                    const value = Number(item.value || 0);
                    const pct = Math.max(0, Math.min(100, (value / maxValue) * 100));
                    const color = value >= 75 ? '#16a34a' : value >= 50 ? '#d97706' : value > 0 ? '#dc2626' : '#64748b';
                    return `
                        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;">
                            <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:6px;">
                                <div style="min-width:0;">
                                    <div style="font-size:12px;font-weight:700;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${item.label}</div>
                                    <div style="font-size:11px;color:#64748b;">Output: ${item.total_output}</div>
                                </div>
                                <div style="font-size:13px;font-weight:800;color:${color};flex-shrink:0;">${value.toFixed(1)}%</div>
                            </div>
                            <div style="height:12px;background:#e5e7eb;border-radius:999px;overflow:hidden;">
                                <div style="height:100%;width:${pct}%;background:${color};border-radius:999px;"></div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
}

async function loadMgmtWorkerEfficiencyGraphs() {
    const content = document.getElementById('main-content');
    const today = new Date().toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 6 * 24 * 3600000).toISOString().slice(0, 10);
    _mgmtGraphData = null;
    _mgmtGraphSelectedEmps.clear();
    _mgmtGraphEffBand = 'all';
    _mgmtGraphSearch = '';
    content.innerHTML = `
        <div class="page-header">
            <div>
                <h1 class="page-title">Graphs</h1>
                <p class="page-subtitle">Worker efficiency visual summary</p>
            </div>
            <div class="ie-actions" style="flex-wrap:wrap;gap:8px;">
                <div class="ie-date">
                    <label for="mgmt-graph-from">From</label>
                    <input type="date" id="mgmt-graph-from" value="${weekAgo}">
                </div>
                <div class="ie-date">
                    <label for="mgmt-graph-to">To</label>
                    <input type="date" id="mgmt-graph-to" value="${today}">
                </div>
                <button class="btn btn-primary" onclick="refreshMgmtWorkerEfficiencyGraphs()">Load</button>
            </div>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:14px;">
            <div style="position:relative;" id="mgmt-graph-emp-picker">
                <label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:3px;">Employee</label>
                <button type="button" id="mgmt-graph-emp-btn" onclick="toggleMgmtGraphEmpDropdown()"
                    style="min-width:220px;max-width:320px;padding:7px 12px;border:1px solid #d1d5db;border-radius:6px;background:#fff;font-size:13px;text-align:left;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:8px;">
                    <span id="mgmt-graph-emp-label">All Employees</span>
                    <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
                </button>
                <div id="mgmt-graph-emp-dropdown" style="display:none;position:absolute;top:100%;left:0;z-index:999;background:#fff;border:1px solid #d1d5db;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.12);min-width:280px;max-width:360px;overflow:hidden;">
                    <div style="padding:8px;">
                        <input type="text" id="mgmt-graph-emp-search" placeholder="Search employees..." oninput="filterMgmtGraphEmpList()"
                            style="width:100%;padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;box-sizing:border-box;">
                    </div>
                    <div style="padding:4px 8px 4px;border-bottom:1px solid #f3f4f6;display:flex;gap:10px;">
                        <button type="button" onclick="selectAllMgmtGraphEmp()" style="font-size:11px;color:#3b82f6;background:none;border:none;cursor:pointer;padding:2px 0;font-weight:600;">Select All</button>
                        <button type="button" onclick="clearAllMgmtGraphEmp()" style="font-size:11px;color:#6b7280;background:none;border:none;cursor:pointer;padding:2px 0;">Clear</button>
                    </div>
                    <div id="mgmt-graph-emp-list" style="max-height:220px;overflow-y:auto;padding:4px 0;"></div>
                </div>
            </div>
        </div>
        <div id="mgmt-graph-content">
            <div style="text-align:center;padding:60px;color:#9ca3af;">Select a date range and click <strong>Load</strong>.</div>
        </div>
    `;
}

function toggleMgmtGraphEmpDropdown() {
    const dd = document.getElementById('mgmt-graph-emp-dropdown');
    if (!dd) return;
    const isOpen = dd.style.display !== 'none';
    dd.style.display = isOpen ? 'none' : 'block';
    if (!isOpen) document.getElementById('mgmt-graph-emp-search')?.focus();
}

function filterMgmtGraphEmpList() {
    const q = (document.getElementById('mgmt-graph-emp-search')?.value || '').toLowerCase();
    document.querySelectorAll('#mgmt-graph-emp-list .mgmt-graph-emp-item').forEach(item => {
        item.style.display = item.dataset.label.toLowerCase().includes(q) ? '' : 'none';
    });
}

function updateMgmtGraphEmpLabel() {
    const label = document.getElementById('mgmt-graph-emp-label');
    if (!label) return;
    if (_mgmtGraphSelectedEmps.size === 0) {
        label.textContent = 'All Employees';
        return;
    }
    if (_mgmtGraphSelectedEmps.size === 1) {
        const id = [..._mgmtGraphSelectedEmps][0];
        const item = document.querySelector(`#mgmt-graph-emp-list .mgmt-graph-emp-item[data-id="${id}"]`);
        label.textContent = item ? item.dataset.label : '1 employee selected';
        return;
    }
    label.textContent = `${_mgmtGraphSelectedEmps.size} employees selected`;
}

function toggleMgmtGraphEmp(id) {
    if (_mgmtGraphSelectedEmps.has(id)) _mgmtGraphSelectedEmps.delete(id);
    else _mgmtGraphSelectedEmps.add(id);
    updateMgmtGraphEmpLabel();
    renderMgmtWorkerEfficiencyGraphs();
}

function selectAllMgmtGraphEmp() {
    document.querySelectorAll('#mgmt-graph-emp-list .mgmt-graph-emp-item input[type=checkbox]').forEach(cb => {
        cb.checked = true;
        _mgmtGraphSelectedEmps.add(cb.dataset.id);
    });
    updateMgmtGraphEmpLabel();
    renderMgmtWorkerEfficiencyGraphs();
}

function clearAllMgmtGraphEmp() {
    _mgmtGraphSelectedEmps.clear();
    document.querySelectorAll('#mgmt-graph-emp-list .mgmt-graph-emp-item input[type=checkbox]').forEach(cb => { cb.checked = false; });
    updateMgmtGraphEmpLabel();
    renderMgmtWorkerEfficiencyGraphs();
}

function populateMgmtGraphEmpList(rows) {
    const empMap = new Map();
    rows.forEach(row => {
        if (row.employee_id) empMap.set(String(row.employee_id), { code: row.emp_code, name: row.emp_name });
    });
    const sorted = [...empMap.entries()].sort((a, b) => (a[1].name || '').localeCompare(b[1].name || ''));
    const list = document.getElementById('mgmt-graph-emp-list');
    if (!list) return;
    list.innerHTML = sorted.map(([id, emp]) => {
        const label = `${emp.name} (${emp.code})`;
        return `<label class="mgmt-graph-emp-item" data-id="${id}" data-label="${label}"
            style="display:flex;align-items:center;gap:8px;padding:6px 12px;cursor:pointer;font-size:13px;user-select:none;"
            onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background=''">
            <input type="checkbox" data-id="${id}" ${_mgmtGraphSelectedEmps.has(id) ? 'checked' : ''}
                onchange="toggleMgmtGraphEmp('${id}')" style="width:15px;height:15px;accent-color:#1e40af;cursor:pointer;">
            <span>${label}</span>
        </label>`;
    }).join('');
}

async function refreshMgmtWorkerEfficiencyGraphs() {
    const from = document.getElementById('mgmt-graph-from')?.value;
    const to = document.getElementById('mgmt-graph-to')?.value;
    const container = document.getElementById('mgmt-graph-content');
    if (!container) return;
    container.innerHTML = '<div style="text-align:center;padding:40px;"><div class="spinner" style="display:inline-block;"></div></div>';
    try {
        const r = await fetch(`${API_BASE}/worker-individual-efficiency?from_date=${from}&to_date=${to}`, { credentials: 'include' });
        const resp = await r.json();
        if (!resp.success) {
            container.innerHTML = `<div class="card"><div class="card-body" style="color:#dc2626;">${resp.error || 'Failed to load'}</div></div>`;
            return;
        }
        if (!resp.data.rows.length) {
            container.innerHTML = `<div class="card"><div class="card-body" style="text-align:center;padding:40px;color:var(--secondary);">No data found for the selected range.</div></div>`;
            return;
        }
        _mgmtGraphData = resp.data;
        _mgmtGraphSelectedEmps.clear();
        populateMgmtGraphEmpList(resp.data.rows);
        updateMgmtGraphEmpLabel();
        renderMgmtWorkerEfficiencyGraphs();
    } catch (err) {
        container.innerHTML = `<div class="card"><div class="card-body" style="color:#dc2626;">Error: ${err.message}</div></div>`;
    }
}

function renderMgmtWorkerEfficiencyGraphs() {
    const container = document.getElementById('mgmt-graph-content');
    if (!container || !_mgmtGraphData) return;
    let rows = _mgmtGraphData.rows;
    if (_mgmtGraphSelectedEmps.size > 0) {
        rows = rows.filter(row => _mgmtGraphSelectedEmps.has(String(row.employee_id)));
    }
    if (!rows.length) {
        container.innerHTML = '<div class="card"><div class="card-body" style="text-align:center;padding:40px;color:var(--secondary);">No data for selected employees.</div></div>';
        return;
    }
    container.innerHTML = buildMgmtWorkerEfficiencyGraphs({ ..._mgmtGraphData, rows });
}

async function refreshMgmtWorkerIndividualEff() {
    const from = document.getElementById('mgmt-wie-from')?.value;
    const to = document.getElementById('mgmt-wie-to')?.value;
    const container = document.getElementById('mgmt-wie-content');
    if (!container) return;
    container.innerHTML = '<div style="text-align:center;padding:40px;"><div class="spinner" style="display:inline-block;"></div></div>';
    try {
        const r = await fetch(`${API_BASE}/worker-individual-efficiency?from_date=${from}&to_date=${to}`, { credentials: 'include' });
        const resp = await r.json();
        if (!resp.success) {
            container.innerHTML = `<div class="card"><div class="card-body" style="color:#dc2626;">${resp.error || 'Failed to load'}</div></div>`;
            return;
        }
        if (!resp.data.rows.length) {
            container.innerHTML = `<div class="card"><div class="card-body" style="text-align:center;padding:40px;color:var(--secondary);">No data found for the selected range.</div></div>`;
            return;
        }
        _mgmtWieData = resp.data;
        _mgmtWieSelectedEmps.clear();
        populateMgmtWieEmpList(resp.data.rows);
        updateMgmtWieEmpLabel();
        renderMgmtWieFiltered();
    } catch (err) {
        container.innerHTML = `<div class="card"><div class="card-body" style="color:#dc2626;">Error: ${err.message}</div></div>`;
    }
}

function buildMgmtWorkerIndividualEffTable(data, metric = 'all') {
    const { dates, rows } = data;
    const thS = 'background:#1e3a5f;color:#fff;padding:6px 5px;text-align:center;white-space:nowrap;font-size:11px;border:1px solid #0f2744;font-weight:700;';
    const thSS = 'background:#1e3a5f;color:#fff;padding:4px 4px;text-align:center;white-space:nowrap;font-size:10px;border:1px solid #0f2744;';
    const tdS = 'padding:4px 5px;border:1px solid #9ca3af;font-size:11px;';
    const tcS = tdS + 'text-align:center;';

    const showTarget = metric === 'all' || metric === 'target';
    const showWip = metric === 'all' || metric === 'wip';
    const showOutput = metric === 'all' || metric === 'output';
    const showEff = metric === 'all' || metric === 'efficiency';

    const dateCols = (showTarget ? 1 : 0) + (showWip ? 1 : 0) + (showOutput ? 1 : 0) + (showEff ? 1 : 0);
    const fixedCols = 3;
    const overallCols = (showOutput ? 1 : 0) + (showEff ? 1 : 0);

    const months = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const fmtDate = d => {
        const [, m, day] = d.split('-');
        return `${parseInt(day, 10)}-${months[parseInt(m, 10)]}`;
    };

    const tagStyle = {
        DEP: 'background:#fee2e2;color:#991b1b;',
        PRE: 'background:#eff6ff;color:#1d4ed8;',
        POST: 'background:#f0fdf4;color:#166534;',
        COMB: 'background:#faf5ff;color:#6b21a8;'
    };
    const effColor = eff => {
        if (eff == null) return '#6b7280';
        return eff >= 75 ? '#16a34a' : eff >= 50 ? '#d97706' : '#dc2626';
    };

    const dateGroupHeaders = dates.map(d => `<th colspan="${dateCols}" style="${thS}">${fmtDate(d)}</th>`).join('');
    const subHeaders = dates.map(() => [
        showTarget ? `<th style="${thSS}">TARGET</th>` : '',
        showWip ? `<th style="${thSS}">WIP</th>` : '',
        showOutput ? `<th style="${thSS}">OUTPUT</th>` : '',
        showEff ? `<th style="${thSS}">EFF%</th>` : ''
    ].join('')).join('');

    const dataRows = rows.map((row, idx) => {
        const dateCells = dates.map(d => {
            const cell = row.dates[d];
            const tagKey = cell?.tag ? cell.tag.split(' ')[0] : null;
            const tS = tagKey && tagStyle[tagKey] ? tagStyle[tagKey] : '';
            const tagBadge = cell?.tag ? `<br><span style="font-size:8px;font-weight:700;">${cell.tag}</span>` : '';
            const effVal = Number.isFinite(Number(cell?.eff)) ? Number(cell.eff) : 0;
            const effTxt = effVal.toFixed(1) + '%';
            const effC = effColor(effVal);
            const zeroCell = `<td style="${tcS}">0</td>`;

            if (!cell) {
                return [
                    showTarget ? zeroCell : '',
                    showWip ? zeroCell : '',
                    showOutput ? zeroCell : '',
                    showEff ? `<td style="${tcS}font-weight:600;color:${effColor(0)};">0.0%</td>` : ''
                ].join('');
            }

            const wip = Math.max(0, (cell.wip ?? 0) - (cell.output ?? 0));
            const wipColor = wip > 0 ? '#dc2626' : '#16a34a';

            return [
                showTarget ? `<td style="${tcS}${tS}">${cell.wip ?? '-'}${tagBadge}</td>` : '',
                showWip ? `<td style="${tcS}${tS}font-weight:600;color:${wipColor};">${wip}</td>` : '',
                showOutput ? `<td style="${tcS}${tS}">${cell.output ?? 0}</td>` : '',
                showEff ? `<td style="${tcS}${tS}font-weight:600;color:${effC};">${effTxt}</td>` : ''
            ].join('');
        }).join('');

        const totalEffVal = Number.isFinite(Number(row.overall_eff)) ? Number(row.overall_eff) : 0;
        const totalEffTxt = totalEffVal.toFixed(1) + '%';
        const totalEffC = effColor(totalEffVal);

        return `<tr>
            <td style="${tcS}font-weight:600;">${idx + 1}</td>
            <td style="${tdS}font-weight:600;">${row.emp_name || '-'}</td>
            <td style="${tcS}">${row.emp_code || '-'}</td>
            ${dateCells}
            ${showOutput ? `<td style="${tcS}font-weight:700;">${row.total_output}</td>` : ''}
            ${showEff ? `<td style="${tcS}font-weight:700;color:${totalEffC};">${totalEffTxt}</td>` : ''}
        </tr>`;
    }).join('');

    return `
    <div id="mgmt-wie-print-area">
        <div style="text-align:center;font-size:17px;font-weight:700;margin-bottom:10px;letter-spacing:0.5px;">WORKERS INDIVIDUAL EFFICIENCY</div>
        <div style="font-size:10px;margin-bottom:8px;display:flex;gap:14px;flex-wrap:wrap;">
            <span><span style="background:#fee2e2;color:#991b1b;padding:1px 4px;border-radius:3px;font-size:9px;font-weight:700;">DEP HH:MM</span> Departed mid-day</span>
            <span><span style="background:#eff6ff;color:#1d4ed8;padding:1px 4px;border-radius:3px;font-size:9px;font-weight:700;">PRE</span> Before reassignment</span>
            <span><span style="background:#f0fdf4;color:#166534;padding:1px 4px;border-radius:3px;font-size:9px;font-weight:700;">POST</span> After reassignment</span>
            <span><span style="background:#faf5ff;color:#6b21a8;padding:1px 4px;border-radius:3px;font-size:9px;font-weight:700;">COMB</span> Combined workstation</span>
        </div>
        <div style="overflow-x:auto;">
        <table style="border-collapse:collapse;width:max-content;min-width:100%;">
            <thead>
                <tr>
                    <th colspan="${fixedCols}" style="${thS}">DATE</th>
                    ${dateGroupHeaders}
                    ${overallCols > 0 ? `<th colspan="${overallCols}" style="${thS}">OVERALL</th>` : ''}
                </tr>
                <tr>
                    <th style="${thSS}">S.No</th>
                    <th style="${thSS}">WORKER NAME</th>
                    <th style="${thSS}">ID NO</th>
                    ${subHeaders}
                    ${showOutput ? `<th style="${thSS}">TOTAL<br>OUTPUT</th>` : ''}
                    ${showEff ? `<th style="${thSS}">EFF%</th>` : ''}
                </tr>
            </thead>
            <tbody>${dataRows}</tbody>
        </table>
        </div>
    </div>`;
}

function printMgmtWorkerIndividualEff() {
    const area = document.getElementById('mgmt-wie-print-area');
    if (!area) {
        alert('No report loaded.');
        return;
    }
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.onload = () => {
        const doc = iframe.contentDocument;
        const clone = area.cloneNode(true);
        clone.querySelectorAll('table').forEach(t => {
            t.style.borderCollapse = 'collapse';
            t.style.width = '100%';
            t.style.fontSize = '9px';
        });
        clone.querySelectorAll('th, td').forEach(el => {
            el.style.border = '1px solid #333';
            el.style.padding = '3px 4px';
        });
        doc.open();
        doc.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
            <title>Worker Individual Efficiency</title>
            <style>
                * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
                body { font-family: Arial, sans-serif; margin: 10px; }
                @media print { @page { size: A3 landscape; margin: 8mm; } }
            </style></head><body>${clone.innerHTML}</body></html>`);
        doc.close();
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
        setTimeout(() => { document.body.removeChild(iframe); }, 1000);
    };
    document.body.appendChild(iframe);
}

function downloadMgmtWorkerIndividualEffExcel() {
    const area = document.getElementById('mgmt-wie-print-area');
    if (!area) {
        alert('No report loaded.');
        return;
    }
    const from = document.getElementById('mgmt-wie-from')?.value || '';
    const to = document.getElementById('mgmt-wie-to')?.value || '';
    const filename = `WorkerEfficiency_AllLines_${from}_${to}.xls`;
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office"
        xmlns:x="urn:schemas-microsoft-com:office:excel"
        xmlns="http://www.w3.org/TR/REC-html40">
        <head><meta charset="UTF-8">
        <!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets>
        <x:ExcelWorksheet><x:Name>Worker Efficiency</x:Name>
        <x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
        </x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
        <style>
            table { border-collapse: collapse; }
            th, td { border: 1px solid #999; padding: 4px 6px; font-size: 10px; font-family: Arial, sans-serif; }
            th { background: #1e3a5f; color: #fff; font-weight: bold; }
        </style>
        </head><body>${area.innerHTML}</body></html>`;
    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.addEventListener('click', e => {
    const picker = document.getElementById('mgmt-wie-emp-picker');
    if (picker && !picker.contains(e.target)) {
        const dd = document.getElementById('mgmt-wie-emp-dropdown');
        if (dd) dd.style.display = 'none';
    }
    const graphPicker = document.getElementById('mgmt-graph-emp-picker');
    if (graphPicker && !graphPicker.contains(e.target)) {
        const dd = document.getElementById('mgmt-graph-emp-dropdown');
        if (dd) dd.style.display = 'none';
    }
});
