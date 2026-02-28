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
                            <th>Product</th>
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
                <p class="page-subtitle">Workstation-level hourly output tracking</p>
            </div>
            <div class="ie-actions" style="flex-wrap:wrap;gap:8px;">
                <div class="ie-date">
                    <label for="osm-line">Line</label>
                    <select id="osm-line" class="form-control" style="min-width:180px;"></select>
                </div>
                <div class="ie-date">
                    <label for="osm-date">Date</label>
                    <input type="date" id="osm-date" value="${today}">
                </div>
                <button class="btn btn-secondary" onclick="refreshMgmtOsmReport()">Refresh</button>
                <button class="btn btn-secondary" onclick="printMgmtOsmReport()">Print</button>
            </div>
        </div>
        <div id="osm-content">
            <div style="text-align:center;padding:40px;color:var(--secondary);">Select a line to load the report.</div>
        </div>
    `;

    try {
        const r = await fetch(`${API_BASE}/lines`, { credentials: 'include' });
        const result = await r.json();
        if (result.success) {
            const sel = document.getElementById('osm-line');
            sel.innerHTML = '<option value="">-- Select Line --</option>' +
                result.data.filter(l => l.is_active).map(l =>
                    `<option value="${l.id}">${l.line_name} (${l.line_code})</option>`
                ).join('');
            sel.addEventListener('change', refreshMgmtOsmReport);
        }
    } catch (e) { /* ignore */ }

    document.getElementById('osm-date').addEventListener('change', refreshMgmtOsmReport);
}

async function refreshMgmtOsmReport() {
    const lineId = document.getElementById('osm-line')?.value;
    const date   = document.getElementById('osm-date')?.value;
    const container = document.getElementById('osm-content');
    if (!container) return;

    if (!lineId) {
        container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--secondary);">Select a line to load the report.</div>';
        return;
    }

    container.innerHTML = '<div style="text-align:center;padding:40px;"><div class="spinner" style="display:inline-block;"></div></div>';

    try {
        const r = await fetch(`${API_BASE}/osm-report?line_id=${lineId}&date=${date}`, { credentials: 'include' });
        const data = await r.json();

        if (!data.success) {
            container.innerHTML = `<div class="card"><div class="card-body" style="color:#dc2626;">${data.error || 'Failed to load report'}</div></div>`;
            return;
        }

        if (!data.workstations?.length) {
            container.innerHTML = `
                <div class="card">
                    <div class="card-body" style="text-align:center;padding:40px;color:var(--secondary);">
                        No workstation plan found for <strong>${data.line_name}</strong> on <strong>${date}</strong>.
                    </div>
                </div>`;
            return;
        }

        container.innerHTML = _buildMgmtOsmTable(data);
    } catch (err) {
        container.innerHTML = `<div class="card"><div class="card-body" style="color:#dc2626;">Error: ${err.message}</div></div>`;
    }
}

function _buildMgmtOsmTable(data) {
    const { workstations, target_units, working_hours, in_time, out_time } = data;
    const inH  = parseInt((in_time  || '08:00').split(':')[0]);
    const outH = parseInt((out_time || '17:00').split(':')[0]);

    const hours = [];
    for (let h = inH; h < outH; h++) hours.push(h);

    const perHourTarget = (working_hours > 0 && target_units > 0)
        ? Math.round(target_units / working_hours) : 0;

    let maxDataHour = -1;
    for (const ws of workstations) {
        for (const h of Object.keys(ws.hourly)) {
            const hInt = parseInt(h);
            if (hInt > maxDataHour) maxDataHour = hInt;
        }
    }
    const elapsedHours = maxDataHour >= inH
        ? hours.filter(h => h <= maxDataHour).length : 0;
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

    const dataRows = workstations.map(ws => {
        const hourCells = hours.map(h => {
            const d = ws.hourly[h];
            const qty = (d && d.quantity != null) ? d.quantity : '';
            return `<td style="${tcS}">${qty}</td>`;
        }).join('');

        const totalOutput = Object.values(ws.hourly).reduce((s, d) => s + (d.quantity || 0), 0);
        const blog = totalOutput - totalTargetSoFar;
        const blogColor = blog >= 0 ? '#16a34a' : '#dc2626';
        const balToProd = totalOutput - target_units;

        const reasons = [...new Set(
            Object.values(ws.hourly).map(d => d.shortfall_reason).filter(Boolean)
        )].join('; ');

        return `<tr>
            <td style="${tcS}font-weight:600;">${ws.group_name || '-'}</td>
            <td style="${tcS}">${totalOutput}</td>
            <td style="${tcS}font-weight:600;">${ws.workstation_code}</td>
            <td style="${tdS}font-size:11px;max-width:220px;word-break:break-word;">${ws.process_details}</td>
            ${hourCells}
            <td style="${tcS}font-weight:700;">${totalTargetSoFar}</td>
            <td style="${tcS}font-weight:700;">${totalOutput}</td>
            <td style="${tcS}font-weight:700;color:${blogColor};">${blog >= 0 ? '+' : ''}${blog}</td>
            <td style="${tcS}">${balToProd >= 0 ? '+' : ''}${balToProd}</td>
            <td style="${tdS}font-size:11px;">${reasons}</td>
        </tr>`;
    }).join('');

    return `<div class="card" id="mgmt-osm-print-area">
        <div class="card-header">
            <div>
                <h3 class="card-title">STAGEWISE HOURLY OSM REPORT</h3>
                <div style="font-size:12px;color:var(--secondary);margin-top:2px;">
                    ${data.line_name} (${data.line_code})
                    &nbsp;&bull;&nbsp; ${data.product_code} ${data.product_name}
                    &nbsp;&bull;&nbsp; Date: ${data.date}
                    &nbsp;&bull;&nbsp; Target: ${target_units} &nbsp;&bull;&nbsp; Per Hour: ${perHourTarget}
                </div>
            </div>
        </div>
        <div class="card-body" style="overflow-x:auto;padding:0;">
            <table style="border-collapse:collapse;white-space:nowrap;width:100%;">
                <thead>
                    <tr>
                        <th style="${thS}min-width:60px;">GROUP</th>
                        <th style="${thS}min-width:80px;">CUMULATIVE<br>OUTPUT AS ON DATE</th>
                        <th style="${thS}min-width:70px;">WORK<br>STATION</th>
                        <th style="${thS}min-width:200px;white-space:normal;">PROCESS DETAILS</th>
                        ${hourHeaders}
                        <th style="${thS}min-width:75px;">TOTAL<br>TARGET</th>
                        <th style="${thS}min-width:80px;">TOTAL OUTPUT<br>(AS ON TIME)</th>
                        <th style="${thS}min-width:65px;">B.LOG</th>
                        <th style="${thS}min-width:90px;white-space:normal;">BAL TO PROD<br>AS PER TODAY'S TARGET</th>
                        <th style="${thS}min-width:120px;white-space:normal;">REASON</th>
                    </tr>
                    <tr style="background:#dbeafe;">
                        <td colspan="4" style="${tdS}text-align:right;font-weight:700;padding:4px 10px;">TARGET / HOUR</td>
                        ${targetRow}
                        <td colspan="4" style="${tdS}"></td>
                    </tr>
                </thead>
                <tbody>${dataRows}</tbody>
            </table>
        </div>
    </div>`;
}

function printMgmtOsmReport() {
    const area = document.getElementById('mgmt-osm-print-area');
    if (!area) { alert('No report loaded.'); return; }
    const sel = document.getElementById('osm-line');
    const lineText = sel ? (sel.options[sel.selectedIndex]?.text || '') : '';
    const date = document.getElementById('osm-date')?.value || '';
    const w = window.open('', '_blank');
    w.document.write(`<!DOCTYPE html><html><head>
        <title>OSM Report - ${lineText} - ${date}</title>
        <style>
            body { font-family: Arial, sans-serif; font-size: 11px; margin: 10px; }
            table { border-collapse: collapse; width: 100%; }
            th, td { border: 1px solid #999; padding: 3px 5px; }
            .card-header { margin-bottom: 8px; }
            .card-title { font-size: 14px; font-weight: bold; margin: 0 0 4px; }
            @media print { body { margin: 0; } }
        </style>
        </head><body>${area.innerHTML}
        <script>window.onload=function(){window.print();}<\/script>
        </body></html>`);
    w.document.close();
}
