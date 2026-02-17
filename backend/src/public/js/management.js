const API_BASE = '/api';

document.addEventListener('DOMContentLoaded', async () => {
    const ok = await requireAuth();
    if (!ok) return;
    setupMobileSidebar();
    setupRealtime();
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
