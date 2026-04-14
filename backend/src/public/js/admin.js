// WorkSync Admin Panel - JavaScript
const API_BASE = '/api';

function escHtml(str) {
    return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Current active section
let currentSection = 'dashboard';
let currentView = { type: 'section', section: 'dashboard' };
let realtimeRefreshTimer = null;
const isIeMode = typeof window !== 'undefined' && window.IS_IE;
let ieDefaultIn = '08:00';
let ieDefaultOut = '17:00';

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
    const ok = await requireAuth();
    if (!ok) return;
    if (isIeMode) {
        loadSection('daily-plan');
        const dailyLink = document.querySelector('.nav-link[data-section="daily-plan"]');
        if (dailyLink) {
            document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
            dailyLink.classList.add('active');
        }
    } else {
        loadSection('dashboard');
    }
    setupNavigation();
    setupMobileSidebar();
    setupRealtime();
});

async function requireAuth() {
    try {
        const response = await fetch('/auth/session');
        if (!response.ok) {
            window.location.href = '/';
            return false;
        }
        const result = await response.json();
        if (!result.success) {
            window.location.href = '/';
            return false;
        }
        const required = window.REQUIRED_ROLE;
        if (required) {
            const roles = Array.isArray(required) ? required : [required];
            if (!roles.includes(result.role)) {
                window.location.href = '/';
                return false;
            }
        }
        return true;
    } catch (err) {
        window.location.href = '/';
        return false;
    }
}

// Setup navigation
function setupNavigation() {
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const section = link.dataset.section;
            loadSection(section);

            // Update active state
            document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            closeMobileSidebar();
        });
    });
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

    overlay.addEventListener('click', closeMobileSidebar);
    window.addEventListener('resize', () => {
        if (window.innerWidth > 768) {
            closeMobileSidebar();
        }
    });
}

function closeMobileSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('active');
}

// Load section content
async function loadSection(section) {
    currentSection = section;
    currentView = { type: 'section', section };
    const content = document.getElementById('main-content');

    switch(section) {
        case 'dashboard':
            await loadDashboard();
            break;
        case 'attendance':
            await loadAttendanceSection();
            break;
        case 'daily-plan':
            await loadDailyPlans();
            break;
        case 'lines':
            await loadLines();
            break;
        case 'employees':
            await loadEmployees();
            break;
        case 'products':
            await loadProducts();
            break;
        case 'operations':
            await loadOperations();
            break;
        case 'users':
            await loadUsers();
            break;
        case 'audit-logs':
            await loadAuditLogs();
            break;
        case 'production-days':
            await loadProductionDays();
            break;
        case 'osm':
            await loadOsmReport();
            break;
        case 'plan-history':
            await loadPlanHistory();
            break;
        case 'efficiency':
            await loadEfficiencyReport();
            break;
        case 'worker-individual-eff':
            await loadWorkerIndividualEff();
            break;
        case 'wifi':
            await loadWifiSection();
            break;
        case 'material-tracking':
            await loadMaterialTracking();
            break;
    }
}

// ============================================================================
// DASHBOARD
// ============================================================================
async function loadDashboard() {
    const content = document.getElementById('main-content');
    content.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';

    try {
        const response = await fetch(`${API_BASE}/dashboard/stats`);
        const result = await response.json();
        const stats = result.data;

        content.innerHTML = `
            <div class="page-header">
                <div>
                    <h1 class="page-title">Dashboard</h1>
                    <p class="page-subtitle">Welcome to WorkSync Admin Panel</p>
                </div>
            </div>

            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-icon blue">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/>
                        </svg>
                    </div>
                    <div class="stat-info">
                        <h3>${stats.lines_count}</h3>
                        <p>Production Lines</p>
                    </div>
                </div>

                <div class="stat-card">
                    <div class="stat-icon green">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/>
                        </svg>
                    </div>
                    <div class="stat-info">
                        <h3>${stats.employees_count}</h3>
                        <p>Employees</p>
                    </div>
                </div>

                <div class="stat-card">
                    <div class="stat-icon purple">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>
                        </svg>
                    </div>
                    <div class="stat-info">
                        <h3>${stats.products_count}</h3>
                        <p>Styles</p>
                    </div>
                </div>

                <div class="stat-card">
                    <div class="stat-icon orange">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                        </svg>
                    </div>
                    <div class="stat-info">
                        <h3>${stats.operations_count}</h3>
                        <p>Operations</p>
                    </div>
                </div>
            </div>

            <div class="card">
                <div class="card-header">
                    <h3 class="card-title">Quick Actions</h3>
                </div>
                <div class="card-body" style="display: flex; gap: 12px; flex-wrap: wrap;">
                    <button class="btn btn-primary" onclick="loadSection('employees'); document.querySelector('[data-section=employees]').click();">
                        <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/>
                        </svg>
                        Add Employee
                    </button>
                    <button class="btn btn-primary" onclick="loadSection('products'); document.querySelector('[data-section=products]').click();">
                        <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/>
                        </svg>
                        Add Style
                    </button>
                    <button class="btn btn-secondary" onclick="loadSection('operations'); document.querySelector('[data-section=operations]').click();">
                        View Operations Library
                    </button>
                </div>
            </div>
            <div class="card" style="margin-top: 24px;">
                <div class="card-header">
                    <h3 class="card-title">Management Snapshot</h3>
                </div>
                <div class="card-body">
                    <div class="ie-actions" style="flex-wrap:wrap; gap:12px;">
                        <div class="ie-date">
                            <label for="admin-mgmt-date">Date</label>
                            <input type="date" id="admin-mgmt-date" value="${new Date().toISOString().slice(0, 10)}">
                        </div>
                        <div class="ie-date">
                            <label for="admin-mgmt-line-select">Line</label>
                            <select class="form-control" id="admin-mgmt-line-select"></select>
                        </div>
                        <div class="ie-date">
                            <label for="admin-mgmt-hour-select">Hour</label>
                            <select class="form-control" id="admin-mgmt-hour-select"></select>
                        </div>
                    </div>
                    <div class="stats-grid" id="admin-mgmt-stats" style="margin-top:16px;"></div>
                    <div class="card" style="margin-top:16px;">
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
                                <tbody id="admin-mgmt-lines"></tbody>
                            </table>
                        </div>
                    </div>
                    <div class="card" style="margin-top:16px;">
                        <div class="card-header">
                            <h3 class="card-title">Employee Efficiency</h3>
                        </div>
                        <div class="card-body">
                            <div class="table-container">
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
                                    <tbody id="admin-mgmt-employees"></tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                    <div class="card" style="margin-top:16px;">
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
                                <tbody id="admin-mgmt-final-status"></tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        `;
        await adminLoadLineOptions();
        adminLoadHourOptions();
        document.getElementById('admin-mgmt-date')?.addEventListener('change', adminRefreshManagementData);
        document.getElementById('admin-mgmt-line-select')?.addEventListener('change', adminRefreshEmployeeEfficiency);
        document.getElementById('admin-mgmt-hour-select')?.addEventListener('change', adminRefreshEmployeeEfficiency);
        adminRefreshManagementData();
    } catch (err) {
        content.innerHTML = `<div class="alert alert-danger">Error loading dashboard: ${err.message}</div>`;
    }
}

// ============================================================================
// PRODUCTION LINES
// ============================================================================
async function loadLines() {
    const content = document.getElementById('main-content');
    content.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';

    try {
        const linesResponse = await fetch(`${API_BASE}/lines?include_inactive=true`);
        const result = await linesResponse.json();
        const lines = result.data;

        content.innerHTML = `
            <div class="page-header">
                <div>
                    <h1 class="page-title">Production Lines</h1>
                    <p class="page-subtitle">Manage your production lines and halls</p>
                </div>
                <button class="btn btn-primary" onclick="showLineModal()">
                    <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/>
                    </svg>
                    Add Line
                </button>
            </div>

            <div class="card">
                <div class="card-body">
                    <div class="table-container">
                        <table>
                            <thead>
                                <tr>
                                    <th>ID</th>
                                    <th>Code</th>
                                    <th>Name</th>
                                    <th>Hall</th>
                                    <th>Style</th>
                                    <th>Target</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${lines.length === 0 ? `
                                    <tr><td colspan="7" class="text-center" style="padding:40px;">No production lines found.</td></tr>
                                ` : lines.map(line => `
                                    <tr>
                                        <td>${line.id}</td>
                                        <td><strong>${line.line_code}</strong></td>
                                        <td>${line.line_name}</td>
                                        <td>${line.hall_location || '-'}</td>
                                        <td>${line.current_product_code ? `${line.current_product_code} - ${line.current_product_name || ''}` : '-'}</td>
                                        <td>${line.current_product_code ? (line.target_units || 0) : '-'}</td>
                                        <td>
                                            <div class="action-btns">
                                                <button class="btn btn-secondary btn-sm" onclick='showLineModal(${JSON.stringify(line)})'>Edit</button>
                                                <button class="btn btn-primary btn-sm" onclick="viewWorkstationQRs(${line.id}, '${line.line_code}')">WS QR Codes</button>
                                                <button class="btn btn-secondary btn-sm" onclick="deactivateLine(${line.id})">Deactivate</button>
                                                <button class="btn btn-danger btn-sm" onclick="hardDeleteLine(${line.id})">Delete</button>
                                            </div>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
    } catch (err) {
        content.innerHTML = `<div class="alert alert-danger">Error loading lines: ${err.message}</div>`;
    }
}

async function adminLoadLineOptions() {
    const select = document.getElementById('admin-mgmt-line-select');
    if (!select) return;
    const response = await fetch(`${API_BASE}/lines`, { credentials: 'include' });
    const result = await response.json();
    if (!result.success) return;
    select.innerHTML = result.data
        .filter(line => line.is_active)
        .map(line => `<option value="${line.id}">${line.line_name}</option>`)
        .join('');
}

const ADMIN_WORK_HOURS = [8, 9, 10, 11, 13, 14, 15, 16];
const adminHourOrdinal = (n) => {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return `${n}st`;
    if (mod10 === 2 && mod100 !== 12) return `${n}nd`;
    if (mod10 === 3 && mod100 !== 13) return `${n}rd`;
    return `${n}th`;
};
const adminHourRange = (hour) => {
    const start = `${String(hour).padStart(2, '0')}:00`;
    const end = `${String(hour + 1).padStart(2, '0')}:00`;
    return `${start}-${end}`;
};
const adminHourLabel = (hour) => {
    const idx = ADMIN_WORK_HOURS.indexOf(hour);
    const ord = adminHourOrdinal((idx >= 0 ? idx : 0) + 1);
    return `${ord} hour (${adminHourRange(hour)})`;
};

function adminLoadHourOptions() {
    const select = document.getElementById('admin-mgmt-hour-select');
    if (!select) return;
    const now = new Date();
    const defaultHour = ADMIN_WORK_HOURS.includes(now.getHours())
        ? now.getHours()
        : (now.getHours() < ADMIN_WORK_HOURS[0] ? ADMIN_WORK_HOURS[0] : ADMIN_WORK_HOURS[ADMIN_WORK_HOURS.length - 1]);
    select.innerHTML = ADMIN_WORK_HOURS.map((value, i) =>
        `<option value="${value}" ${value === defaultHour ? 'selected' : ''}>${adminHourLabel(value)}</option>`
    ).join('');
}

async function adminSetLatestHour(lineId, date) {
    const select = document.getElementById('admin-mgmt-hour-select');
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

async function adminRefreshManagementData() {
    await Promise.all([
        adminLoadLineMetrics(),
        adminRefreshEmployeeEfficiency(),
        adminLoadFinalStatus()
    ]);
}

async function adminLoadLineMetrics() {
    const date = document.getElementById('admin-mgmt-date')?.value;
    const stats = document.getElementById('admin-mgmt-stats');
    const body = document.getElementById('admin-mgmt-lines');
    if (!date || !stats || !body) return;
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

async function adminRefreshEmployeeEfficiency() {
    const lineId = document.getElementById('admin-mgmt-line-select')?.value;
    const date = document.getElementById('admin-mgmt-date')?.value;
    const hour = document.getElementById('admin-mgmt-hour-select')?.value;
    const tbody = document.getElementById('admin-mgmt-employees');
    if (!lineId || !date || !tbody) return;
    const response = await fetch(`${API_BASE}/supervisor/employee-hourly-efficiency?line_id=${lineId}&date=${date}&hour=${hour}`, { credentials: 'include' });
    const result = await response.json();
    if (!result.success) {
        tbody.innerHTML = `<tr><td colspan="5">${result.error || 'No data'}</td></tr>`;
        return;
    }
    let employees = result.data || [];
    if (!employees.length) {
        const updated = await adminSetLatestHour(lineId, date);
        if (updated) {
            const retryHour = document.getElementById('admin-mgmt-hour-select')?.value;
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

async function adminLoadFinalStatus() {
    const date = document.getElementById('admin-mgmt-date')?.value;
    const tbody = document.getElementById('admin-mgmt-final-status');
    if (!date || !tbody) return;
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

async function showLineModal(line = null) {
    const isEdit = line !== null;
    // Fetch active products for dropdown
    let products = [];
    try {
        const res = await fetch(`${API_BASE}/products`);
        const result = await res.json();
        if (result.success) products = result.data.filter(p => p.is_active);
    } catch (e) { /* ignore */ }

    const currentProductId = line?.current_product_id || '';
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.id = 'line-modal';
    modal.innerHTML = `
        <div class="modal">
            <div class="modal-header">
                <h3 class="modal-title">${isEdit ? 'Edit Line' : 'Add New Line'}</h3>
                <button class="modal-close" onclick="closeModal('line-modal')">
                    <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                    </svg>
                </button>
            </div>
            <div class="modal-body">
                <form id="line-form">
                    <div class="form-group">
                        <label class="form-label">Line Code *</label>
                        <input type="text" class="form-control" name="line_code" value="${line?.line_code || ''}" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Line Name *</label>
                        <input type="text" class="form-control" name="line_name" value="${line?.line_name || ''}" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Hall Location</label>
                        <input type="text" class="form-control" name="hall_location" value="${line?.hall_location || ''}">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Style</label>
                        <select class="form-control" name="current_product_id">
                            <option value="">-- No Style --</option>
                            ${products.map(p => `<option value="${p.id}" ${String(p.id) === String(currentProductId) ? 'selected' : ''}>${p.product_code} — ${p.product_name} (${p.buyer_name || 'No buyer'})</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Target (units)</label>
                        <input type="number" class="form-control" name="target_units" min="0" value="${line?.target_units || 0}">
                    </div>
                    ${isEdit ? `
                    <div class="form-group">
                        <label class="form-label">Status</label>
                        <select class="form-control" name="is_active">
                            <option value="true" ${line.is_active ? 'selected' : ''}>Active</option>
                            <option value="false" ${!line.is_active ? 'selected' : ''}>Inactive</option>
                        </select>
                    </div>
                    ` : ''}
                </form>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="closeModal('line-modal')">Cancel</button>
                <button class="btn btn-primary" onclick="saveLine(${line?.id || 'null'})">${isEdit ? 'Update' : 'Create'}</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    setTimeout(() => modal.classList.add('active'), 10);
}

async function saveLine(id) {
    const form = document.getElementById('line-form');
    const formData = new FormData(form);
    const data = Object.fromEntries(formData);
    if (data.is_active) data.is_active = data.is_active === 'true';
    if (data.target_units === '') data.target_units = 0;
    data.current_product_id = data.current_product_id ? parseInt(data.current_product_id) : null;
    if (data.efficiency !== undefined) {
        delete data.efficiency;
    }

    try {
        const url = id ? `${API_BASE}/lines/${id}` : `${API_BASE}/lines`;
        const method = id ? 'PUT' : 'POST';

        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        const result = await response.json();
        if (result.success) {
            showToast('Line saved successfully', 'success');
            closeModal('line-modal');
            loadLines();
        } else {
            showToast(result.error, 'error');
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function deactivateLine(id) {
    if (!confirm('Are you sure you want to deactivate this line?')) return;

    try {
        const response = await fetch(`${API_BASE}/lines/${id}`, { method: 'DELETE' });
        const result = await response.json();
        if (result.success) {
            showToast('Line deactivated', 'success');
            loadLines();
        } else {
            showToast(result.error, 'error');
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function hardDeleteLine(id) {
    if (!confirm('This will permanently delete the line. Continue?')) return;
    try {
        const response = await fetch(`${API_BASE}/lines/${id}/hard-delete`, { method: 'DELETE' });
        const result = await response.json();
        if (result.success) {
            showToast('Line deleted', 'success');
            loadLines();
        } else {
            showToast(result.error, 'error');
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function viewWorkstationQRs(lineId, lineCode) {
    const existing = document.getElementById('ws-qr-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'ws-qr-modal';
    modal.className = 'modal-backdrop active';
    modal.innerHTML = `
        <div class="modal" style="max-width:960px;width:95vw;">
            <div class="modal-header">
                <h3 class="modal-title">Workstation QR Codes &mdash; ${lineCode}</h3>
                <div style="display:flex;gap:8px;align-items:center;">
                    <button class="btn btn-secondary btn-sm" onclick="printWorkstationQRs()">Print</button>
                    <button class="btn btn-primary btn-sm" id="ws-qr-regen-btn" onclick="regenWorkstationQRs(${lineId}, '${lineCode}')">Regenerate QRs</button>
                    <button class="modal-close" onclick="document.getElementById('ws-qr-modal').remove()">
                        <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                        </svg>
                    </button>
                </div>
            </div>
            <div class="modal-body" style="max-height:75vh;overflow-y:auto;">
                <div id="ws-qr-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:12px;padding:4px;">
                    <div style="text-align:center;color:#6b7280;grid-column:1/-1;">Loading...</div>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    try {
        const res = await fetch(`${API_BASE}/lines/${lineId}/workstations`);
        const result = await res.json();
        const workstations = result.data || [];
        const grid = document.getElementById('ws-qr-grid');

        if (workstations.length === 0) {
            grid.innerHTML = `<div style="text-align:center;color:#6b7280;grid-column:1/-1;padding:20px;">
                No workstations generated yet.
                <button class="btn btn-primary" style="margin-top:8px;" onclick="regenWorkstationQRs(${lineId}, '${lineCode}')">Generate Now</button>
            </div>`;
            return;
        }

        grid.innerHTML = workstations.map(ws => {
            const imgSrc = ws.qr_code_path ? `/${ws.qr_code_path}` : '';
            return `<div class="ws-qr-item" style="text-align:center;border:1px solid #e5e7eb;border-radius:8px;padding:8px;background:#fff;">
                ${imgSrc
                    ? `<img src="${imgSrc}" alt="${ws.workstation_code}" style="width:100px;height:100px;display:block;margin:0 auto 4px;">`
                    : `<div style="width:100px;height:100px;display:flex;align-items:center;justify-content:center;color:#9ca3af;background:#f9fafb;margin:0 auto 4px;border-radius:4px;font-size:0.75em;">No QR</div>`
                }
                <div style="font-weight:700;font-size:0.85em;">${lineCode}</div>
                <div style="font-size:0.82em;color:#4b5563;">${ws.workstation_code}</div>
            </div>`;
        }).join('');
    } catch (err) {
        document.getElementById('ws-qr-grid').innerHTML = `<div style="color:#dc2626;grid-column:1/-1;">${err.message}</div>`;
    }
}

async function regenWorkstationQRs(lineId, lineCode) {
    const btn = document.getElementById('ws-qr-regen-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Generating...'; }
    try {
        const res = await fetch(`${API_BASE}/lines/${lineId}/workstations/generate-qr`, { method: 'POST' });
        const result = await res.json();
        if (result.success) {
            showToast(`Generated ${result.data.count} QR codes for ${lineCode}`, 'success');
            // Reload the grid
            document.getElementById('ws-qr-modal')?.remove();
            viewWorkstationQRs(lineId, lineCode);
        } else {
            showToast(result.error, 'error');
        }
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Regenerate QRs'; }
    }
}

function printWorkstationQRs() {
    const grid = document.getElementById('ws-qr-grid');
    if (!grid) return;
    const title = document.querySelector('#ws-qr-modal .modal-title')?.textContent || 'Workstation QR Codes';
    const win = window.open('', '_blank');
    win.document.write(`<!DOCTYPE html><html><head>
        <title>${title}</title>
        <style>
            body { font-family: sans-serif; margin: 10px; }
            h2 { margin-bottom: 12px; font-size: 16px; }
            .grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 8px; }
            .item { text-align: center; border: 1px solid #ccc; border-radius: 6px; padding: 6px; break-inside: avoid; }
            .item img { width: 90px; height: 90px; display: block; margin: 0 auto 2px; }
            .item .line { font-weight: 700; font-size: 11px; }
            .item .code { font-size: 11px; color: #333; }
            @media print { @page { size: A4; margin: 8mm; } }
        </style>
    </head><body>
        <h2>${title}</h2>
        <div class="grid">
            ${Array.from(grid.querySelectorAll('.ws-qr-item')).map(el => `
                <div class="item">
                    ${el.querySelector('img') ? `<img src="${el.querySelector('img').src}">` : '<div style="width:90px;height:90px;background:#eee;margin:0 auto;"></div>'}
                    <div class="line">${el.querySelector('div[style*="font-weight:700"]')?.textContent || ''}</div>
                    <div class="code">${el.querySelectorAll('div')[1]?.textContent || ''}</div>
                </div>
            `).join('')}
        </div>
        <script>window.onload=()=>window.print();<\/script>
    </body></html>`);
    win.document.close();
}

async function viewLineDetails(lineId) {
    currentView = { type: 'line', lineId };
    const content = document.getElementById('main-content');
    content.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';

    try {
        const [detailsResponse, assignmentsResponse, metricsResponse] = await Promise.all([
            fetch(`${API_BASE}/lines/${lineId}/details`),
            fetch(`${API_BASE}/process-assignments`),
            fetch(`${API_BASE}/lines/${lineId}/metrics`)
        ]);
        const result = await detailsResponse.json();
        if (!result.success) {
            content.innerHTML = `<div class="alert alert-danger">${result.error}</div>`;
            return;
        }
        let { line, processes, assignments, employees, allAssignments, workstations } = result.data;
        workstations = workstations || [];

        // Parse metrics
        let metrics = { takt_time_display: '-', efficiency_percent: 0, actual_output: 0, completion_percent: 0 };
        try {
            const metricsResult = await metricsResponse.json();
            if (metricsResult.success) {
                metrics = metricsResult.data;
            }
        } catch (err) {
            console.warn('Could not load metrics:', err);
        }

        try {
            const assignmentsResult = await assignmentsResponse.json();
            if (assignmentsResult.success) {
                allAssignments = assignmentsResult.data;
            }
        } catch (err) {
            if (!Array.isArray(allAssignments)) {
                allAssignments = [];
            }
        }
        const assignmentMap = new Map(assignments.map(a => [a.process_id, a]));
        window.processAssignmentMap = new Map((allAssignments || []).map(a => [
            `${a.line_id}:${a.process_id}`,
            String(a.employee_id)
        ]));
        window.employeeUsageMap = new Map((allAssignments || []).map(a => [
            String(a.employee_id),
            { processId: `${a.line_id}:${a.process_id}`, lineId: String(a.line_id || '') }
        ]));
        window.currentLineEmployees = employees || [];
        window.currentLineAssignmentMap = new Map(assignments.map(a => [String(a.process_id), String(a.employee_id)]));
        window.currentLineId = String(line.id);

        content.innerHTML = `
            <div class="page-header">
                <div>
                    <h1 class="page-title">${line.line_name} (${line.line_code})</h1>
                    <p class="page-subtitle">Line Details and Process Flow</p>
                </div>
                <div class="flex gap-2">
                    <button class="btn btn-secondary" onclick="loadLines()">
                        <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"/>
                        </svg>
                        Back to Lines
                    </button>
                </div>
            </div>

            <div class="stats-grid" style="grid-template-columns: repeat(6, 1fr);">
                <div class="stat-card">
                    <div class="stat-info">
                        <h3>${line.product_code ? `${line.product_code}` : '-'}</h3>
                        <p>${line.changeover ? 'Primary Style' : 'Current Style'}</p>
                        ${line.changeover ? `<div style="margin-top:4px;font-size:12px;color:#92400e;font-weight:600;">Incoming: ${line.incoming_product_code}</div>` : ''}
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-info">
                        <h3>${metrics.target || line.daily_target_units || line.target_units || 0}</h3>
                        <p>Target (units)</p>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-info">
                        <h3>${metrics.actual_output || 0}</h3>
                        <p>Actual Output</p>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-info">
                        <h3>${metrics.takt_time_display || '-'}</h3>
                        <p>Takt Time</p>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-info">
                        <h3>${Number(metrics.efficiency_percent || 0).toFixed(2)}%</h3>
                        <p>Efficiency</p>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-info">
                        <h3>${processes.length}</h3>
                        <p>Process Steps</p>
                    </div>
                </div>
            </div>

            <div class="card">
                <div class="card-header">
                    <h3 class="card-title">Process Flow with Employee Mapping</h3>
                </div>
                <div class="card-body">
                    ${processes.length === 0 ? `
                        <div class="empty-state">
                            <h3>No process flow configured</h3>
                            <p>Assign a product to this line and define its process flow.</p>
                        </div>
                    ` : `
                        <div class="table-container line-process-table">
                            <table>
                                <thead>
                                    <tr>
                                        ${line.changeover ? '<th>Style</th>' : ''}
                                        <th>Seq</th>
                                        <th>Operation</th>
                                        <th>Style</th>
                                        <th>Workstation</th>
                                        <th>QR</th>
                                        <th>Cycle Time</th>
                                        <th>SAH</th>
                                        <th>Employee</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${(() => {
                                        let lastProductId = null;
                                        return processes.map(proc => {
                                            const assignment = assignmentMap.get(proc.id);
                                            let groupHeader = '';
                                            if (line.changeover && proc.product_id !== lastProductId) {
                                                lastProductId = proc.product_id;
                                                const isPrimary = proc.product_code === line.product_code;
                                                const label = isPrimary ? 'Primary (Outgoing)' : 'Incoming (New)';
                                                const color = isPrimary ? '#dbeafe;color:#1e40af' : '#fef3c7;color:#92400e';
                                                groupHeader = '<tr><td colspan="9" style="background:' + color + ';font-weight:700;padding:8px 12px;font-size:13px;">' + proc.product_code + ' - ' + label + '</td></tr>';
                                            }
                                            return groupHeader + `
                                            <tr data-process-id="${proc.id}">
                                                ${line.changeover ? '<td><span style="font-size:11px;font-weight:600;color:var(--secondary)">' + proc.product_code + '</span></td>' : ''}
                                                <td><span class="process-step-num">${proc.sequence_number}</span></td>
                                                <td>${proc.operation_code} - ${proc.operation_name}</td>
                                                <td><span class="badge badge-info">${proc.operation_category}</span></td>
                                                <td>
                                                    <select class="form-control form-control-sm" style="min-width:120px;font-size:12px;" onchange="assignProcessWorkstation(${proc.id}, this.value)">
                                                        <option value="">-- None --</option>
                                                        ${workstations.map(ws => `<option value="${ws.id}" ${proc.workspace_id == ws.id ? 'selected' : ''}>${ws.workspace_code} - ${ws.workspace_name}</option>`).join('')}
                                                    </select>
                                                </td>
                                                <td>${proc.cycle_time_seconds || 0}s</td>
                                                <td>${parseFloat(proc.operation_sah || 0).toFixed(4)}</td>
                                                <td>
                                                    <div class="employee-dropdown" data-process-id="${proc.id}">
                                                        <button type="button" class="form-control dropdown-toggle" onclick="toggleEmployeeDropdown(${proc.id})">
                                                            ${assignment?.employee_id ? `${assignment.emp_code} - ${assignment.emp_name}` : 'Unassigned'}
                                                        </button>
                                                        <div class="dropdown-panel">
                                                            <input type="text" class="form-control dropdown-search" placeholder="Type to filter..."
                                                                oninput="filterEmployeeList(${proc.id}, this.value)">
                                                            <div class="dropdown-options" id="employee-options-${proc.id}">
                                                                ${buildEmployeeOptions(proc.id)}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                        `;
                                        }).join('');
                                    })()}
                                </tbody>
                            </table>
                        </div>
                    `}
                </div>
            </div>

            <div class="card" id="workstation-assignments-card">
                <div class="card-header">
                    <h3 class="card-title">Workstation Employee Assignments</h3>
                </div>
                <div class="card-body">
                    <div id="ws-assignments-loading">Loading...</div>
                </div>
            </div>
        `;
        // Load workstation assignments
        loadWorkstationAssignments(line.id, processes, employees);
    } catch (err) {
        content.innerHTML = `<div class="alert alert-danger">Error loading line details: ${err.message}</div>`;
    }
}

async function loadWorkstationAssignments(lineId, processes, employees) {
    const container = document.getElementById('ws-assignments-loading');
    if (!container) return;

    // Build unique workstations from product processes
    const wsMap = new Map();
    processes.forEach(proc => {
        const wsCode = (proc.workstation_code || '').trim();
        if (wsCode && !wsMap.has(wsCode)) {
            wsMap.set(wsCode, { code: wsCode, processes: [] });
        }
        if (wsCode) wsMap.get(wsCode).processes.push(proc);
    });

    if (wsMap.size === 0) {
        container.innerHTML = '<div class="alert alert-info">No workstations defined in the product process flow.</div>';
        return;
    }

    // Fetch current workstation assignments
    let assignments = [];
    try {
        const res = await fetch(`${API_BASE}/workstation-assignments?line_id=${lineId}`);
        const result = await res.json();
        if (result.success) assignments = result.data;
    } catch (err) { /* ignore */ }

    const assignMap = new Map(assignments.map(a => [a.workstation_code, a]));

    const rows = Array.from(wsMap.values()).map(ws => {
        const assigned = assignMap.get(ws.code);
        const processNames = ws.processes.map(p => p.operation_name).join(', ');
        const empOptions = (employees || []).filter(e => e.is_active !== false).map(e =>
            `<option value="${e.id}" ${assigned && assigned.employee_id === e.id ? 'selected' : ''}>${e.emp_code} - ${e.emp_name}</option>`
        ).join('');

        return `<tr>
            <td style="font-weight:600;">${ws.code}</td>
            <td style="font-size:13px;">${processNames}</td>
            <td>
                <select class="form-control form-control-sm" style="min-width:160px;" onchange="saveWorkstationAssignment(${lineId}, '${ws.code.replace(/'/g, "\\'")}', this.value)">
                    <option value="">-- Unassigned --</option>
                    ${empOptions}
                </select>
            </td>
        </tr>`;
    }).join('');

    container.innerHTML = `
        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th>Workstation</th>
                        <th>Processes</th>
                        <th>Assigned Employee</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    `;
}

async function saveWorkstationAssignment(lineId, workstationCode, employeeId) {
    try {
        const response = await fetch(`${API_BASE}/workstation-assignments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                line_id: lineId,
                workstation_code: workstationCode,
                employee_id: employeeId || null
            })
        });
        const result = await response.json();
        if (result.success) {
            showToast(`Workstation ${workstationCode} ${employeeId ? 'assigned' : 'unassigned'}`, 'success');
        } else {
            showToast(result.error || 'Assignment failed', 'error');
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function saveProcessAssignment(processId, employeeId) {
    try {
        const response = await fetch(`${API_BASE}/process-assignments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ process_id: processId, employee_id: employeeId || null, line_id: window.currentLineId })
        });
        const result = await response.json();
        if (!result.success) {
            showToast(result.error, 'error');
        } else {
            showToast('Assignment updated', 'success');
            applyProcessAssignmentUpdate(processId, employeeId || '', window.currentLineId);
            const dropdown = document.querySelector(`.employee-dropdown[data-process-id="${processId}"]`);
            if (dropdown) dropdown.classList.remove('open');
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function recomputeEmployeeDropdownOptions() {
    const dropdowns = Array.from(document.querySelectorAll('.employee-dropdown'));
    dropdowns.forEach(dropdown => {
        const processId = dropdown.dataset.processId;
        const options = document.getElementById(`employee-options-${processId}`);
        if (options) {
            options.innerHTML = buildEmployeeOptions(processId);
        }
        updateEmployeeDropdownLabel(processId);
        updateEmployeeQrButton(processId);
    });
}

function applyProcessAssignmentUpdate(processId, employeeId, lineId) {
    const lineKey = String(lineId || window.currentLineId || '');
    const processKey = `${lineKey}:${processId}`;
    const newEmployee = employeeId ? String(employeeId) : '';
    const previousEmployee = window.processAssignmentMap?.get(processKey);
    if (previousEmployee) {
        window.employeeUsageMap?.delete(previousEmployee);
    }
    if (newEmployee) {
        window.employeeUsageMap?.set(newEmployee, { processId: processKey, lineId: String(lineId || window.currentLineId || '') });
        window.processAssignmentMap?.set(processKey, newEmployee);
        if (lineKey === String(window.currentLineId || '')) {
            window.currentLineAssignmentMap?.set(String(processId), newEmployee);
        }
    } else {
        window.processAssignmentMap?.delete(processKey);
        if (lineKey === String(window.currentLineId || '')) {
            window.currentLineAssignmentMap?.delete(String(processId));
        }
    }
    recomputeEmployeeDropdownOptions();
}

// ============================================================================
// WORKSTATION MANAGEMENT
// ============================================================================

function showAddWorkstationModal(lineId, productId) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content" style="max-width:450px;">
            <div class="modal-header">
                <h3>Add Workstation</h3>
                <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">&times;</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label class="form-label">Workstation Code *</label>
                    <input type="text" class="form-control" id="ws-code" placeholder="e.g. W1">
                </div>
                <div class="form-group">
                    <label class="form-label">Workstation Name *</label>
                    <input type="text" class="form-control" id="ws-name" placeholder="e.g. Stitching Station 1">
                </div>
                <div class="form-group">
                    <label class="form-label">Group</label>
                    <input type="text" class="form-control" id="ws-group" placeholder="e.g. GROUP1">
                </div>
                <div class="form-group">
                    <label class="form-label">Worker Input Mapping</label>
                    <select class="form-control" id="ws-input-mapping">
                        <option value="FIRST INPUT">FIRST INPUT</option>
                        <option value="CONT" selected>CONT</option>
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label">Type</label>
                    <input type="text" class="form-control" id="ws-type" placeholder="e.g. Stitching, QA, Assembly">
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
                <button class="btn btn-primary" onclick="saveWorkstation(null, ${lineId || 'null'}, ${productId || 'null'})">Save</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

function editWorkstation(ws, lineId, productId) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content" style="max-width:450px;">
            <div class="modal-header">
                <h3>Edit Workstation</h3>
                <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">&times;</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label class="form-label">Workstation Code *</label>
                    <input type="text" class="form-control" id="ws-code" value="${ws.workspace_code || ''}">
                </div>
                <div class="form-group">
                    <label class="form-label">Workstation Name *</label>
                    <input type="text" class="form-control" id="ws-name" value="${ws.workspace_name || ''}">
                </div>
                <div class="form-group">
                    <label class="form-label">Group</label>
                    <input type="text" class="form-control" id="ws-group" value="${ws.group_name || ''}">
                </div>
                <div class="form-group">
                    <label class="form-label">Worker Input Mapping</label>
                    <select class="form-control" id="ws-input-mapping">
                        <option value="FIRST INPUT" ${ws.worker_input_mapping === 'FIRST INPUT' ? 'selected' : ''}>FIRST INPUT</option>
                        <option value="CONT" ${ws.worker_input_mapping !== 'FIRST INPUT' ? 'selected' : ''}>CONT</option>
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label">Type</label>
                    <input type="text" class="form-control" id="ws-type" value="${ws.workspace_type || ''}">
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
                <button class="btn btn-primary" onclick="saveWorkstation(${ws.id}, ${lineId || 'null'}, ${productId || 'null'})">Save</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

async function saveWorkstation(wsId, lineId, productId) {
    const code = document.getElementById('ws-code').value.trim();
    const name = document.getElementById('ws-name').value.trim();
    const type = document.getElementById('ws-type').value.trim();
    const group = document.getElementById('ws-group').value.trim();
    const inputMapping = document.getElementById('ws-input-mapping').value;
    if (!code || !name) {
        showToast('Code and Name are required', 'error');
        return;
    }
    try {
        const url = wsId ? `${API_BASE}/workstations/${wsId}` : `${API_BASE}/workstations`;
        const method = wsId ? 'PUT' : 'POST';
        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                workspace_code: code,
                workspace_name: name,
                workspace_type: type || null,
                line_id: lineId || null,
                group_name: group || null,
                worker_input_mapping: inputMapping || 'CONT'
            })
        });
        const result = await response.json();
        if (!result.success) {
            showToast(result.error, 'error');
            return;
        }
        showToast(wsId ? 'Workstation updated' : 'Workstation created', 'success');
        document.querySelector('.modal-overlay')?.remove();
        if (productId) {
            viewProductProcess(productId);
        } else if (lineId) {
            viewLineDetails(lineId);
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function deleteWorkstation(wsId, lineId) {
    if (!confirm('Delete this workstation? Processes will be unassigned.')) return;
    try {
        const response = await fetch(`${API_BASE}/workstations/${wsId}`, { method: 'DELETE' });
        const result = await response.json();
        if (!result.success) {
            showToast(result.error, 'error');
            return;
        }
        showToast('Workstation deleted', 'success');
        viewLineDetails(lineId);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function assignProcessWorkstation(processId, workspaceId, productId) {
    try {
        const response = await fetch(`${API_BASE}/process-assignments/workspace`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ process_id: processId, workspace_id: workspaceId || null })
        });
        const result = await response.json();
        if (!result.success) {
            showToast(result.error, 'error');
            return;
        }
        showToast('Workstation assignment updated', 'success');
        // Refresh the current view
        if (productId) {
            viewProductProcess(productId);
        } else if (currentView.type === 'line') {
            viewLineDetails(currentView.lineId);
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function buildEmployeeOptions(processId) {
    const processKey = String(processId);
    const employees = window.currentLineEmployees || [];
    const usedMap = window.employeeUsageMap || new Map();
    const assignmentMap = window.currentLineAssignmentMap || new Map();
    const filterValue = window.employeeFilterMap?.get(processKey) || '';
    const normalized = filterValue.trim().toLowerCase();
    const list = employees.map(emp => {
        const empId = String(emp.id);
        const usage = usedMap.get(empId);
        const isUsed = Boolean(usage);
        return {
            id: emp.id,
            label: `${emp.emp_code} - ${emp.emp_name}`,
            isUsed
        };
    }).filter(emp => {
        if (!normalized) return true;
        return emp.label.toLowerCase().includes(normalized);
    }).sort((a, b) => {
        if (a.isUsed !== b.isUsed) return a.isUsed ? 1 : -1;
        return a.label.localeCompare(b.label);
    });

    const options = [
        `<button type="button" class="dropdown-option" onclick="saveProcessAssignment(${processId}, '')">Unassigned</button>`
    ];

    list.forEach(emp => {
        options.push(
            `<button type="button" class="dropdown-option ${emp.isUsed ? 'disabled' : ''}" ${emp.isUsed ? 'disabled' : ''} onclick="${emp.isUsed ? '' : `saveProcessAssignment(${processId}, '${emp.id}')`}">${emp.label}${emp.isUsed ? ' (Assigned)' : ''}</button>`
        );
    });

    return options.join('');
}

function updateEmployeeDropdownLabel(processId) {
    const dropdown = document.querySelector(`.employee-dropdown[data-process-id="${processId}"]`);
    if (!dropdown) return;
    const button = dropdown.querySelector('.dropdown-toggle');
    if (!button) return;
    const assignedId = window.currentLineAssignmentMap?.get(String(processId));
    if (!assignedId) {
        button.textContent = 'Unassigned';
        return;
    }
    const emp = (window.currentLineEmployees || []).find(e => String(e.id) === String(assignedId));
    button.textContent = emp ? `${emp.emp_code} - ${emp.emp_name}` : 'Unassigned';
}


function positionEmployeeDropdown(dropdown) {
    const toggle = dropdown.querySelector('.dropdown-toggle');
    const panel  = dropdown.querySelector('.dropdown-panel');
    if (!toggle || !panel) return;
    const rect = toggle.getBoundingClientRect();
    const panelW = 280;
    // Prefer right-aligned; flip left if panel would go off-screen
    let left = rect.right - panelW;
    if (left < 4) left = rect.left;
    if (left + panelW > window.innerWidth - 4) left = window.innerWidth - panelW - 4;
    // Prefer below; flip above if not enough room
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow > 260 ? rect.bottom + 4 : rect.top - 264;
    panel.style.top  = top  + 'px';
    panel.style.left = left + 'px';
    panel.style.width = panelW + 'px';
}

function toggleEmployeeDropdown(processId) {
    // Close all other dropdowns
    document.querySelectorAll('.employee-dropdown').forEach(dd => {
        if (dd.dataset.processId !== String(processId)) {
            dd.classList.remove('open');
        }
    });

    // Toggle this dropdown
    const dropdown = document.querySelector(`.employee-dropdown[data-process-id="${processId}"]`);
    if (!dropdown) return;

    dropdown.classList.toggle('open');

    if (dropdown.classList.contains('open')) {
        positionEmployeeDropdown(dropdown);
        const search = dropdown.querySelector('.dropdown-search');
        if (search) setTimeout(() => search.focus(), 100);
    }
}

function filterEmployeeList(processId, value) {
    if (!window.employeeFilterMap) {
        window.employeeFilterMap = new Map();
    }
    window.employeeFilterMap.set(String(processId), value || '');
    const options = document.getElementById(`employee-options-${processId}`);
    if (options) {
        options.innerHTML = buildEmployeeOptions(processId);
    }
}

document.addEventListener('click', (event) => {
    const dropdown = event.target.closest('.employee-dropdown');
    if (dropdown) return;
    document.querySelectorAll('.employee-dropdown.open').forEach(dd => dd.classList.remove('open'));
});

// Reposition open dropdown on scroll or resize
function _repositionOpenDropdowns() {
    document.querySelectorAll('.employee-dropdown.open').forEach(positionEmployeeDropdown);
}
window.addEventListener('scroll', _repositionOpenDropdowns, { passive: true, capture: true });
window.addEventListener('resize', _repositionOpenDropdowns, { passive: true });

// ============================================================================
// EMPLOYEES
// ============================================================================
let allEmployees = [];
let allLines = [];
let employeeQrExportSelection = new Set();

function resetEmployeeQrExportSelection(employees) {
    employeeQrExportSelection = new Set((employees || []).map(emp => String(emp.id)));
}

function areAllEmployeesSelected() {
    return allEmployees.length > 0 && employeeQrExportSelection.size === allEmployees.length;
}

function syncEmployeeSelectAllCheckbox() {
    const checkbox = document.getElementById('employees-select-all');
    if (!checkbox) return;
    const total = allEmployees.length;
    const selected = employeeQrExportSelection.size;
    checkbox.checked = total > 0 && selected === total;
    checkbox.indeterminate = selected > 0 && selected < total;
    const countEl = document.getElementById('employees-export-selected-count');
    if (countEl) countEl.textContent = `${selected} selected`;
}

function toggleEmployeeQrSelection(employeeId, checked) {
    const key = String(employeeId);
    if (checked) employeeQrExportSelection.add(key);
    else employeeQrExportSelection.delete(key);
    syncEmployeeSelectAllCheckbox();
}

function toggleAllEmployeesForQrExport(checked) {
    if (checked) {
        resetEmployeeQrExportSelection(allEmployees);
    } else {
        employeeQrExportSelection.clear();
    }
    document.querySelectorAll('.employee-export-checkbox').forEach(cb => {
        cb.checked = checked;
    });
    syncEmployeeSelectAllCheckbox();
}

async function downloadSelectedEmployeesQrExcel() {
    const selectedIds = [...employeeQrExportSelection];
    if (!selectedIds.length) {
        showToast('Select at least one employee', 'error');
        return;
    }
    await downloadEmployeeQrExcelForIds(selectedIds, 'employee_qr_codes');
}

async function downloadEmployeeQrExcelForIds(employeeIds, filenameBase = 'employee_qr_codes') {
    if (!Array.isArray(employeeIds) || !employeeIds.length) {
        showToast('Select at least one employee', 'error');
        return;
    }
    try {
        const response = await fetch(`${API_BASE}/employees/qr-export`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ employee_ids: employeeIds })
        });
        if (!response.ok) {
            let message = 'Failed to download employee QR Excel';
            try {
                const error = await response.json();
                message = error.error || message;
            } catch (err) {
                // ignore
            }
            throw new Error(message);
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${filenameBase}_${new Date().toISOString().slice(0, 10)}.xlsx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        showToast('Employee QR Excel downloaded', 'success');
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function buildEmployeeRows(employees, showActions) {
    return employees.map((emp, index) => `
        <tr>
            <td style="text-align:center;">
                <input type="checkbox" class="employee-export-checkbox"
                    ${employeeQrExportSelection.has(String(emp.id)) ? 'checked' : ''}
                    onchange="toggleEmployeeQrSelection('${emp.id}', this.checked)">
            </td>
            <td>${index + 1}</td>
            <td><strong>${emp.emp_code}</strong></td>
            <td>${emp.emp_name}</td>
            <td>${emp.designation || '-'}</td>
            <td>${Number(emp.manpower_factor || 1).toFixed(2)}</td>
            <td>${formatEmployeeWork(emp) || '-'}</td>
            <td>${emp.qr_code_path ? '<span class="badge badge-success">Yes</span>' : '<span class="badge badge-warning">No</span>'}</td>
            <td><span class="badge ${emp.is_active ? 'badge-success' : 'badge-danger'}">${emp.is_active ? 'Active' : 'Inactive'}</span></td>
            <td>
                <button class="btn btn-secondary btn-sm" ${emp.qr_code_path ? '' : 'disabled'} onclick='showEmployeeQrModal(${JSON.stringify(emp)})'>View QR</button>
            </td>
            ${showActions ? `
                <td>
                    <div class="action-btns">
                        <button class="btn btn-secondary btn-sm" onclick='showEmployeeWorkModal(${JSON.stringify(emp)})'>Assign Work</button>
                        <button class="btn btn-secondary btn-sm" onclick='showEmployeeModal(${JSON.stringify(emp)})'>Edit</button>
                        <button class="btn btn-danger btn-sm" onclick="deleteEmployee(${emp.id})">Delete</button>
                    </div>
                </td>
            ` : ''}
        </tr>
    `).join('');
}

async function loadEmployees() {
    const content = document.getElementById('main-content');
    content.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';

    try {
        const [empResponse, linesResponse] = await Promise.all([
            fetch(`${API_BASE}/employees`),
            fetch(`${API_BASE}/lines`)
        ]);

        const empResult = await empResponse.json();
        const linesResult = await linesResponse.json();

        allEmployees = empResult.data;
        allLines = linesResult.data;
        resetEmployeeQrExportSelection(allEmployees);

        renderEmployeesTable(allEmployees);
    } catch (err) {
        content.innerHTML = `<div class="alert alert-danger">Error loading employees: ${err.message}</div>`;
    }
}

function renderEmployeesTable(employees) {
    const content = document.getElementById('main-content');
    const showActions = !isIeMode;
    content.innerHTML = `
        <div class="page-header">
            <div>
                <h1 class="page-title">Employees</h1>
                <p class="page-subtitle">Manage workforce and their assignments</p>
            </div>
            <div style="display:flex;gap:10px;flex-wrap:wrap;">
                <button class="btn btn-secondary" onclick="downloadSelectedEmployeesQrExcel()">
                    <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v10m0 0l-4-4m4 4l4-4M5 19h14"/>
                    </svg>
                    Download QR Excel
                </button>
                ${showActions ? `
                    <button class="btn btn-primary" onclick="showEmployeeModal()">
                        <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/>
                        </svg>
                        Add Employee
                    </button>
                ` : ''}
            </div>
        </div>

        <div class="card">
            <div class="card-body">
                <div class="toolbar">
                    <div class="search-box">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
                        </svg>
                        <input type="text" placeholder="Search employees..." onkeyup="filterEmployees(this.value)">
                    </div>
                    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:13px;color:var(--secondary);">
                        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                            <input type="checkbox" id="employees-select-all" checked onchange="toggleAllEmployeesForQrExport(this.checked)">
                            <span>Select all for Excel</span>
                        </label>
                        <span id="employees-export-selected-count">${employeeQrExportSelection.size} selected</span>
                    </div>
                </div>

                <div class="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th style="width:52px;text-align:center;">Pick</th>
                                <th>S.No</th>
                                <th>Code</th>
                                <th>Name</th>
                                <th>Designation</th>
                                <th>MP</th>
                                <th>Current Work</th>
                                <th>QR Code</th>
                                <th>Status</th>
                                <th>View QR</th>
                                ${showActions ? '<th>Actions</th>' : ''}
                            </tr>
                        </thead>
                        <tbody id="employees-table-body">
                            ${buildEmployeeRows(employees, showActions)}
                        </tbody>
                    </table>
                </div>

                <div class="mt-4" style="color: var(--secondary); font-size: 14px;">
                    Showing ${employees.length} of ${allEmployees.length} employees
                </div>
            </div>
        </div>
    `;
    syncEmployeeSelectAllCheckbox();
}

function filterEmployees(search) {
    const filtered = allEmployees.filter(emp =>
        emp.emp_code.toLowerCase().includes(search.toLowerCase()) ||
        emp.emp_name.toLowerCase().includes(search.toLowerCase()) ||
        (emp.designation && emp.designation.toLowerCase().includes(search.toLowerCase()))
    );
    updateEmployeesTableBody(filtered);
}

function updateEmployeesTableBody(employees) {
    const tbody = document.getElementById('employees-table-body');
    const showActions = !isIeMode;
    tbody.innerHTML = buildEmployeeRows(employees, showActions);
    syncEmployeeSelectAllCheckbox();
}

function formatEmployeeWork(emp) {
    if (!emp || !emp.operation_code) return '';
    const product = emp.product_code ? `${emp.product_code} - ` : '';
    return `${product}${emp.operation_code} ${emp.operation_name || ''}`.trim();
}

function showEmployeeModal(emp = null) {
    const isEdit = emp !== null;
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.id = 'employee-modal';
    modal.innerHTML = `
        <div class="modal">
            <div class="modal-header">
                <h3 class="modal-title">${isEdit ? 'Edit Employee' : 'Add New Employee'}</h3>
                <button class="modal-close" onclick="closeModal('employee-modal')">
                    <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                    </svg>
                </button>
            </div>
            <div class="modal-body">
                <form id="employee-form">
                    <div class="form-group">
                        <label class="form-label">Employee Code *</label>
                        <input type="text" class="form-control" name="emp_code" value="${emp?.emp_code || ''}" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Employee Name *</label>
                        <input type="text" class="form-control" name="emp_name" value="${emp?.emp_name || ''}" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Designation</label>
                        <input type="text" class="form-control" name="designation" value="${emp?.designation || ''}">
                    </div>
                    <div class="form-group">
                        <label class="form-label">MP Override</label>
                        <input type="number" class="form-control" name="manpower_factor" min="0.1" step="0.1" value="${emp?.manpower_factor || 1}">
                    </div>
                    ${isEdit ? `
                    <div class="form-group">
                        <label class="form-label">Status</label>
                        <select class="form-control" name="is_active">
                            <option value="true" ${emp.is_active ? 'selected' : ''}>Active</option>
                            <option value="false" ${!emp.is_active ? 'selected' : ''}>Inactive</option>
                        </select>
                    </div>
                    ` : ''}
                </form>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="closeModal('employee-modal')">Cancel</button>
                <button class="btn btn-primary" onclick="saveEmployee(${emp?.id || 'null'})">${isEdit ? 'Update' : 'Create'}</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    setTimeout(() => modal.classList.add('active'), 10);
}

function getEmployeeQrUrl(qrPath) {
    if (!qrPath) return '';
    if (qrPath.startsWith('/qrcodes/')) return qrPath;
    const marker = '/qrcodes/';
    const idx = qrPath.indexOf(marker);
    if (idx !== -1) return qrPath.slice(idx);
    const normalized = qrPath.replace(/^\/+/, '');
    if (normalized.startsWith('qrcodes/')) {
        return `/${normalized}`;
    }
    return `/qrcodes/${normalized}`;
}


function showEmployeeQrModal(emp) {
    if (!emp || !emp.qr_code_path) return;
    const qrUrl = getEmployeeQrUrl(emp.qr_code_path);
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.id = 'qr-modal';
    modal.innerHTML = `
        <div class="modal" style="max-width: 420px;">
            <div class="modal-header">
                <h3 class="modal-title">QR Code - ${emp.emp_code}</h3>
                <button class="modal-close" onclick="closeModal('qr-modal')">
                    <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                    </svg>
                </button>
            </div>
            <div class="modal-body" style="text-align: center;">
                <img src="${qrUrl}" alt="QR Code for ${emp.emp_code}" style="max-width: 100%; height: auto;">
                <div style="margin-top: 12px; color: var(--secondary); font-size: 14px;">
                    ${emp.emp_name}
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="closeModal('qr-modal')">Close</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    setTimeout(() => modal.classList.add('active'), 10);
}

async function showEmployeeWorkModal(emp) {
    const modalId = 'employee-work-modal';
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.id = modalId;
    modal.innerHTML = `
        <div class="modal">
            <div class="modal-header">
                <h3 class="modal-title">Assign Work - ${emp.emp_code}</h3>
                <button class="modal-close" onclick="closeModal('${modalId}')">
                    <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                    </svg>
                </button>
            </div>
            <div class="modal-body">
                <div id="employee-work-body" class="loading-overlay"><div class="spinner"></div></div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="closeModal('${modalId}')">Cancel</button>
                <button class="btn btn-primary" id="employee-work-save">Save</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    setTimeout(() => modal.classList.add('active'), 10);

    try {
        const response = await fetch(`${API_BASE}/employees/${emp.id}/work-options`);
        const result = await response.json();
        if (!result.success) {
            document.getElementById('employee-work-body').innerHTML = `<div class="alert alert-danger">${result.error}</div>`;
            return;
        }
        const { processes, current_process_id } = result.data;
        const body = document.getElementById('employee-work-body');
        if (!processes.length) {
            body.innerHTML = `
                <div class="alert alert-warning">
                    No process flow found for this employee's line. Assign a product to the line and define its process flow.
                </div>
            `;
            document.getElementById('employee-work-save').disabled = true;
            return;
        }

        body.innerHTML = `
            <div class="form-group">
                <label class="form-label">Select Work (Process)</label>
                <select class="form-control" id="employee-work-select">
                    <option value="">Unassigned</option>
                    ${processes.map(proc => `
                        <option value="${proc.id}" ${current_process_id == proc.id ? 'selected' : ''}>
                            ${proc.sequence_number}. ${proc.operation_code} - ${proc.operation_name}
                        </option>
                    `).join('')}
                </select>
            </div>
        `;

        document.getElementById('employee-work-save').onclick = () => {
            const selected = document.getElementById('employee-work-select').value || null;
            saveEmployeeWorkAssignment(emp.id, selected);
        };
    } catch (err) {
        document.getElementById('employee-work-body').innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    }
}

async function saveEmployeeWorkAssignment(employeeId, processId) {
    try {
        const response = await fetch(`${API_BASE}/process-assignments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ process_id: processId, employee_id: employeeId })
        });
        const result = await response.json();
        if (result.success) {
            showToast('Work assignment updated', 'success');
            closeModal('employee-work-modal');
            loadEmployees();
        } else {
            showToast(result.error, 'error');
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function saveEmployee(id) {
    const form = document.getElementById('employee-form');
    const formData = new FormData(form);
    const data = Object.fromEntries(formData);
    if (data.is_active) data.is_active = data.is_active === 'true';
    if (data.default_line_id === '') data.default_line_id = null;

    try {
        const url = id ? `${API_BASE}/employees/${id}` : `${API_BASE}/employees`;
        const method = id ? 'PUT' : 'POST';

        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        const result = await response.json();
        if (result.success) {
            showToast('Employee saved successfully', 'success');
            closeModal('employee-modal');
            loadEmployees();
        } else {
            showToast(result.error, 'error');
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function deleteEmployee(id) {
    if (!confirm('Are you sure you want to deactivate this employee?')) return;

    try {
        const response = await fetch(`${API_BASE}/employees/${id}`, { method: 'DELETE' });
        const result = await response.json();
        if (result.success) {
            showToast('Employee deactivated', 'success');
            loadEmployees();
        } else {
            showToast(result.error, 'error');
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ============================================================================
// PRODUCTS
// ============================================================================
async function loadProducts() {
    const content = document.getElementById('main-content');
    content.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';

    try {
        const [productsResponse, linesResponse] = await Promise.all([
            fetch(`${API_BASE}/products`),
            fetch(`${API_BASE}/lines`)
        ]);
        const productsResult = await productsResponse.json();
        const linesResult = await linesResponse.json();
        const products = productsResult.data;
        allLines = linesResult.data;

        content.innerHTML = `
            <div class="page-header">
                <div>
                    <h1 class="page-title">Styles</h1>
                    <p class="page-subtitle">Manage styles and their process flows. Line assignment is handled in Daily Plans.</p>
                </div>
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                    <button class="btn btn-primary" onclick="showProductModal()">
                        <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/>
                        </svg>
                        Add Style
                    </button>
                    <button class="btn btn-secondary" onclick="downloadProductTemplate()">
                        <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3M3 17v3a2 2 0 002 2h14a2 2 0 002-2v-3"/>
                        </svg>
                        Download Template
                    </button>
                    <button class="btn btn-secondary" onclick="document.getElementById('excel-upload-input').click()">
                        <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>
                        </svg>
                        Upload Excel
                    </button>
                    <input type="file" id="excel-upload-input" accept=".xlsx,.xls" style="display:none" onchange="handleProductExcelUpload(this)">
                </div>
            </div>

            <div class="card">
                <div class="card-body">
                    <div class="table-container">
                        <table>
                            <thead>
                                <tr>
                                    <th>Buyer</th>
                                    <th>Description</th>
                                    <th>Style No</th>
                                    <th>Plan Month</th>
                                    <th>Order Qty / Produced</th>
                                    <th>Assigned Line</th>
                                    <th>Today (Primary)</th>
                                    <th>Today (Incoming)</th>
                                    <th>Operations</th>
                                    <th>Total SAH</th>
                                    <th>Status</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${products.length === 0 ? `
                                    <tr>
                                        <td colspan="12" class="text-center" style="padding: 40px;">
                                            No styles found. Click "Add Style" to create one.
                                        </td>
                                    </tr>
                                ` : products.map(prod => `
                                    <tr style="cursor:pointer;" onclick="viewProductProcess(${prod.id})">
                                        <td onclick="event.stopPropagation()">
                                            <div>${prod.buyer_name || '-'}</div>
                                            <div style="font-size:0.75em;color:var(--text-muted);margin-top:2px;">${prod.category || ''}</div>
                                        </td>
                                        <td>${prod.product_description || prod.product_name}</td>
                                        <td onclick="event.stopPropagation()"><strong>${prod.product_code}</strong></td>
                                        <td style="text-align:center;">
                                            ${prod.plan_month ? (() => {
                                                const [y, m] = prod.plan_month.split('-');
                                                const months = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                                                return `<span style="font-weight:600;color:#1e40af;">${months[parseInt(m)]} ${y}</span>`;
                                            })() : '<span style="color:#9ca3af;">—</span>'}
                                        </td>
                                        <td>
                                            ${(() => {
                                                const oq = prod.target_qty || 0;
                                                const cum = prod.cumulative_output || 0;
                                                const pct = oq > 0 ? Math.round(cum / oq * 100) : 0;
                                                const complete = oq > 0 && cum >= oq;
                                                const over = oq > 0 && cum > oq;
                                                const barPct = oq > 0 ? Math.min(pct, 100) : 0;
                                                return `<div style="font-size:12px;font-weight:600;">${cum.toLocaleString()} / ${oq.toLocaleString()}</div>
                                                <div style="background:#e5e7eb;border-radius:4px;height:6px;margin:3px 0;width:100px;">
                                                    <div style="background:${over ? '#f59e0b' : complete ? '#16a34a' : '#3b82f6'};width:${barPct}%;height:100%;border-radius:4px;"></div>
                                                </div>
                                                ${over
                                                    ? `<span style="background:#fef3c7;color:#92400e;font-size:10px;font-weight:700;padding:1px 6px;border-radius:4px;">⚠ +${(cum - oq).toLocaleString()} OVER</span>`
                                                    : complete
                                                        ? '<span style="background:#dcfce7;color:#15803d;font-size:10px;font-weight:700;padding:1px 6px;border-radius:4px;">✓ COMPLETE</span>'
                                                        : `<span style="font-size:10px;color:#6b7280;">${pct}%</span>`}`;
                                            })()}
                                        </td>
                                        <td>${prod.line_names || '-'}</td>
                                        <td>${prod.today_primary_lines || '-'}</td>
                                        <td>${prod.today_incoming_lines || '-'}</td>
                                        <td><span class="badge badge-info">${prod.operations_count} ops</span></td>
                                        <td>${parseFloat(prod.total_sah || 0).toFixed(4)} hrs</td>
                                        <td>
                                            <span class="badge ${prod.is_active ? 'badge-success' : 'badge-danger'}">
                                                ${prod.is_active ? 'Active' : 'Inactive'}
                                            </span>
                                            ${prod.today_incoming_line_ids?.length
                                                ? '<span class="badge" style="margin-left:6px;background:#fef3c7;color:#92400e;">Changeover Today</span>'
                                                : ''}
                                        </td>
                                        <td onclick="event.stopPropagation()">
                                            <div class="action-btns">
                                                <button class="btn btn-secondary btn-sm" onclick='showProductModal(${JSON.stringify(prod)})'>Edit</button>
                                                <button class="btn btn-secondary btn-sm" onclick="exportProductExcel(${prod.id})">Export</button>
                                                <button class="btn btn-danger btn-sm" onclick="deleteProduct(${prod.id})">Delete</button>
                                            </div>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
    } catch (err) {
        content.innerHTML = `<div class="alert alert-danger">Error loading products: ${err.message}</div>`;
    }
}

function downloadProductTemplate() {
    window.location.href = `${API_BASE}/products/upload-template`;
}

function exportProductExcel(productId) {
    window.location.href = `${API_BASE}/products/export/${productId}`;
}

async function handleProductExcelUpload(input) {
    const file = input.files[0];
    if (!file) return;
    input.value = ''; // Reset so same file can be re-uploaded

    const formData = new FormData();
    formData.append('file', file);

    // Show loading overlay
    const content = document.getElementById('main-content');
    const overlay = document.createElement('div');
    overlay.className = 'loading-overlay';
    overlay.innerHTML = '<div class="spinner"></div><p style="margin-top:16px;color:#6b7280;">Uploading and processing Excel file...</p>';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(255,255,255,0.85);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:9999;';
    document.body.appendChild(overlay);

    try {
        const response = await fetch(`${API_BASE}/products/upload-excel`, {
            method: 'POST',
            body: formData
        });
        const result = await response.json();
        document.body.removeChild(overlay);

        if (result.success) {
            const d = result.data;
            let msg = `Product "${d.description}" (Style: ${d.style_no}) ${d.product_action} successfully.\n`;
            msg += `${d.total_processes} processes imported.`;
            if (d.new_operations_created > 0) {
                msg += `\n${d.new_operations_created} new operation(s) auto-created:\n`;
                msg += d.new_operations.map(op => `  ${op.code} - ${op.name}`).join('\n');
            }
            alert(msg);
            loadProducts();
        } else {
            alert('Upload failed: ' + (result.error || 'Unknown error'));
        }
    } catch (err) {
        if (document.body.contains(overlay)) document.body.removeChild(overlay);
        alert('Upload error: ' + err.message);
    }
}

function showProductModal(prod = null) {
    const isEdit = prod !== null;
    const lines = allLines || [];
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.id = 'product-modal';
    modal.innerHTML = `
        <div class="modal">
            <div class="modal-header">
                <h3 class="modal-title">${isEdit ? 'Edit Product' : 'Add New Product'}</h3>
                <button class="modal-close" onclick="closeModal('product-modal')">
                    <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                    </svg>
                </button>
            </div>
            <div class="modal-body">
                <form id="product-form">
                    <div class="form-group">
                        <label class="form-label">Product (Category)</label>
                        <input type="text" class="form-control" name="category" value="${prod?.category || ''}" placeholder="e.g. SLG, BAG, WALLET">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Buyer Name</label>
                        <input type="text" class="form-control" name="buyer_name" value="${prod?.buyer_name || ''}">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Style No *</label>
                        <input type="text" class="form-control" name="product_code" value="${prod?.product_code || ''}" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Description *</label>
                        <input type="text" class="form-control" name="product_name" value="${prod?.product_name || ''}" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Order Quantity (Total units to produce)</label>
                        <input type="number" class="form-control" name="target_qty" value="${prod?.target_qty || 0}" min="0">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Plan Month (Month this style is planned for production)</label>
                        <input type="month" class="form-control" name="plan_month" value="${prod?.plan_month || ''}">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Line Assignment</label>
                        <div class="alert alert-info" style="margin:0;">
                            Line assignment is managed in <strong>Line Product Setup</strong> (Daily Plan).
                            Set primary and changeover products there.
                        </div>
                    </div>
                    ${isEdit ? `
                    <div class="form-group">
                        <label class="form-label">Status</label>
                        <select class="form-control" name="is_active">
                            <option value="true" ${prod.is_active ? 'selected' : ''}>Active</option>
                            <option value="false" ${!prod.is_active ? 'selected' : ''}>Inactive</option>
                        </select>
                    </div>
                    ` : ''}
                </form>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="closeModal('product-modal')">Cancel</button>
                <button class="btn btn-primary" onclick="saveProduct(${prod?.id || 'null'})">${isEdit ? 'Update' : 'Create'}</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    setTimeout(() => modal.classList.add('active'), 10);
}

async function saveProduct(id) {
    const form = document.getElementById('product-form');
    const formData = new FormData(form);
    const data = Object.fromEntries(formData);
    if (data.is_active) data.is_active = data.is_active === 'true';
    if (data.target_qty != null) data.target_qty = parseInt(data.target_qty) || 0;

    try {
        const url = id ? `${API_BASE}/products/${id}` : `${API_BASE}/products`;
        const method = id ? 'PUT' : 'POST';

        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        const result = await response.json();
        if (result.success) {
            showToast('Product saved successfully', 'success');
            closeModal('product-modal');
            loadProducts();
        } else {
            showToast(result.error, 'error');
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function deleteProduct(id) {
    if (!confirm('Are you sure you want to deactivate this product?')) return;

    try {
        const response = await fetch(`${API_BASE}/products/${id}`, { method: 'DELETE' });
        const result = await response.json();
        if (result.success) {
            showToast('Product deactivated', 'success');
            loadProducts();
        } else {
            showToast(result.error, 'error');
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function viewProductProcess(productId) {
    currentView = { type: 'process', productId };
    const content = document.getElementById('main-content');
    content.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';

    try {
        const [productRes, operationsRes] = await Promise.all([
            fetch(`${API_BASE}/products/${productId}`),
            fetch(`${API_BASE}/operations`)
        ]);

        const productResult = await productRes.json();
        const operationsResult = await operationsRes.json();

        const { product, processes } = productResult.data;
        const allOperations = operationsResult.data;

        // Flat list sorted by sequence_number
        const sorted = [...processes].sort((a, b) => a.sequence_number - b.sequence_number);
        const tableRows = sorted.map(proc => {
            const samSec = ((parseFloat(proc.operation_sah || 0)) * 3600).toFixed(1);
            return `<tr>
                <td style="text-align:center;">${proc.sequence_number}</td>
                <td>${proc.operation_name}</td>
                <td style="text-align:center;">${samSec}</td>
                <td>
                    <div class="action-btns">
                        <button class="btn btn-secondary btn-sm" onclick='editProcess(${JSON.stringify(proc)}, ${productId})'>Edit</button>
                        <button class="btn btn-danger btn-sm" onclick="deleteProcess(${proc.id}, ${productId})">Remove</button>
                    </div>
                </td>
            </tr>`;
        }).join('');

        content.innerHTML = `
            <div class="page-header">
                <div>
                    <h1 class="page-title">Workers - Processwise Details</h1>
                    <p class="page-subtitle">Process Flow Management</p>
                </div>
                <div class="flex gap-2">
                    <button class="btn btn-secondary" onclick="loadProducts()">
                        <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"/>
                        </svg>
                        Back to Products
                    </button>
                    <button class="btn btn-secondary" onclick="exportProductExcel(${productId})">
                        <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3M3 17v3a2 2 0 002 2h14a2 2 0 002-2v-3"/>
                        </svg>
                        Export Excel
                    </button>
                    <button class="btn btn-primary" onclick="showAddProcessModal(${productId})">
                        <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/>
                        </svg>
                        Add Operation
                    </button>
                </div>
            </div>

            <div class="card" style="margin-bottom:16px;">
                <div class="card-body" style="padding:0;">
                    <table style="width:100%;border-collapse:collapse;">
                        <tbody>
                            <tr><td style="padding:8px 16px;font-weight:600;width:40%;border-bottom:1px solid var(--border);">PRODUCT</td><td style="padding:8px 16px;border-bottom:1px solid var(--border);">${product.category || '-'}</td></tr>
                            <tr><td style="padding:8px 16px;font-weight:600;border-bottom:1px solid var(--border);">BUYER</td><td style="padding:8px 16px;border-bottom:1px solid var(--border);">${product.buyer_name || '-'}</td></tr>
                            <tr><td style="padding:8px 16px;font-weight:600;border-bottom:1px solid var(--border);">STYLE NO</td><td style="padding:8px 16px;border-bottom:1px solid var(--border);">${product.product_code}</td></tr>
                            <tr><td style="padding:8px 16px;font-weight:600;">DESCRIPTION</td><td style="padding:8px 16px;">${product.product_name}</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <div class="card">
                <div class="card-body">
                    ${processes.length === 0 ? `
                        <div class="empty-state">
                            <h3>No operations defined</h3>
                            <p>Click "Add Operation" to define the process flow</p>
                        </div>
                    ` : `
                        <div class="table-container">
                            <table>
                            <thead>
                                <tr>
                                    <th style="text-align:center;">Seq</th>
                                    <th>Process Details</th>
                                    <th style="text-align:center;">SAM (sec)</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${tableRows}
                            </tbody>
                            </table>
                        </div>
                    `}
                </div>
            </div>
        `;

        // Store operations for modal
        window.currentAllOperations = allOperations;
        window.currentProductId = productId;

    } catch (err) {
        content.innerHTML = `<div class="alert alert-danger">Error: ${err.message}</div>`;
    }
}

function setupRealtime() {
    // Use SSE Manager if available, fallback to direct EventSource
    if (typeof SSEManager !== 'undefined') {
        SSEManager.init('/events');
        SSEManager.on('data_change', (data) => {
            scheduleRealtimeRefresh(data || {});
        });
        window.realtimeSource = SSEManager;
    } else {
        // Fallback for older browsers
        const source = new EventSource('/events');
        source.addEventListener('data_change', (event) => {
            let payload = {};
            try {
                payload = JSON.parse(event.data || '{}');
            } catch (err) {
                return;
            }
            scheduleRealtimeRefresh(payload);
        });
        source.onerror = () => {
            source.close();
            setTimeout(setupRealtime, 3000);
        };
        window.realtimeSource = source;
    }
}

function scheduleRealtimeRefresh(payload) {
    if (realtimeRefreshTimer) {
        clearTimeout(realtimeRefreshTimer);
    }
    if (payload && payload.work_date) {
        const planDate = document.getElementById('plan-date')?.value;
        const currentDateInput = document.getElementById('attendance-date')?.value;
        const dateMatch = !planDate || payload.work_date === planDate || !currentDateInput || payload.work_date === currentDateInput;
        if (!dateMatch) {
            return;
        }
    }
    realtimeRefreshTimer = setTimeout(() => {
        realtimeRefreshTimer = null;
        const entity = payload.entity;
        if (currentView.type === 'process') {
            if (payload.entity === 'product_processes' && payload.product_id) {
                viewProductProcess(payload.product_id);
            } else {
                viewProductProcess(currentView.productId);
            }
            return;
        }
        if (currentView.type === 'line') {
            if ((entity === 'process_assignments' || entity === 'employee_process_assignments') && payload.process_id !== undefined) {
                applyProcessAssignmentUpdate(payload.process_id, payload.employee_id, payload.line_id);
                return;
            }
            if (['lines', 'products', 'product_processes', 'employees'].includes(entity)) {
                viewLineDetails(currentView.lineId);
            }
            return;
        }
        if (currentSection === 'dashboard') {
            loadDashboard();
            adminRefreshManagementData();
            if (payload.entity === 'progress') {
                const lineId = document.getElementById('admin-mgmt-line-select')?.value;
                if (payload.line_id && lineId && String(payload.line_id) !== String(lineId)) {
                    return;
                }
                const hourSelect = document.getElementById('admin-mgmt-hour-select');
                if (hourSelect && payload.hour_slot !== undefined) {
                    hourSelect.value = String(payload.hour_slot);
                }
                adminRefreshEmployeeEfficiency();
            }
            return;
        }
        if (currentSection === 'attendance' && payload.entity === 'attendance') {
            loadAttendanceSection();
            return;
        }
        if (currentSection === 'daily-plan' && payload.entity === 'daily_plans') {
            loadDailyPlans();
            return;
        }
        if (currentSection === 'osm' && payload.entity === 'daily_plans') {
            refreshOsmReport();
            return;
        }
        if (currentSection === 'lines' && ['lines', 'products', 'employees'].includes(entity)) {
            loadLines();
            return;
        }
        if (currentSection === 'employees' && ['employees', 'process_assignments', 'employee_process_assignments'].includes(entity)) {
            loadEmployees();
            return;
        }
        if (currentSection === 'products' && ['products', 'product_processes', 'lines'].includes(entity)) {
            loadProducts();
            return;
        }
        if (currentSection === 'operations' && ['operations', 'product_processes'].includes(entity)) {
            loadOperations();
            return;
        }
    }, 250);
}

function showAddProcessModal(productId) {
    const operations = window.currentAllOperations || [];
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.id = 'process-modal';
    modal.innerHTML = `
        <div class="modal">
            <div class="modal-header">
                <h3 class="modal-title">Add Operation to Process Flow</h3>
                <button class="modal-close" onclick="closeModal('process-modal')">
                    <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                    </svg>
                </button>
            </div>
            <div class="modal-body">
                <form id="process-form">
                    <input type="hidden" name="product_id" value="${productId}">
                    <div class="form-group">
                        <label class="form-label">Filter Operation</label>
                        <input type="text" class="form-control" id="process-operation-filter" placeholder="Type to filter by code or name">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Select Operation *</label>
                        <select class="form-control" name="operation_id" id="process-operation-select" required></select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Sequence Number *</label>
                        <input type="number" class="form-control" name="sequence_number" min="1" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label">SAM (seconds)</label>
                        <input type="number" class="form-control" name="sam_seconds" min="0" step="0.1" placeholder="e.g. 12.5">
                    </div>
                </form>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="closeModal('process-modal')">Cancel</button>
                <button class="btn btn-primary" onclick="saveProcess()">Add to Process</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    setTimeout(() => modal.classList.add('active'), 10);

    const filterInput = document.getElementById('process-operation-filter');
    filterInput.addEventListener('input', () => {
        updateProcessOperationOptions(filterInput.value, operations);
    });
    updateProcessOperationOptions('', operations);
}

function updateProcessOperationOptions(filterValue, operations) {
    const select = document.getElementById('process-operation-select');
    if (!select) return;

    const normalized = (filterValue || '').trim().toLowerCase();
    const filtered = operations.filter(o => {
        if (!o.is_active) return false;
        if (!normalized) return true;
        const code = (o.operation_code || '').toLowerCase();
        const name = (o.operation_name || '').toLowerCase();
        return code.startsWith(normalized) || name.startsWith(normalized);
    });

    const options = filtered.map(o =>
        `<option value="${o.id}">${o.operation_code} - ${o.operation_name}</option>`
    ).join('');

    select.innerHTML = `
        <option value="">Choose an operation</option>
        ${options || '<option value="" disabled>No matching operations</option>'}
    `;
}


async function saveProcess() {
    const form = document.getElementById('process-form');
    const formData = new FormData(form);
    const data = Object.fromEntries(formData);

    // Convert SAM seconds to operation_sah (hours)
    if (data.sam_seconds !== undefined) {
        data.operation_sah = data.sam_seconds ? (parseFloat(data.sam_seconds) / 3600).toFixed(6) : null;
        delete data.sam_seconds;
    }

    try {
        const response = await fetch(`${API_BASE}/product-processes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        const result = await response.json();
        if (result.success) {
            showToast('Operation added successfully', 'success');
            closeModal('process-modal');
            viewProductProcess(data.product_id);
        } else {
            showToast(result.error, 'error');
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function editProcess(proc, productId) {
    const currentSamSec = ((parseFloat(proc.operation_sah || 0)) * 3600).toFixed(1);
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.id = 'process-modal';
    modal.innerHTML = `
        <div class="modal">
            <div class="modal-header">
                <h3 class="modal-title">Edit Process Step</h3>
                <button class="modal-close" onclick="closeModal('process-modal')">
                    <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                    </svg>
                </button>
            </div>
            <div class="modal-body">
                <form id="process-edit-form">
                    <div class="form-group">
                        <label class="form-label">Operation</label>
                        <input type="text" class="form-control" value="${proc.operation_code} - ${proc.operation_name}" readonly>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Sequence Number *</label>
                        <input type="number" class="form-control" name="sequence_number" min="1" value="${proc.sequence_number}" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label">SAM (seconds)</label>
                        <input type="number" class="form-control" name="sam_seconds" min="0" step="0.1" value="${currentSamSec}">
                    </div>
                </form>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="closeModal('process-modal')">Cancel</button>
                <button class="btn btn-primary" onclick="updateProcess(${proc.id}, ${productId})">Update</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    setTimeout(() => modal.classList.add('active'), 10);
}

async function updateProcess(processId, productId) {
    const form = document.getElementById('process-edit-form');
    const formData = new FormData(form);
    const data = Object.fromEntries(formData);

    // Convert SAM seconds to operation_sah (hours)
    if (data.sam_seconds !== undefined) {
        data.operation_sah = data.sam_seconds ? (parseFloat(data.sam_seconds) / 3600).toFixed(6) : null;
        delete data.sam_seconds;
    }

    try {
        const response = await fetch(`${API_BASE}/product-processes/${processId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        const result = await response.json();
        if (result.success) {
            showToast('Process updated successfully', 'success');
            closeModal('process-modal');
            viewProductProcess(productId);
        } else {
            showToast(result.error, 'error');
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function deleteProcess(processId, productId) {
    if (!confirm('Are you sure you want to remove this operation from the process?')) return;

    try {
        const response = await fetch(`${API_BASE}/product-processes/${processId}`, { method: 'DELETE' });
        const result = await response.json();
        if (result.success) {
            showToast('Operation removed', 'success');
            viewProductProcess(productId);
        } else {
            showToast(result.error, 'error');
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ============================================================================
// OPERATIONS
// ============================================================================
async function loadOperations() {
    const content = document.getElementById('main-content');
    content.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';

    try {
        const [opsResponse, catsResponse] = await Promise.all([
            fetch(`${API_BASE}/operations`),
            fetch(`${API_BASE}/operations/categories`)
        ]);

        const opsResult = await opsResponse.json();
        const catsResult = await catsResponse.json();

        const operations = opsResult.data;
        const categories = catsResult.data;

        content.innerHTML = `
            <div class="page-header">
                <div>
                    <h1 class="page-title">Operations Library</h1>
                    <p class="page-subtitle">Master list of all reusable operations (${operations.length} total)</p>
                </div>
                <button class="btn btn-primary" onclick="showOperationModal()">
                    <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/>
                    </svg>
                    Add Operation
                </button>
            </div>

            <div class="stats-grid" style="grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));">
                ${categories.map((cat, i) => `
                    <div class="stat-card" style="cursor: pointer;" onclick="filterOperationsByCategory('${cat.operation_category}')">
                        <div class="stat-info">
                            <h3>${cat.count}</h3>
                            <p>${cat.operation_category}</p>
                        </div>
                    </div>
                `).join('')}
            </div>

            <div class="card">
                <div class="card-body">
                    <div class="toolbar">
                        <div class="search-box">
                            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
                            </svg>
                            <input type="text" id="op-search" placeholder="Search operations..." onkeyup="filterOperations()">
                        </div>
                        <select class="form-control" style="width: auto;" id="op-category" onchange="filterOperations()">
                            <option value="">All Products</option>
                            ${categories.map(c => `<option value="${c.operation_category}">${c.operation_category}</option>`).join('')}
                        </select>
                    </div>

                    <div class="table-container">
                        <table>
                            <thead>
                                <tr>
                                    <th>Code</th>
                                    <th>Name</th>
                                    <th>Category</th>
                                    <th>Used In</th>
                                    <th>Status</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody id="operations-table-body">
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;

        window.allOperationsData = operations;
        renderOperationsTable(operations);

    } catch (err) {
        content.innerHTML = `<div class="alert alert-danger">Error loading operations: ${err.message}</div>`;
    }
}

function renderOperationsTable(operations) {
    const tbody = document.getElementById('operations-table-body');
    tbody.innerHTML = operations.map(op => `
        <tr>
            <td><strong>${op.operation_code}</strong></td>
            <td>${op.operation_name}</td>
            <td><span class="badge badge-info">${op.operation_category}</span></td>
            <td>${op.used_in_products || 0} products</td>
            <td><span class="badge ${op.is_active ? 'badge-success' : 'badge-danger'}">${op.is_active ? 'Active' : 'Inactive'}</span></td>
            <td>
                <div class="action-btns">
                    <button class="btn btn-secondary btn-sm" onclick='showOperationModal(${JSON.stringify(op)})'>Edit</button>
                    <button class="btn btn-danger btn-sm" onclick="deleteOperation(${op.id})">Delete</button>
                </div>
            </td>
        </tr>
    `).join('');
}

function filterOperations() {
    const search = document.getElementById('op-search').value.toLowerCase();
    const category = document.getElementById('op-category').value;

    let filtered = window.allOperationsData;

    if (search) {
        filtered = filtered.filter(op =>
            op.operation_code.toLowerCase().includes(search) ||
            op.operation_name.toLowerCase().includes(search)
        );
    }

    if (category) {
        filtered = filtered.filter(op => op.operation_category === category);
    }

    renderOperationsTable(filtered);
}

function filterOperationsByCategory(category) {
    document.getElementById('op-category').value = category;
    filterOperations();
}

function showOperationModal(op = null) {
    const isEdit = op !== null;
    const categories = ['GENERAL', 'STITCHING', 'PASTING', 'CUTTING', 'EDGE_INKING', 'HEATING', 'PRIMER', 'EMBOSSING', 'GRINDING', 'QA'];

    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.id = 'operation-modal';
    modal.innerHTML = `
        <div class="modal">
            <div class="modal-header">
                <h3 class="modal-title">${isEdit ? 'Edit Operation' : 'Add New Operation'}</h3>
                <button class="modal-close" onclick="closeModal('operation-modal')">
                    <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                    </svg>
                </button>
            </div>
            <div class="modal-body">
                <form id="operation-form">
                    <div class="form-group">
                        <label class="form-label">Operation Code ${isEdit ? '*' : ''}</label>
                        ${isEdit
                            ? `<input type="text" class="form-control" name="operation_code" value="${op?.operation_code || ''}" required>`
                            : `<input type="text" class="form-control" value="Auto-generated on save" readonly>`
                        }
                    </div>
                    <div class="form-group">
                        <label class="form-label">Operation Name *</label>
                        <input type="text" class="form-control" name="operation_name" value="${op?.operation_name || ''}" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Description</label>
                        <textarea class="form-control" name="operation_description" rows="3">${op?.operation_description || ''}</textarea>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Category *</label>
                        <select class="form-control" name="operation_category" required>
                            ${categories.map(c => `<option value="${c}" ${op?.operation_category === c ? 'selected' : ''}>${c}</option>`).join('')}
                        </select>
                    </div>
                    ${isEdit ? `
                    <div class="form-group">
                        <label class="form-label">Status</label>
                        <select class="form-control" name="is_active">
                            <option value="true" ${op.is_active ? 'selected' : ''}>Active</option>
                            <option value="false" ${!op.is_active ? 'selected' : ''}>Inactive</option>
                        </select>
                    </div>
                    ` : ''}
                </form>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="closeModal('operation-modal')">Cancel</button>
                <button class="btn btn-primary" onclick="saveOperation(${op?.id || 'null'})">${isEdit ? 'Update' : 'Create'}</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    setTimeout(() => modal.classList.add('active'), 10);
}

async function saveOperation(id) {
    const form = document.getElementById('operation-form');
    const formData = new FormData(form);
    const data = Object.fromEntries(formData);
    if (data.is_active) data.is_active = data.is_active === 'true';

    try {
        const url = id ? `${API_BASE}/operations/${id}` : `${API_BASE}/operations`;
        const method = id ? 'PUT' : 'POST';

        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        const result = await response.json();
        if (result.success) {
            showToast('Operation saved successfully', 'success');
            closeModal('operation-modal');
            loadOperations();
        } else {
            showToast(result.error, 'error');
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function deleteOperation(id) {
    if (!confirm('Are you sure you want to deactivate this operation?')) return;

    try {
        const response = await fetch(`${API_BASE}/operations/${id}`, { method: 'DELETE' });
        const result = await response.json();
        if (result.success) {
            showToast('Operation deactivated', 'success');
            loadOperations();
        } else {
            showToast(result.error, 'error');
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================
function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) {
        modal.classList.remove('active');
        setTimeout(() => modal.remove(), 300);
    }
}

function showToast(message, type = 'success') {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            ${type === 'success'
                ? '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>'
                : '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>'}
        </svg>
        <span>${message}</span>
    `;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ============================================================================
// IE Attendance Section (IE mode)
// ============================================================================
async function loadAttendanceSection() {
    const content = document.getElementById('main-content');
    const today = new Date().toISOString().slice(0, 10);
    content.innerHTML = `
        <div class="ie-section">
            <div class="page-header">
                <div>
                    <h1 class="page-title">Attendance</h1>
                    <p class="page-subtitle">Set daily in/out timings for employees</p>
                </div>
                <div class="ie-actions">
                    <div class="ie-date">
                        <label for="ie-date">Date</label>
                        <input type="date" id="ie-date" value="${today}">
                    </div>
                    <button class="btn btn-primary" id="save-all-btn">Save All</button>
                </div>
            </div>
            <div class="card">
                <div class="card-header">
                    <h3 class="card-title">Default Working Hours</h3>
                </div>
                <div class="card-body">
                    <div class="ie-settings">
                        <div>
                            <label class="form-label">Default In</label>
                            <input type="time" class="form-control" id="default-in-time" value="${ieDefaultIn}">
                        </div>
                        <div>
                            <label class="form-label">Default Out</label>
                            <input type="time" class="form-control" id="default-out-time" value="${ieDefaultOut}">
                        </div>
                        <div class="ie-settings-action">
                            <button class="btn btn-secondary" id="save-settings-btn">Update Default</button>
                        </div>
                    </div>
                </div>
            </div>
            <div class="card">
                <div class="card-header">
                    <h3 class="card-title">Employee Attendance</h3>
                </div>
                <div class="card-body">
                    <div id="ie-table" class="table-container">
                        <div class="loading-overlay"><div class="spinner"></div></div>
                    </div>
                </div>
            </div>
        </div>
    `;

    const dateInput = document.getElementById('ie-date');
    dateInput.addEventListener('change', loadAttendanceData);
    document.getElementById('save-all-btn').addEventListener('click', saveAllAttendance);
    document.getElementById('save-settings-btn').addEventListener('click', saveIeSettings);
    await loadIeSettings();
    loadAttendanceData();
}

async function loadIeSettings() {
    try {
        const response = await fetch('/api/settings');
        const result = await response.json();
        if (result.success) {
            ieDefaultIn = result.data.default_in_time || ieDefaultIn;
            ieDefaultOut = result.data.default_out_time || ieDefaultOut;
            const inInput = document.getElementById('default-in-time');
            const outInput = document.getElementById('default-out-time');
            if (inInput) inInput.value = ieDefaultIn;
            if (outInput) outInput.value = ieDefaultOut;
        }
    } catch (err) {
        showToast('Failed to load default hours', 'error');
    }
}

async function saveIeSettings() {
    const inValue = document.getElementById('default-in-time').value;
    const outValue = document.getElementById('default-out-time').value;
    try {
        const response = await fetch('/api/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ default_in_time: inValue, default_out_time: outValue })
        });
        const result = await response.json();
        if (!result.success) {
            showToast(result.error, 'error');
            return;
        }
        ieDefaultIn = inValue;
        ieDefaultOut = outValue;
        loadAttendanceData();
        showToast('Default hours updated', 'success');
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function loadAttendanceData() {
    const date = document.getElementById('ie-date').value;
    const container = document.getElementById('ie-table');
    container.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';

    try {
        const response = await fetch(`/api/ie/attendance?date=${date}`);
        const result = await response.json();
        if (!result.success) {
            container.innerHTML = `<div class="alert alert-danger">${result.error}</div>`;
            return;
        }
        const rows = result.data;
        container.innerHTML = `
            <div class="ie-table-header">
                <div class="search-box">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
                    </svg>
                    <input type="text" placeholder="Search employee..." onkeyup="filterAttendanceRows(this.value)">
                </div>
                <span class="ie-pill">${rows.length} employees</span>
            </div>
            <table>
                <thead>
                    <tr>
                        <th>S.No</th>
                        <th>Employee</th>
                        <th>Current Work</th>
                        <th>In</th>
                        <th>Out</th>
                        <th>Status</th>
                        <th>Notes</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody id="attendance-body">
                    ${rows.map((row, index) => renderAttendanceRow(row, index)).join('')}
                </tbody>
            </table>
        `;
        window.ieAttendanceRows = rows;
    } catch (err) {
        container.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    }
}

function renderAttendanceRow(row, index) {
    const work = [
        row.product_code || '-',
        row.operation_name ? `• ${row.operation_name}` : '',
        row.line_name ? `(${row.line_name})` : ''
    ].filter(Boolean).join(' ');
    const inTime = row.in_time || ieDefaultIn;
    const outTime = row.out_time || ieDefaultOut;
    const status = row.status || 'present';

    return `
        <tr data-employee="${row.employee_id}">
            <td>${index + 1}</td>
            <td><strong>${row.emp_code}</strong><div style="color: var(--secondary); font-size: 12px;">${row.emp_name}</div></td>
            <td>${work}</td>
            <td><input type="time" value="${inTime}" class="form-control ie-time-in"></td>
            <td><input type="time" value="${outTime}" class="form-control ie-time-out"></td>
            <td>
                <select class="form-control ie-status">
                    ${['present', 'absent', 'left_early'].map(s => `<option value="${s}" ${status === s ? 'selected' : ''}>${formatAttendanceStatus(s)}</option>`).join('')}
                </select>
            </td>
            <td><input type="text" class="form-control ie-note" placeholder="Optional" value="${row.notes || ''}"></td>
            <td class="ie-row-actions">
                <button class="btn btn-secondary btn-sm" onclick="saveAttendanceRow(${row.employee_id})">Save</button>
            </td>
        </tr>
    `;
}

function formatAttendanceStatus(status) {
    if (status === 'left_early') return 'Left Early';
    return status.charAt(0).toUpperCase() + status.slice(1);
}

function filterAttendanceRows(search) {
    const normalized = search.toLowerCase();
    const filtered = (window.ieAttendanceRows || []).filter(row =>
        row.emp_code.toLowerCase().includes(normalized) ||
        row.emp_name.toLowerCase().includes(normalized)
    );
    const body = document.getElementById('attendance-body');
    body.innerHTML = filtered.map((row, index) => renderAttendanceRow(row, index)).join('');
}

async function saveAttendanceRow(employeeId) {
    const date = document.getElementById('ie-date').value;
    const row = document.querySelector(`tr[data-employee="${employeeId}"]`);
    if (!row) return;
    const inTime = row.querySelector('.ie-time-in').value;
    const outTime = row.querySelector('.ie-time-out').value;
    const status = row.querySelector('.ie-status').value;
    const notes = row.querySelector('.ie-note').value;
    await saveAttendance(employeeId, date, inTime, outTime, status, notes);
}

async function saveAllAttendance() {
    const date = document.getElementById('ie-date').value;
    const rows = Array.from(document.querySelectorAll('#attendance-body tr'));
    for (const row of rows) {
        const employeeId = row.dataset.employee;
        const inTime = row.querySelector('.ie-time-in').value;
        const outTime = row.querySelector('.ie-time-out').value;
        const status = row.querySelector('.ie-status').value;
        const notes = row.querySelector('.ie-note').value;
        await saveAttendance(employeeId, date, inTime, outTime, status, notes, true);
    }
    showToast('Attendance saved', 'success');
}

async function saveAttendance(employeeId, date, inTime, outTime, status, notes, silent = false) {
    try {
        const response = await fetch(`/api/ie/attendance`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                employee_id: employeeId,
                date,
                in_time: inTime,
                out_time: outTime,
                status,
                notes
            })
        });
        const result = await response.json();
        if (!result.success) {
            showToast(result.error, 'error');
            return;
        }
        if (!silent) showToast('Saved', 'success');
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ============================================================================
// Daily Line Plan (IE)
// ============================================================================
async function loadDailyPlans() {
    const content = document.getElementById('main-content');
    const _ld = new Date(); const today = `${_ld.getFullYear()}-${String(_ld.getMonth()+1).padStart(2,'0')}-${String(_ld.getDate()).padStart(2,'0')}`;
    if (!window._dpTab) window._dpTab = 'regular';
    content.innerHTML = `
        <div class="ie-section">
            <div class="page-header">
                <div>
                    <h1 class="page-title">Line Style Setup</h1>
                    <p class="page-subtitle">Set the main style and changeover style for each line.</p>
                </div>
                <div class="ie-actions">
                    <div class="ie-date">
                        <label for="plan-date">Date</label>
                        <input type="date" id="plan-date" value="${today}">
                    </div>
                    <button id="dp-print-btn" onclick="openDailyPlanPrintModal()" style="padding:8px 16px;background:#1e40af;color:#fff;border:none;border-radius:6px;font-weight:600;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:6px;">
                        &#9113; Print / Export
                    </button>
                    <button id="dp-upload-btn" onclick="openPlanUploadModal()" style="padding:8px 16px;background:#1d6f42;color:#fff;border:none;border-radius:6px;font-weight:600;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:6px;">
                        &#8679; Upload Plan
                    </button>
                </div>
            </div>
            <!-- Regular / OT tabs -->
            <div style="display:flex;gap:4px;margin-bottom:16px;border-bottom:2px solid #e5e7eb;padding-bottom:0;">
                <button id="dp-tab-regular" onclick="switchDpTab('regular')"
                    style="padding:8px 22px;border:none;border-radius:8px 8px 0 0;font-size:13px;font-weight:600;cursor:pointer;background:#1e40af;color:#fff;margin-bottom:-2px;border-bottom:2px solid #1e40af;">
                    Regular Shift
                </button>
                <button id="dp-tab-ot" onclick="switchDpTab('ot')"
                    style="padding:8px 22px;border:none;border-radius:8px 8px 0 0;font-size:13px;font-weight:600;cursor:pointer;background:#f3f4f6;color:#6b7280;margin-bottom:-2px;border-bottom:2px solid transparent;">
                    OT Plan
                </button>
            </div>
            <div id="dp-regular-hint" class="alert alert-info" style="margin-bottom:16px;">
                Primary product = outgoing product. Incoming product = next product (during changeover).
                Use "Changeover Up To" to select the process sequence already switched to the incoming product.
            </div>
            <div class="card">
                <div class="card-header" id="dp-card-header">
                    <h3 class="card-title">Line Plans</h3>
                </div>
                <div class="card-body">
                    <div id="daily-plan-table" class="table-container">
                        <div class="loading-overlay"><div class="spinner"></div></div>
                    </div>
                </div>
            </div>
        </div>
    `;
    document.getElementById('plan-date').addEventListener('change', () => {
        switchDpTab(window._dpTab || 'regular');
    });
    switchDpTab(window._dpTab || 'regular');
}

function switchDpTab(tab) {
    window._dpTab = tab;
    const date = document.getElementById('plan-date')?.value || new Date().toISOString().slice(0, 10);
    const tabReg = document.getElementById('dp-tab-regular');
    const tabOt  = document.getElementById('dp-tab-ot');
    const hint   = document.getElementById('dp-regular-hint');
    const header = document.getElementById('dp-card-header');
    const printBtn  = document.getElementById('dp-print-btn');
    const uploadBtn = document.getElementById('dp-upload-btn');

    if (tabReg) {
        tabReg.style.background      = tab === 'regular' ? '#1e40af' : '#f3f4f6';
        tabReg.style.color           = tab === 'regular' ? '#fff'    : '#6b7280';
        tabReg.style.borderBottomColor = tab === 'regular' ? '#1e40af' : 'transparent';
    }
    if (tabOt) {
        tabOt.style.background       = tab === 'ot' ? '#7c3aed' : '#f3f4f6';
        tabOt.style.color            = tab === 'ot' ? '#fff'    : '#6b7280';
        tabOt.style.borderBottomColor = tab === 'ot' ? '#7c3aed' : 'transparent';
    }
    if (hint)   hint.style.display   = tab === 'regular' ? '' : 'none';
    if (header) header.querySelector('.card-title').textContent = tab === 'regular' ? 'Line Plans' : 'OT Plans';
    // Print/Upload only relevant for regular tab
    if (printBtn)  printBtn.style.display = tab === 'regular' ? '' : 'none';
    if (uploadBtn) uploadBtn.style.display = tab === 'regular' ? '' : 'none';

    if (tab === 'ot') {
        loadOtPlanSection(date);
    } else {
        loadDailyPlanData();
    }
}

function openPlanUploadModal() {
    const existing = document.getElementById('plan-upload-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'plan-upload-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9000;display:flex;align-items:center;justify-content:center;';
    modal.innerHTML = `
        <div style="background:#fff;border-radius:12px;padding:28px 32px;max-width:520px;width:95%;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
                <h3 style="margin:0;font-size:18px;font-weight:700;color:#111827;">Upload Line Plan from Excel</h3>
                <button onclick="document.getElementById('plan-upload-modal').remove()" style="background:none;border:none;font-size:22px;cursor:pointer;color:#6b7280;line-height:1;">&times;</button>
            </div>
            <p style="font-size:13px;color:#6b7280;margin:0 0 16px;">
                Fill in the template and upload to auto-create the product, processes, workstation plan, and employee assignments in one step.
            </p>
            <p style="font-size:12px;color:#1d4ed8;background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:8px 10px;margin:0 0 16px;">
                This upload will be applied to the date currently selected in Daily Plan.
            </p>
            <button onclick="window.location.href='/api/lines/plan-upload-template'"
               style="display:inline-flex;align-items:center;gap:6px;padding:8px 16px;background:#f0fdf4;color:#1d6f42;border:1px solid #bbf7d0;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;margin-bottom:20px;">
                &#8595; Download Template
            </button>
            <div style="margin-bottom:16px;">
                <label style="display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:6px;">Select Excel File (.xlsx)</label>
                <input type="file" id="plan-upload-file" accept=".xlsx,.xls"
                       style="display:block;width:100%;font-size:13px;padding:8px;border:1px solid #d1d5db;border-radius:6px;box-sizing:border-box;">
            </div>
            <div id="plan-upload-result" style="margin-bottom:12px;"></div>
            <div style="display:flex;gap:10px;justify-content:flex-end;">
                <button onclick="document.getElementById('plan-upload-modal').remove()" style="padding:8px 18px;background:#f3f4f6;color:#374151;border:none;border-radius:6px;font-size:13px;cursor:pointer;">Cancel</button>
                <button onclick="submitPlanUpload()" id="plan-upload-btn"
                        style="padding:8px 18px;background:#1d6f42;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;">
                    Upload
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

async function submitPlanUpload(options = {}) {
    const fileInput = document.getElementById('plan-upload-file');
    const resultDiv = document.getElementById('plan-upload-result');
    const btn = document.getElementById('plan-upload-btn');

    if (!fileInput?.files?.[0]) {
        resultDiv.innerHTML = '<div style="color:#dc2626;font-size:13px;">Please select an Excel file first.</div>';
        return;
    }

    // Persist options so conflict handlers can read them without re-passing
    window._pendingUploadOptions = options;

    btn.disabled = true;
    btn.textContent = 'Uploading\u2026';
    resultDiv.innerHTML = '<div style="color:#6b7280;font-size:13px;">Processing\u2026</div>';

    const fd = new FormData();
    fd.append('file', fileInput.files[0]);
    const selectedDate = document.getElementById('plan-date')?.value;
    if (selectedDate) fd.append('work_date', selectedDate);
    if (Array.isArray(options.missingEmployees) && options.missingEmployees.length)
        fd.append('missing_employees', JSON.stringify(options.missingEmployees));
    if (Array.isArray(options.duplicateAssignments) && options.duplicateAssignments.length)
        fd.append('duplicate_assignments', JSON.stringify(options.duplicateAssignments));
    if (options.skipMissingEmployees) fd.append('skip_missing_employees', 'true');
    if (options.confirm_line)    fd.append('confirm_line', 'true');
    if (options.confirm_product) fd.append('confirm_product', options.confirm_product);
    if (options.new_product_code) fd.append('new_product_code', options.new_product_code);

    try {
        const r = await fetch('/api/lines/plan-upload-excel', { method: 'POST', body: fd });
        const data = await r.json();

        // --- Line conflict ---
        if (r.status === 409 && data.code === 'LINE_EXISTS') {
            btn.disabled = false;
            btn.textContent = 'Upload';
            resultDiv.innerHTML = `
                <div style="background:#fffbeb;color:#92400e;border:1px solid #fcd34d;border-radius:8px;padding:14px 16px;font-size:13px;">
                    <div style="font-weight:600;margin-bottom:6px;">⚠ Line already exists</div>
                    <div style="margin-bottom:12px;">Line <strong>${data.line_code}</strong>${data.line_name && data.line_name !== data.line_code ? ` (${data.line_name})` : ''} is already in the system. Would you like to change the plan to this line?</div>
                    <div style="display:flex;gap:8px;">
                        <button onclick="_planUploadConfirmLine()" style="padding:7px 16px;background:#d97706;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;">Yes, use this line</button>
                        <button onclick="_planUploadCancel()" style="padding:7px 16px;background:#f3f4f6;color:#374151;border:none;border-radius:6px;font-size:13px;cursor:pointer;">Cancel</button>
                    </div>
                </div>`;
            return;
        }

        // --- Product conflict ---
        if (r.status === 409 && data.code === 'PRODUCT_EXISTS') {
            btn.disabled = false;
            btn.textContent = 'Upload';
            const sameNames = (data.existing_product_name || '').toUpperCase() === (data.uploaded_product_name || '').toUpperCase();
            const nameNote = sameNames
                ? `<strong>${data.product_code}</strong>`
                : `<strong>${data.product_code}</strong> (currently named <em>${data.existing_product_name}</em>, upload has <em>${data.uploaded_product_name}</em>)`;
            resultDiv.innerHTML = `
                <div style="background:#fffbeb;color:#92400e;border:1px solid #fcd34d;border-radius:8px;padding:14px 16px;font-size:13px;">
                    <div style="font-weight:600;margin-bottom:6px;">⚠ Product already exists</div>
                    <div style="margin-bottom:12px;">Product ${nameNote} is already in the system. How would you like to proceed?</div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                        <button onclick="_planUploadUseExistingProduct()" style="padding:7px 14px;background:#d97706;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;">Use existing product</button>
                        <button onclick="_planUploadShowNewProductInput()" style="padding:7px 14px;background:#1d4ed8;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;">Create new product</button>
                        <button onclick="_planUploadCancel()" style="padding:7px 14px;background:#f3f4f6;color:#374151;border:none;border-radius:6px;font-size:13px;cursor:pointer;">Cancel</button>
                    </div>
                    <div id="plan-upload-new-product-input" style="display:none;margin-top:12px;border-top:1px solid #fcd34d;padding-top:12px;">
                        <div style="margin-bottom:8px;font-weight:600;">Create new product:</div>
                        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                            <div>
                                <label style="font-size:12px;color:#6b7280;display:block;margin-bottom:3px;">Enter a different product code</label>
                                <input id="plan-upload-new-product-code" type="text" placeholder="e.g. ABC-002"
                                    style="padding:7px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;width:160px;">
                            </div>
                            <div style="display:flex;flex-direction:column;gap:6px;margin-top:auto;">
                                <button onclick="_planUploadCreateWithNewCode()" style="padding:7px 14px;background:#1d4ed8;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;">Create with new code</button>
                                <button onclick="_planUploadReplaceExistingProduct()" style="padding:7px 14px;background:#dc2626;color:#fff;border:none;border-radius:6px;font-size:13px;cursor:pointer;">Replace existing product</button>
                            </div>
                        </div>
                    </div>
                </div>`;
            return;
        }

        if (!r.ok && data.code === 'MISSING_EMPLOYEES' && Array.isArray(data.missing_employees)) {
            resultDiv.innerHTML = `
                <div style="background:#fff7ed;color:#9a3412;border:1px solid #fdba74;border-radius:6px;padding:10px 12px;font-size:13px;">
                    Missing employees found in upload. Complete the details in the next window or skip assignment for them.
                </div>`;
            btn.disabled = false;
            btn.textContent = 'Upload';
            openMissingEmployeesModal(data.missing_employees);
            return;
        }

        if (!r.ok && data.code === 'DUPLICATE_EMPLOYEE_ASSIGNMENTS' && Array.isArray(data.duplicate_assignments)) {
            resultDiv.innerHTML = `
                <div style="background:#fff7ed;color:#9a3412;border:1px solid #fdba74;border-radius:6px;padding:10px 12px;font-size:13px;">
                    Same employee is assigned to multiple workstations in this upload. Correct the workstation assignments in the next window.
                </div>`;
            btn.disabled = false;
            btn.textContent = 'Upload';
            await openDuplicateAssignmentsModal(data.duplicate_assignments);
            return;
        }

        if (!data.success) {
            const errorText = data.error || data.message || `Upload failed (HTTP ${r.status})`;
            resultDiv.innerHTML = `<div style="background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;border-radius:6px;padding:10px 12px;font-size:13px;">\u26a0\ufe0f ${errorText}</div>`;
            btn.disabled = false;
            btn.textContent = 'Upload';
            return;
        }

        const s = data.summary;
        resultDiv.innerHTML = `
            <div style="background:#f0fdf4;color:#166534;border:1px solid #bbf7d0;border-radius:6px;padding:12px 14px;font-size:13px;line-height:1.7;">
                <strong>&#10003; Upload successful</strong><br>
                Line: <strong>${s.line}</strong> &nbsp;|&nbsp; Product: <strong>${s.product}</strong> &nbsp;|&nbsp; Date: <strong>${s.date}</strong><br>
                Target: <strong>${s.target}</strong> units &nbsp;|&nbsp;
                Workstations: <strong>${s.workstations}</strong> &nbsp;|&nbsp;
                Processes: <strong>${s.processes}</strong> &nbsp;|&nbsp;
                Employees assigned: <strong>${s.employees_assigned}</strong>
            </div>`;
        btn.style.display = 'none';

        let closeBtn = document.getElementById('plan-upload-close-success-btn');
        if (!closeBtn) {
            closeBtn = document.createElement('button');
            closeBtn.id = 'plan-upload-close-success-btn';
            closeBtn.textContent = 'Close';
            closeBtn.className = 'btn btn-primary';
            closeBtn.style.cssText = 'padding:8px 18px;background:#1d6f42;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;';
            closeBtn.onclick = () => document.getElementById('plan-upload-modal')?.remove();
            btn.parentElement?.appendChild(closeBtn);
        }
        closeBtn.style.display = '';

        const planDateEl = document.getElementById('plan-date');
        if (planDateEl && planDateEl.value === s.date) loadDailyPlanData();

    } catch (err) {
        resultDiv.innerHTML = `<div style="background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;border-radius:6px;padding:10px 12px;font-size:13px;">\u26a0\ufe0f ${err.message}</div>`;
        btn.disabled = false;
        btn.textContent = 'Upload';
    }
}

// --- Plan upload conflict resolution helpers ---
function _planUploadConfirmLine() {
    submitPlanUpload({ ...window._pendingUploadOptions, confirm_line: true });
}
function _planUploadUseExistingProduct() {
    submitPlanUpload({ ...window._pendingUploadOptions, confirm_product: 'use_existing' });
}
function _planUploadReplaceExistingProduct() {
    submitPlanUpload({ ...window._pendingUploadOptions, confirm_product: 'replace' });
}
function _planUploadShowNewProductInput() {
    const panel = document.getElementById('plan-upload-new-product-input');
    if (panel) panel.style.display = '';
}
function _planUploadCreateWithNewCode() {
    const codeInput = document.getElementById('plan-upload-new-product-code');
    const newCode = (codeInput?.value || '').trim().toUpperCase();
    if (!newCode) {
        codeInput?.focus();
        codeInput?.style && (codeInput.style.borderColor = '#dc2626');
        return;
    }
    submitPlanUpload({ ...window._pendingUploadOptions, confirm_product: null, new_product_code: newCode });
}
function _planUploadCancel() {
    window._pendingUploadOptions = {};
    const resultDiv = document.getElementById('plan-upload-result');
    if (resultDiv) resultDiv.innerHTML = '';
    const btn = document.getElementById('plan-upload-btn');
    if (btn) { btn.disabled = false; btn.textContent = 'Upload'; }
}

function openMissingEmployeesModal(missingEmployees) {
    const existing = document.getElementById('missing-employees-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'missing-employees-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9100;display:flex;align-items:center;justify-content:center;padding:20px;';

    const rowsHtml = missingEmployees.map((emp, idx) => {
        const wsText = Array.isArray(emp.workstation_codes) && emp.workstation_codes.length
            ? emp.workstation_codes.join(', ')
            : '-';
        const safeCode = String(emp.emp_code || '').replace(/"/g, '&quot;');
        const safeName = String(emp.emp_name || '').replace(/"/g, '&quot;');
        const safeKey = String(emp.key || '').replace(/"/g, '&quot;');
        return `
            <tr>
                <td style="padding:8px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#6b7280;">${wsText}</td>
                <td style="padding:8px;border-bottom:1px solid #e5e7eb;">
                    <input data-missing-key="${safeKey}" data-field="emp_code" value="${safeCode}"
                        style="width:100%;padding:7px 8px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;box-sizing:border-box;">
                </td>
                <td style="padding:8px;border-bottom:1px solid #e5e7eb;">
                    <input data-missing-key="${safeKey}" data-field="emp_name" value="${safeName}"
                        style="width:100%;padding:7px 8px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;box-sizing:border-box;">
                </td>
            </tr>`;
    }).join('');

    modal.innerHTML = `
        <div style="background:#fff;border-radius:12px;max-width:880px;width:min(96vw,880px);max-height:88vh;overflow:auto;box-shadow:0 24px 60px rgba(0,0,0,0.28);">
            <div style="padding:22px 24px 10px;display:flex;align-items:center;justify-content:space-between;gap:12px;">
                <div>
                    <h3 style="margin:0;font-size:18px;font-weight:700;color:#111827;">Employees Not Found</h3>
                    <p style="margin:6px 0 0;font-size:13px;color:#6b7280;">Fill employee ID and employee name for all missing entries, then continue the upload.</p>
                </div>
                <button onclick="document.getElementById('missing-employees-modal').remove()" style="background:none;border:none;font-size:22px;cursor:pointer;color:#6b7280;line-height:1;">&times;</button>
            </div>
            <div style="padding:0 24px 8px;">
                <div id="missing-employees-error" style="display:none;background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;border-radius:6px;padding:10px 12px;font-size:13px;margin-bottom:12px;"></div>
                <table style="width:100%;border-collapse:collapse;">
                    <thead>
                        <tr>
                            <th style="text-align:left;padding:8px;background:#f9fafb;border-bottom:1px solid #e5e7eb;font-size:12px;color:#374151;">Workstations</th>
                            <th style="text-align:left;padding:8px;background:#f9fafb;border-bottom:1px solid #e5e7eb;font-size:12px;color:#374151;">Employee ID</th>
                            <th style="text-align:left;padding:8px;background:#f9fafb;border-bottom:1px solid #e5e7eb;font-size:12px;color:#374151;">Employee Name</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            </div>
            <div style="padding:16px 24px 24px;display:flex;justify-content:flex-end;gap:10px;">
                <button onclick="document.getElementById('missing-employees-modal').remove()" style="padding:8px 18px;background:#f3f4f6;color:#374151;border:none;border-radius:6px;font-size:13px;cursor:pointer;">Cancel</button>
                <button onclick="skipMissingEmployeesAndContinue()" style="padding:8px 18px;background:#fff;color:#92400e;border:1px solid #fdba74;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;">Leave Unassigned</button>
                <button onclick="saveMissingEmployeesAndContinue()" style="padding:8px 18px;background:#1d6f42;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;">Add Employees And Continue</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
}

async function saveMissingEmployeesAndContinue() {
    const modal = document.getElementById('missing-employees-modal');
    if (!modal) return;

    const grouped = new Map();
    modal.querySelectorAll('input[data-missing-key]').forEach((input) => {
        const key = input.dataset.missingKey;
        const field = input.dataset.field;
        if (!grouped.has(key)) grouped.set(key, { key, emp_code: '', emp_name: '' });
        grouped.get(key)[field] = (input.value || '').trim();
    });

    const rows = Array.from(grouped.values());
    const errorBox = document.getElementById('missing-employees-error');
    const invalid = rows.find((row) => !row.emp_code || !row.emp_name);
    if (invalid) {
        errorBox.textContent = 'Employee ID and employee name are required for every missing employee.';
        errorBox.style.display = 'block';
        return;
    }

    modal.remove();
    await submitPlanUpload({ missingEmployees: rows });
}

async function skipMissingEmployeesAndContinue() {
    const modal = document.getElementById('missing-employees-modal');
    if (modal) modal.remove();
    await submitPlanUpload({ skipMissingEmployees: true });
}

async function getUploadAvailableEmployees() {
    if (Array.isArray(window._uploadAvailableEmployees) && window._uploadAvailableEmployees.length) {
        return window._uploadAvailableEmployees;
    }
    const response = await fetch(`${API_BASE}/employees`, { credentials: 'include' });
    const result = await response.json();
    const employees = Array.isArray(result?.data) ? result.data.filter(emp => emp.is_active !== false) : [];
    window._uploadAvailableEmployees = employees;
    return employees;
}

async function openDuplicateAssignmentsModal(duplicateAssignments) {
    const existing = document.getElementById('duplicate-assignments-modal');
    if (existing) existing.remove();

    const availableEmployees = await getUploadAvailableEmployees();
    const seen = new Set();
    const rows = duplicateAssignments.filter((row) => {
        const key = `${row.key || ''}|${row.workstation_code || ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    const modal = document.createElement('div');
    modal.id = 'duplicate-assignments-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9100;display:flex;align-items:center;justify-content:center;padding:20px;';

    const rowsHtml = rows.map((row) => {
        const safeKey = String(row.key || '').replace(/"/g, '&quot;');
        const safeWs = String(row.workstation_code || '').replace(/"/g, '&quot;');
        const safeCode = String(row.emp_code || '').replace(/"/g, '&quot;');
        const safeName = String(row.emp_name || '').replace(/"/g, '&quot;');
        const conflictText = Array.isArray(row.conflict_workstations) ? row.conflict_workstations.join(', ') : '';
        const optionsHtml = [
            `<option value="">Leave Unassigned</option>`,
            ...availableEmployees.map((emp) => {
                const empCode = String(emp.emp_code || '').replace(/"/g, '&quot;');
                const empName = String(emp.emp_name || '').replace(/"/g, '&quot;');
                const selected = String(row.emp_code || '').trim() === String(emp.emp_code || '').trim() ? 'selected' : '';
                return `<option value="${empCode}" data-emp-name="${empName}" ${selected}>${empCode} - ${empName}</option>`;
            })
        ].join('');
        return `
            <tr>
                <td style="padding:8px;border-bottom:1px solid #e5e7eb;font-size:12px;font-weight:600;color:#111827;">${safeWs}</td>
                <td style="padding:8px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#92400e;">${conflictText}</td>
                <td style="padding:8px;border-bottom:1px solid #e5e7eb;">
                    <select data-dup-key="${safeKey}" data-field="employee_select"
                        onchange="onDuplicateEmployeeSelectChange(this)"
                        style="width:100%;padding:7px 8px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;box-sizing:border-box;margin-bottom:8px;">
                        ${optionsHtml}
                    </select>
                    <div style="font-size:11px;color:#6b7280;margin-bottom:6px;">Available employees</div>
                    <input data-dup-key="${safeKey}" data-field="emp_code" value="${safeCode}"
                        placeholder="Employee ID"
                        style="width:100%;padding:7px 8px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;box-sizing:border-box;">
                </td>
                <td style="padding:8px;border-bottom:1px solid #e5e7eb;">
                    <input data-dup-key="${safeKey}" data-field="emp_name" value="${safeName}"
                        placeholder="Employee Name"
                        style="width:100%;padding:7px 8px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;box-sizing:border-box;">
                </td>
            </tr>`;
    }).join('');

    modal.innerHTML = `
        <div style="background:#fff;border-radius:12px;max-width:980px;width:min(96vw,980px);max-height:88vh;overflow:auto;box-shadow:0 24px 60px rgba(0,0,0,0.28);">
            <div style="padding:22px 24px 10px;display:flex;align-items:center;justify-content:space-between;gap:12px;">
                <div>
                    <h3 style="margin:0;font-size:18px;font-weight:700;color:#111827;">Same Employee In Multiple Workstations</h3>
                    <p style="margin:6px 0 0;font-size:13px;color:#6b7280;">Change the employee for the listed workstations. The conflict column shows which workstations currently share the same employee.</p>
                </div>
                <button onclick="document.getElementById('duplicate-assignments-modal').remove()" style="background:none;border:none;font-size:22px;cursor:pointer;color:#6b7280;line-height:1;">&times;</button>
            </div>
            <div style="padding:0 24px 8px;">
                <div id="duplicate-assignments-error" style="display:none;background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;border-radius:6px;padding:10px 12px;font-size:13px;margin-bottom:12px;"></div>
                <table style="width:100%;border-collapse:collapse;">
                    <thead>
                        <tr>
                            <th style="text-align:left;padding:8px;background:#f9fafb;border-bottom:1px solid #e5e7eb;font-size:12px;color:#374151;">Workstation</th>
                            <th style="text-align:left;padding:8px;background:#f9fafb;border-bottom:1px solid #e5e7eb;font-size:12px;color:#374151;">Conflicting Workstations</th>
                            <th style="text-align:left;padding:8px;background:#f9fafb;border-bottom:1px solid #e5e7eb;font-size:12px;color:#374151;">Employee Option / ID</th>
                            <th style="text-align:left;padding:8px;background:#f9fafb;border-bottom:1px solid #e5e7eb;font-size:12px;color:#374151;">Employee Name</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            </div>
            <div style="padding:16px 24px 24px;display:flex;justify-content:flex-end;gap:10px;">
                <button onclick="document.getElementById('duplicate-assignments-modal').remove()" style="padding:8px 18px;background:#f3f4f6;color:#374151;border:none;border-radius:6px;font-size:13px;cursor:pointer;">Cancel</button>
                <button onclick="skipDuplicateAssignmentsAndContinue()" style="padding:8px 18px;background:#fff;color:#92400e;border:1px solid #fdba74;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;">Continue Unassigned</button>
                <button onclick="saveDuplicateAssignmentsAndContinue()" style="padding:8px 18px;background:#1d6f42;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;">Update And Continue</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
}

function onDuplicateEmployeeSelectChange(selectEl) {
    const key = selectEl.dataset.dupKey;
    if (!key) return;
    const selectedOption = selectEl.options[selectEl.selectedIndex];
    const empCode = (selectEl.value || '').trim();
    const empName = (selectedOption?.dataset?.empName || '').trim();
    const codeInput = document.querySelector(`#duplicate-assignments-modal input[data-dup-key="${CSS.escape(key)}"][data-field="emp_code"]`);
    const nameInput = document.querySelector(`#duplicate-assignments-modal input[data-dup-key="${CSS.escape(key)}"][data-field="emp_name"]`);
    if (codeInput) codeInput.value = empCode;
    if (nameInput) nameInput.value = empName;
}

async function saveDuplicateAssignmentsAndContinue() {
    const modal = document.getElementById('duplicate-assignments-modal');
    if (!modal) return;

    const grouped = new Map();
    modal.querySelectorAll('input[data-dup-key]').forEach((input) => {
        const key = input.dataset.dupKey;
        const field = input.dataset.field;
        if (!grouped.has(key)) grouped.set(key, { key, emp_code: '', emp_name: '' });
        grouped.get(key)[field] = (input.value || '').trim();
    });

    const rows = Array.from(grouped.values());
    const errorBox = document.getElementById('duplicate-assignments-error');
    const partial = rows.find((row) => (!!row.emp_code && !row.emp_name) || (!row.emp_code && !!row.emp_name));
    if (partial) {
        errorBox.textContent = 'For each workstation, either provide both employee ID and employee name, or leave both blank.';
        errorBox.style.display = 'block';
        return;
    }

    modal.remove();
    await submitPlanUpload({ duplicateAssignments: rows });
}

async function skipDuplicateAssignmentsAndContinue() {
    const modal = document.getElementById('duplicate-assignments-modal');
    if (!modal) return;
    const keys = [...new Set(
        Array.from(modal.querySelectorAll('input[data-dup-key]')).map((input) => input.dataset.dupKey).filter(Boolean)
    )];
    const rows = keys.map((key) => ({ key, emp_code: '', emp_name: '' }));
    modal.remove();
    await submitPlanUpload({ duplicateAssignments: rows });
}

async function loadDailyPlanData() {
    const date = document.getElementById('plan-date').value;
    const container = document.getElementById('daily-plan-table');
    container.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';
    try {
        const result = await fetchDailyPlanSnapshot(date);
        if (!result?.success) {
            container.innerHTML = `<div class="alert alert-danger">${result.error}</div>`;
            return;
        }
        const { plans, lines, products, changeover_enabled } = result.data;
        window.dailyPlanProducts = products;
        window.changeoverEnabled = changeover_enabled !== false;
        const planMap = new Map(plans.map(plan => [String(plan.line_id), plan]));
        const renderedLines = isIeMode
            ? lines.filter(line => planMap.has(String(line.id)))
            : lines;
        window._dailyPlanMap = planMap;
        if (!renderedLines.length) {
            container.innerHTML = '<div style="padding:24px;color:#6b7280;">No saved daily plans found for this date.</div>';
            return;
        }
        container.innerHTML = `
            <table>
                <thead>
                    <tr>
                        <th>Line</th>
                        <th>Line Leader</th>
                        <th>Style (Primary)</th>
                        <th>Line Target</th>
                        <th>Incoming Style</th>
                        <th>Incoming Line Target</th>
                        <th>Changeover Progress</th>
                        <th>Status</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody>
                    ${renderedLines.map(line => {
                        const plan = planMap.get(String(line.id));
                        const locked = plan?.is_locked;
                        const selectedProduct = plan?.product_id || '';
                        const selectedTarget = plan?.target_units ?? 0;
                        const selectedIncoming = plan?.incoming_product_id || '';
                        const selectedIncomingTarget = plan?.incoming_target_units || 0;
                        const selectedChangeover = plan?.changeover_sequence ?? 0;
                        const planExists = Boolean(plan?.id);
                        const hasChangeover = !!plan?.incoming_product_id;
                        const canOpenDetails = Boolean(planExists);
                        const otEnabled = plan?.ot_enabled || false;
                        const primaryCum   = plan?.product_cumulative || 0;
                        const primaryOQ    = plan?.target_qty || 0;
                        const primaryComplete = primaryOQ > 0 && primaryCum >= primaryOQ;
                        const primaryOver     = primaryOQ > 0 && primaryCum > primaryOQ;
                        const incomingCum  = plan?.incoming_cumulative || 0;
                        const incomingOQ   = plan?.incoming_target_qty || 0;
                        const incomingComplete = incomingOQ > 0 && incomingCum >= incomingOQ;
                        const incomingOver     = incomingOQ > 0 && incomingCum > incomingOQ;
                        // plan_month from products list
                        const selProd = products.find(p => p.id === Number(selectedProduct));
                        const planMonthLabel = selProd?.plan_month ? (() => {
                            const [y, m] = selProd.plan_month.split('-');
                            const mns = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                            return `<span style="font-size:10px;color:#1e40af;font-weight:600;background:#eff6ff;padding:1px 5px;border-radius:3px;">${mns[parseInt(m)]} ${y}</span>`;
                        })() : '';
                        return `
                            <tr style="cursor:${canOpenDetails ? 'pointer' : 'default'};${primaryOver ? 'background:#fffbeb;' : primaryComplete ? 'background:#f0fdf4;' : ''}" ${canOpenDetails ? `onclick="toggleLineDetails(${line.id})"` : `title="Save the daily plan first to open line details"`}>
                                <td>
                                    <strong>${line.line_code}</strong>
                                    <div style="color: var(--secondary); font-size: 12px;">${line.line_name}</div>
                                    ${hasChangeover ? '<span style="background:#fef3c7;color:#92400e;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:600;">CHANGEOVER</span>' : ''}
                                    ${!planExists ? '<div style="color:#b45309;font-size:11px;font-weight:600;margin-top:4px;">Save daily plan to open details</div>' : ''}
                                    ${primaryOver ? `<span style="background:#fef3c7;color:#92400e;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:700;display:inline-block;margin-top:3px;">⚠ OVER-PRODUCED +${(primaryCum - primaryOQ).toLocaleString()}</span>` : primaryComplete ? '<span style="background:#dcfce7;color:#15803d;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:700;display:inline-block;margin-top:3px;">✓ ORDER COMPLETE</span>' : ''}
                                    ${incomingOver ? `<span style="background:#fef3c7;color:#92400e;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:700;display:inline-block;margin-top:3px;">⚠ INCOMING OVER +${(incomingCum - incomingOQ).toLocaleString()}</span>` : incomingComplete ? '<span style="background:#dcfce7;color:#15803d;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:700;display:inline-block;margin-top:3px;">✓ INCOMING COMPLETE</span>' : ''}
                                </td>
                                <td>
                                    ${line.line_leader ? `<span style="color:#1d6f42;font-weight:600;font-size:13px;">${line.line_leader}</span>` : '<span style="color:#9ca3af;font-size:12px;">—</span>'}
                                </td>
                                <td onclick="event.stopPropagation()">
                                    <select class="form-control" id="plan-product-${line.id}" ${locked ? 'disabled' : ''}>
                                        <option value="">Select Style</option>
                                        ${products.map(product => `
                                            <option value="${product.id}" ${Number(selectedProduct) === product.id ? 'selected' : ''}>
                                                ${product.product_code} — ${product.product_name}
                                            </option>
                                        `).join('')}
                                    </select>
                                    ${planMonthLabel ? `<div style="margin-top:4px;">${planMonthLabel}</div>` : ''}
                                </td>
                                <td onclick="event.stopPropagation()">
                                    <input type="number" class="form-control" id="plan-target-${line.id}" min="0" value="${selectedTarget}" style="width:90px" ${locked ? 'disabled' : ''}>
                                </td>
                                <td onclick="event.stopPropagation()">
                                    <select class="form-control" id="plan-incoming-${line.id}" ${locked || changeover_enabled === false ? 'disabled' : ''}>
                                        <option value="">None (no changeover)</option>
                                        ${products.map(product => `
                                            <option value="${product.id}" ${Number(selectedIncoming) === product.id ? 'selected' : ''}>
                                                ${product.product_code} - ${product.product_name}
                                            </option>
                                        `).join('')}
                                    </select>
                                </td>
                                <td onclick="event.stopPropagation()">
                                    <input type="number" class="form-control" id="plan-incoming-target-${line.id}" min="0" value="${selectedIncomingTarget}" style="width:90px" ${locked || changeover_enabled === false ? 'disabled' : ''}>
                                </td>
                                <td>
                                    ${changeover_enabled === false
                                        ? '<span style="color:#6b7280;font-size:12px;">Disabled</span>'
                                        : (hasChangeover
                                            ? `<div style="font-weight:600;">P${selectedChangeover}</div><div style="font-size:11px;color:#6b7280;">Auto from supervisor updates</div>`
                                            : '<span style="color:#6b7280;font-size:12px;">-</span>')}
                                </td>
                                <td>
                                    <span class="status-badge" style="${locked ? 'background:#fee2e2;color:#b91c1c;' : 'background:#dcfce7;color:#15803d;'}">
                                        ${locked ? 'Locked' : 'Open'}
                                    </span>
                                </td>
                                <td onclick="event.stopPropagation()">
                                    <div class="action-btns">
                                        <button class="btn btn-secondary btn-sm" onclick="saveDailyPlan(${line.id})" ${locked ? 'disabled' : ''}>Save</button>
                                        <button class="btn btn-danger btn-sm" onclick="lockDailyPlan(${line.id})" ${!planExists || locked ? 'disabled' : ''}>Lock</button>
                                        <button class="btn btn-secondary btn-sm" onclick="unlockDailyPlan(${line.id})" ${!planExists || !locked ? 'disabled' : ''}>Unlock</button>
                                        <button class="btn btn-secondary btn-sm" onclick="copyDailyPlan(${line.id})" ${locked ? 'disabled' : ''}>Copy From</button>
                                        <button class="btn btn-danger btn-sm" onclick="deleteDailyPlan(${line.id})" ${locked ? 'disabled' : ''}>Delete</button>
                                    </div>
                                </td>
                            </tr>
                            <tr id="ws-plan-row-${line.id}" style="display:none;">
                                <td colspan="9" style="padding:0; background:#f8fafc;">
                                    <div id="ws-plan-panel-${line.id}" style="padding:16px;"></div>
                                </td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        `;

        // Changeover boundary is auto-advanced by supervisor progress updates.
    } catch (err) {
        container.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    }
}

// ============================================================================
// LINE DETAILS PAGE (Full-Screen Overlay)
// ============================================================================
let _ldData = null; // { lineId, date, data }

function _ldResolveCopyProductId(lineId) {
    const primaryId = _ldData?.data?.product?.id || _ldData?.data?.product_id || '';
    const incomingId = _ldData?.data?.incoming_product_id || '';
    const mode = window._ldProductMode?.[lineId] || 'primary';
    if (mode === 'changeover' && incomingId) {
        return _ldData?.changeoverData?.product?.id || incomingId || '';
    }
    return primaryId || incomingId || '';
}

function _ldSyncCopyPlanButton(lineId) {
    const cpBtn = document.getElementById('ld-copy-plan-btn');
    if (!cpBtn) return;
    cpBtn.dataset.productId = _ldResolveCopyProductId(lineId) || '';
}

async function toggleLineDetails(lineId) {
    const _tld = new Date(); const _tldf = `${_tld.getFullYear()}-${String(_tld.getMonth()+1).padStart(2,'0')}-${String(_tld.getDate()).padStart(2,'0')}`;
    const date = document.getElementById('plan-date')?.value || _tldf;
    const plan = window._dailyPlanMap?.get?.(String(lineId));
    if (!plan?.id) {
        showToast('Save the daily plan first to open line details', 'error');
        return;
    }
    const productId = document.getElementById(`plan-product-${lineId}`)?.value || '';
    const target = document.getElementById(`plan-target-${lineId}`)?.value || '';
    await openLineDetailsPage(lineId, date, productId, target);
}

async function toggleWorkstationPlan(lineId) { return toggleLineDetails(lineId); }

async function openLineDetailsPage(lineId, date, productId, target) {
    let overlay = document.getElementById('line-details-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'line-details-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:#f8fafc;z-index:1050;overflow-y:auto;';
        document.body.appendChild(overlay);
    }
    overlay.style.display = 'block';
    document.body.style.overflow = 'hidden';
    // Initialize work hours state for this line (preserve if already set)
    if (!window._ldWorkHours) window._ldWorkHours = {};
    if (!window._ldWorkHours[lineId]) window._ldWorkHours[lineId] = { start: '08:00', end: '17:00', lunchMins: 60 };
    const wh = window._ldWorkHours[lineId];
    overlay.innerHTML = `
        <div style="background:#fff;border-bottom:2px solid #e5e7eb;padding:10px 20px;display:flex;align-items:center;gap:12px;position:sticky;top:0;z-index:10;box-shadow:0 1px 4px rgba(0,0,0,.06);flex-wrap:wrap;">
            <button class="btn btn-secondary btn-sm" onclick="closeLineDetailsPage()">&#8592; Back to Daily Plans</button>
            <div>
                <span id="ld-overlay-title" style="font-weight:700;font-size:1rem;">Line Details</span>
                <span style="color:#6b7280;font-size:0.85em;margin-left:10px;">Date: ${date}</span>
            </div>
            <button id="ld-copy-plan-btn" style="font-size:12px;padding:5px 14px;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;border-radius:6px;cursor:pointer;white-space:nowrap;font-weight:600;" onclick="ldOpenCopyPlanModal()">&#128203; Copy Plan</button>
            <button id="ld-download-template-btn" style="font-size:12px;padding:5px 14px;background:#ecfeff;color:#0e7490;border:1px solid #a5f3fc;border-radius:6px;cursor:pointer;white-space:nowrap;font-weight:600;" onclick="ldDownloadPlanTemplate()">Download Template</button>
            <div style="margin-left:auto;display:flex;align-items:center;gap:5px;flex-shrink:0;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:5px 10px;">
                <span style="font-size:11px;color:#6b7280;font-weight:600;white-space:nowrap;">Work Hours:</span>
                <input type="time" value="${wh.start}" style="font-size:12px;padding:3px 5px;border:1px solid #d1d5db;border-radius:5px;width:88px;"
                    onchange="ldUpdateWorkHours(${lineId},'start',this.value)">
                <span style="font-size:13px;color:#9ca3af;">–</span>
                <input type="time" value="${wh.end}" style="font-size:12px;padding:3px 5px;border:1px solid #d1d5db;border-radius:5px;width:88px;"
                    onchange="ldUpdateWorkHours(${lineId},'end',this.value)">
                <span style="font-size:11px;color:#6b7280;margin-left:6px;white-space:nowrap;">Lunch:</span>
                <input type="number" value="${wh.lunchMins}" min="0" max="120"
                    style="font-size:12px;padding:3px 4px;border:1px solid #d1d5db;border-radius:5px;width:50px;text-align:center;"
                    title="Lunch break (minutes)" onchange="ldUpdateWorkHours(${lineId},'lunchMins',this.value)">
                <span style="font-size:11px;color:#6b7280;">min</span>
            </div>
        </div>
        <div id="ld-overlay-content" style="padding:20px;">
            <div style="text-align:center;padding:40px;color:#6b7280;">Loading...</div>
        </div>
    `;
    const content = overlay.querySelector('#ld-overlay-content');
    try {
        const params = new URLSearchParams({ date });
        if (productId) params.set('product_id', productId);
        if (target) params.set('target', target);
        const res = await fetch(`/api/lines/${lineId}/line-process-details?${params}`);
        const result = await res.json();
        if (!result.success) throw new Error(result.error);
        _ldData = { lineId, date, data: result.data, otTab: false };
        // Update header with line name from API
        const titleEl = overlay.querySelector('#ld-overlay-title');
        if (titleEl && result.data.line) {
            const { line_code, line_name, line_leader } = result.data.line;
            titleEl.textContent = (line_code || '') + (line_name ? ' \u2014 ' + line_name : '');
            // Show line leader badge next to title if available
            const existing = overlay.querySelector('#ld-leader-badge');
            if (existing) existing.remove();
            if (line_leader) {
                const badge = document.createElement('span');
                badge.id = 'ld-leader-badge';
                badge.textContent = '\uD83D\uDC64 ' + line_leader;
                badge.style.cssText = 'font-size:12px;font-weight:600;color:#1d6f42;background:#f0fdf4;border:1px solid #86efac;border-radius:6px;padding:2px 10px;margin-left:10px;white-space:nowrap;';
                titleEl.insertAdjacentElement('afterend', badge);
            }
        }
        // Store resolved line/date on the copy-plan button for modal use
        const cpBtn = document.getElementById('ld-copy-plan-btn');
        if (cpBtn) {
            cpBtn.dataset.lineId = lineId;
            cpBtn.dataset.toDate = date;
        }
        const dlBtn = document.getElementById('ld-download-template-btn');
        if (dlBtn) {
            dlBtn.dataset.lineId = lineId;
            dlBtn.dataset.toDate = date;
        }
        _ldSyncCopyPlanButton(lineId);

        // Add OT tab buttons if OT is enabled for this plan
        const headerBar = overlay.querySelector('div[style*="sticky"]');
        const existingTabs = overlay.querySelector('#ld-tabs');
        if (existingTabs) existingTabs.remove();
        if (result.data.ot_enabled && headerBar) {
            const tabs = document.createElement('div');
            tabs.id = 'ld-tabs';
            tabs.style.cssText = 'display:flex;gap:4px;align-items:center;';
            tabs.innerHTML = `
                <button id="ld-tab-regular" onclick="switchLdTab('regular',${lineId})"
                    style="font-size:12px;padding:4px 14px;border-radius:20px;border:1px solid #3b82f6;background:#3b82f6;color:#fff;cursor:pointer;font-weight:600;">
                    Regular Shift
                </button>
                <button id="ld-tab-ot" onclick="switchLdTab('ot',${lineId})"
                    style="font-size:12px;padding:4px 14px;border-radius:20px;border:1px solid #d1d5db;background:#fff;color:#374151;cursor:pointer;">
                    OT Plan
                </button>
            `;
            // Insert after the back button group
            const backBtn = headerBar.querySelector('button');
            if (backBtn && backBtn.nextSibling) {
                headerBar.insertBefore(tabs, backBtn.nextSibling);
            } else {
                headerBar.appendChild(tabs);
            }
        }
        renderLineDetailsContent(content, lineId, date, result.data);
    } catch (err) {
        content.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    }
}

function closeLineDetailsPage() {
    const overlay = document.getElementById('line-details-overlay');
    if (overlay) overlay.style.display = 'none';
    document.body.style.overflow = '';
}

// ── Copy Plan Modal ─────────────────────────────────────────────────────────

function ldOpenCopyPlanModal() {
    const btn = document.getElementById('ld-copy-plan-btn');
    const lineId    = btn?.dataset.lineId    || (_ldData?.lineId    || '');
    const toDate    = btn?.dataset.toDate    || (_ldData?.date      || '');
    const productId = btn?.dataset.productId || '';

    let modal = document.getElementById('ld-copy-plan-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'ld-copy-plan-modal';
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:2000;display:flex;align-items:center;justify-content:center;';
        document.body.appendChild(modal);
    }

    // Default source date = yesterday relative to toDate
    const _td = new Date(toDate + 'T00:00:00');
    _td.setDate(_td.getDate() - 1);
    const defaultSource = `${_td.getFullYear()}-${String(_td.getMonth()+1).padStart(2,'0')}-${String(_td.getDate()).padStart(2,'0')}`;

    modal.innerHTML = `
        <div style="background:#fff;border-radius:12px;padding:28px 28px 24px;width:min(640px,96vw);max-height:90vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.18);">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
                <h3 style="margin:0;font-size:1.05rem;font-weight:700;color:#1e293b;">&#128203; Copy Plan from Date</h3>
                <button onclick="ldCloseCopyPlanModal()" style="background:none;border:none;font-size:20px;cursor:pointer;color:#6b7280;line-height:1;">&#10005;</button>
            </div>
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap;">
                <label style="font-size:13px;font-weight:600;color:#374151;white-space:nowrap;">Copy from date:</label>
                <input type="date" id="ld-cpm-source-date" value="${defaultSource}" max="${toDate}"
                    style="font-size:13px;padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;flex:1;min-width:140px;">
                <button onclick="ldPreviewCopyPlan('${lineId}','${toDate}','${productId}')"
                    style="font-size:13px;padding:7px 18px;background:#3b82f6;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;white-space:nowrap;">
                    Preview Plan
                </button>
            </div>
            <div id="ld-cpm-preview" style="min-height:60px;"></div>
            <div id="ld-cpm-actions" style="display:none;margin-top:16px;padding-top:14px;border-top:1px solid #e5e7eb;display:flex;justify-content:flex-end;gap:10px;"></div>
        </div>`;
    modal.style.display = 'flex';
}

function ldCloseCopyPlanModal() {
    const modal = document.getElementById('ld-copy-plan-modal');
    if (modal) modal.style.display = 'none';
}

async function ldDownloadPlanTemplate() {
    const btn = document.getElementById('ld-download-template-btn');
    const lineId = btn?.dataset.lineId || _ldData?.lineId;
    const date = btn?.dataset.toDate || _ldData?.date;
    if (!lineId || !date) { showToast('Open line details first', 'error'); return; }
    try {
        const url = `/api/lines/plan-upload-template/filled?line_id=${encodeURIComponent(lineId)}&date=${encodeURIComponent(date)}`;
        const resp = await fetch(url);
        if (!resp.ok) {
            const j = await resp.json().catch(() => ({}));
            throw new Error(j.error || `Server error ${resp.status}`);
        }
        const ct = resp.headers.get('content-type') || '';
        if (!ct.includes('application/vnd.openxmlformats-officedocument')) {
            throw new Error('Template download failed. Please refresh the page and try again.');
        }
        const blob = await resp.blob();
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `line_plan_${lineId}_${date}.xlsx`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function ldPreviewCopyPlan(lineId, toDate, productId) {
    const sourceDate = document.getElementById('ld-cpm-source-date')?.value;
    if (!sourceDate) { showToast('Select a source date', 'error'); return; }

    const previewEl  = document.getElementById('ld-cpm-preview');
    const actionsEl  = document.getElementById('ld-cpm-actions');
    if (!previewEl) return;

    previewEl.innerHTML = '<div style="text-align:center;padding:24px;color:#6b7280;font-size:13px;">Loading preview…</div>';
    if (actionsEl) actionsEl.style.display = 'none';

    try {
        const params = new URLSearchParams({ date: sourceDate });
        if (productId) params.set('product_id', productId);
        const res  = await fetch(`/api/lines/${lineId}/workstation-plan/preview?${params.toString()}`);
        const data = await res.json();

        if (!data.success) throw new Error(data.error);

        if (!data.workstations.length) {
            previewEl.innerHTML = '<div style="text-align:center;padding:24px;color:#ef4444;font-size:13px;font-weight:600;">No workstation plan found for this date.</div>';
            return;
        }

        // Build summary stats
        const totalWs  = data.workstations.length;
        const assigned = data.workstations.filter(w => w.employee).length;
        const groups   = [...new Set(data.workstations.map(w => w.group_name).filter(Boolean))];
        const totalProc = data.workstations.reduce((s, w) => s + w.process_count, 0);
        const osmChecked = data.workstations.reduce((s, w) => s + w.osm_checked_count, 0);

        // Build table rows (group by group_name for readability)
        let rows = '';
        let lastGroup = null;
        for (const w of data.workstations) {
            const groupCell = w.group_name !== lastGroup
                ? `<td rowspan="1" style="font-size:11px;font-weight:700;color:#6b7280;padding:5px 8px;border:1px solid #e5e7eb;white-space:nowrap;">${w.group_name || '—'}</td>`
                : `<td style="font-size:11px;color:#9ca3af;padding:5px 8px;border:1px solid #e5e7eb;">${w.group_name || '—'}</td>`;
            lastGroup = w.group_name;
            const empCell = w.employee
                ? `<span style="color:#166534;font-weight:600;">${w.employee}</span>`
                : `<span style="color:#9ca3af;">—</span>`;
            const osmCell = w.osm_checked_count > 0
                ? `<span style="color:#2563eb;">${w.osm_checked_count}/${w.process_count} ✓</span>`
                : `<span style="color:#d1d5db;">${w.process_count}</span>`;
            rows += `<tr>
                <td style="font-size:12px;font-weight:600;padding:5px 8px;border:1px solid #e5e7eb;white-space:nowrap;">${w.workstation_code}</td>
                ${groupCell}
                <td style="font-size:12px;padding:5px 8px;border:1px solid #e5e7eb;">${empCell}</td>
                <td style="font-size:12px;padding:5px 8px;border:1px solid #e5e7eb;text-align:center;">${osmCell}</td>
            </tr>`;
        }

        previewEl.innerHTML = `
            <div style="margin-bottom:12px;display:flex;gap:12px;flex-wrap:wrap;">
                <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:8px 16px;text-align:center;">
                    <div style="font-size:20px;font-weight:700;color:#166534;">${totalWs}</div>
                    <div style="font-size:11px;color:#6b7280;">Workstations</div>
                </div>
                <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:8px 16px;text-align:center;">
                    <div style="font-size:20px;font-weight:700;color:#1d4ed8;">${assigned}/${totalWs}</div>
                    <div style="font-size:11px;color:#6b7280;">Employees Assigned</div>
                </div>
                <div style="background:#faf5ff;border:1px solid #e9d5ff;border-radius:8px;padding:8px 16px;text-align:center;">
                    <div style="font-size:20px;font-weight:700;color:#7c3aed;">${groups.length}</div>
                    <div style="font-size:11px;color:#6b7280;">Groups</div>
                </div>
                <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:8px 16px;text-align:center;">
                    <div style="font-size:20px;font-weight:700;color:#c2410c;">${totalProc}</div>
                    <div style="font-size:11px;color:#6b7280;">Processes</div>
                </div>
                <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:8px 16px;text-align:center;">
                    <div style="font-size:20px;font-weight:700;color:#166534;">${osmChecked}</div>
                    <div style="font-size:11px;color:#6b7280;">OSM ✓</div>
                </div>
            </div>
            <div style="max-height:280px;overflow-y:auto;border:1px solid #e5e7eb;border-radius:8px;">
                <table style="width:100%;border-collapse:collapse;font-size:12px;">
                    <thead style="position:sticky;top:0;background:#f9fafb;">
                        <tr>
                            <th style="padding:7px 8px;border:1px solid #e5e7eb;text-align:left;font-size:11px;color:#374151;">Workstation</th>
                            <th style="padding:7px 8px;border:1px solid #e5e7eb;text-align:left;font-size:11px;color:#374151;">Group</th>
                            <th style="padding:7px 8px;border:1px solid #e5e7eb;text-align:left;font-size:11px;color:#374151;">Employee</th>
                            <th style="padding:7px 8px;border:1px solid #e5e7eb;text-align:center;font-size:11px;color:#374151;">Processes / OSM</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>`;

        // Use the product_id from the SOURCE plan (returned by preview endpoint)
        // This ensures the copy query finds the right workstations regardless of
        // what product_id the caller passed in.
        const sourcePlanProductId = data.product_id || productId;
        if (actionsEl) {
            actionsEl.style.display = 'flex';
            actionsEl.innerHTML = `
                <span style="font-size:12px;color:#6b7280;align-self:center;flex:1;">
                    Copying from <strong>${sourceDate}</strong> → <strong>${toDate}</strong>. This will overwrite any existing plan for ${toDate}.
                </span>
                <button onclick="ldCloseCopyPlanModal()" style="padding:7px 18px;background:#f3f4f6;color:#374151;border:1px solid #d1d5db;border-radius:6px;cursor:pointer;font-size:13px;">Cancel</button>
                <button onclick="ldExecuteCopyPlan('${lineId}','${sourceDate}','${toDate}','${sourcePlanProductId}')"
                    style="padding:7px 20px;background:#dc2626;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:700;">
                    &#128203; Confirm Copy
                </button>`;
        }
    } catch (err) {
        previewEl.innerHTML = `<div style="text-align:center;padding:24px;color:#ef4444;font-size:13px;">${err.message}</div>`;
    }
}

async function ldExecuteCopyPlan(lineId, fromDate, toDate, productId) {
    try {
        const res = await fetch(`/api/lines/${lineId}/workstation-plan/copy-from-date`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from_date: fromDate, to_date: toDate, product_id: productId })
        });
        const result = await res.json();
        if (!result.success) { showToast(result.error, 'error'); return; }
        ldCloseCopyPlanModal();
        showToast(`Plan copied from ${fromDate}`, 'success');
        // Reload line details — use the target plan's product_id (from _ldData) for the reload query
        const reloadProductId = _ldData?.data?.product?.id || productId;
        const content = document.getElementById('ld-overlay-content');
        if (content) {
            content.innerHTML = '<div style="text-align:center;padding:40px;color:#6b7280;">Reloading…</div>';
            const params = new URLSearchParams({ date: toDate });
            if (reloadProductId) params.set('product_id', reloadProductId);
            const r = await fetch(`/api/lines/${lineId}/line-process-details?${params}`);
            const d = await r.json();
            if (d.success) {
                if (_ldData) _ldData.data = d.data;
                const mode = window._ldProductMode?.[lineId] || 'primary';
                const incomingId = _ldData?.data?.incoming_product_id;
                const incomingTarget = _ldData?.data?.incoming_target_units || 0;
                if (mode === 'changeover' && incomingId) {
                    const coParams = new URLSearchParams({ date: toDate });
                    coParams.set('product_id', incomingId);
                    if (incomingTarget > 0) coParams.set('target', incomingTarget);
                    const r2 = await fetch(`/api/lines/${lineId}/line-process-details?${coParams}`);
                    const d2 = await r2.json();
                    if (d2.success && _ldData) _ldData.changeoverData = d2.data;
                }
                _ldSyncCopyPlanButton(lineId);
                renderLineDetailsContent(content, lineId, toDate, d.data);
            } else {
                content.innerHTML = `<div style="text-align:center;padding:40px;color:#ef4444;">${d.error || 'Failed to reload'}</div>`;
            }
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// Compute regular working seconds from the per-line hours state
function _ldGetWorkSecs(lineId) {
    const wh = window._ldWorkHours?.[lineId] || { start: '08:00', end: '17:00', lunchMins: 60 };
    const [sh, sm] = (wh.start || '08:00').split(':').map(Number);
    const [eh, em] = (wh.end || '17:00').split(':').map(Number);
    const startSecs = (sh || 8) * 3600 + (sm || 0) * 60;
    const endSecs   = (eh || 17) * 3600 + (em || 0) * 60;
    return Math.max(0, endSecs - startSecs - (parseInt(wh.lunchMins, 10) || 0) * 60);
}

// Update work hours state and re-render the content
function ldUpdateWorkHours(lineId, field, value) {
    if (!window._ldWorkHours) window._ldWorkHours = {};
    if (!window._ldWorkHours[lineId]) window._ldWorkHours[lineId] = { start: '08:00', end: '17:00', lunchMins: 60 };
    window._ldWorkHours[lineId][field] = field === 'lunchMins' ? (parseInt(value, 10) || 0) : value;
    const panel = document.getElementById('ld-overlay-content');
    if (panel && _ldData && _ldData.lineId === lineId) {
        renderLineDetailsContent(panel, lineId, _ldData.date, _ldData.data);
    }
}

// Update per-workstation OT minutes and refresh the tbody
function ldUpdateWsOt(lineId, wsCode, value) {
    if (!window._ldWsOtMins) window._ldWsOtMins = {};
    if (!window._ldWsOtMins[lineId]) window._ldWsOtMins[lineId] = {};
    window._ldWsOtMins[lineId][wsCode] = parseInt(value, 10) || 0;
    recolorDetailRows(lineId);
}

async function loadLineDetailsPanel(lineId) { /* no-op — replaced by overlay */ }
async function loadWorkstationPlanPanel(lineId) { return loadLineDetailsPanel(lineId); }

const WS_ROW_COLORS = [
    '#EFF6FF', '#FFF7ED', '#F0FDF4', '#FDF4FF', '#FFFBEB',
    '#F0F9FF', '#FFF1F2', '#F5F3FF', '#ECFDF5', '#FEF9C3'
];

// Group processes by workstation code, computing SAM sum + workload per group.
// If a workstation is not assigned (blank), treat each process separately (no summing).
function _buildWsGroups(processes, taktSecs, useOT) {
    const groups = [];
    const indexMap = new Map();
    processes.forEach(p => {
        const ws = (p.workstation_code || '').trim();
        const hasWs = !!ws && ws !== '-';
        const key = hasWs ? ws : `__u_${p.id}`;
        if (!indexMap.has(key)) {
            indexMap.set(key, groups.length);
            groups.push({ ws, processes: [], sam: 0, employee_id: null, emp_name: '', emp_code: '', group_name: '', is_ot_skipped: false, lpw_id: null, has_ws: hasWs });
        }
        const g = groups[indexMap.get(key)];
        g.processes.push(p);
        g.sam += parseFloat(p.operation_sah || 0) * 3600;
        if (!g.employee_id) {
            // In OT mode: use ot_employee_id when set; fall back to regular employee_id by default
            const hasOTEmp = useOT && p.ot_employee_id != null;
            const empId   = hasOTEmp ? p.ot_employee_id : p.employee_id;
            const empName = hasOTEmp ? (p.ot_emp_name || '') : (p.emp_name || '');
            const empCode = hasOTEmp ? (p.ot_emp_code || '') : (p.emp_code || '');
            if (empId) {
                g.employee_id = empId;
                g.emp_name = empName;
                g.emp_code = empCode;
            }
        }
        if (hasWs) g.has_ws = true;
        if (!g.group_name && (p.group_name || '').trim()) g.group_name = (p.group_name || '').trim();
        if (!g.lpw_id && p.lpw_id) g.lpw_id = p.lpw_id;
        // is_ot_skipped is the same for every process in the same workstation
        if (p.is_ot_skipped) g.is_ot_skipped = true;
    });
    groups.forEach((g, i) => {
        g.workload_pct = (taktSecs > 0 && g.has_ws) ? (g.sam / taktSecs) * 100 : null;
        g.color = g.ws ? WS_ROW_COLORS[i % WS_ROW_COLORS.length] : '#fff';
    });
    return groups;
}

// Toggle a workstation's OT-skipped state without a full re-render.
// Updates the button appearance, row opacity, and emp-picker pointer-events live.
function ldWsToggleOTSkip(btn, lineId) {
    const wasSkipped = btn.dataset.otSkipped === 'true';
    const nowSkipped = !wasSkipped;
    btn.dataset.otSkipped = nowSkipped ? 'true' : 'false';
    btn.textContent = nowSkipped ? 'Skipped' : 'Active';
    btn.style.background = nowSkipped ? '#fee2e2' : '#dcfce7';
    btn.style.color = nowSkipped ? '#b91c1c' : '#15803d';
    btn.style.borderColor = nowSkipped ? '#fca5a5' : '#86efac';

    // Update row opacity + emp-picker interactivity for this WS group
    const tbody = document.getElementById(`ld-body-${lineId}`);
    if (!tbody) return;
    const ws = btn.dataset.ws;
    tbody.querySelectorAll('tr[data-process-id]').forEach(row => {
        const wsInput = row.querySelector('.ld-ws');
        if (!wsInput || wsInput.value.trim() !== ws) return;
        row.style.opacity = nowSkipped ? '0.45' : '';
        const picker = row.querySelector('.ld-emp-picker');
        if (picker) {
            picker.parentElement.style.opacity = nowSkipped ? '0.35' : '';
            picker.parentElement.style.pointerEvents = nowSkipped ? 'none' : '';
        }
    });

    // Also update the cached is_ot_skipped on the process objects so recolorDetailRows preserves it
    if (_ldData) {
        const rOTProd = window._ldOTProduct?.[lineId] || 'primary';
        const isOTCo = rOTProd === 'changeover' && !!_ldData.changeoverData && !!_ldData.data.incoming_product_id;
        const src = isOTCo ? _ldData.changeoverData : _ldData.data;
        src.processes = src.processes.map(p =>
            (p.workstation_code || '').trim() === ws ? { ...p, is_ot_skipped: nowSkipped } : p
        );
        if (isOTCo) _ldData.changeoverData = src; else _ldData.data = src;
    }
}

// ============================================================
// Searchable employee picker (replaces native <select>)
// ============================================================
function ldPositionEmpDropdown(pickerEl) {
    const dropdown = pickerEl?.querySelector('.ld-emp-dropdown');
    if (!dropdown) return;

    dropdown.style.top = 'calc(100% + 3px)';
    dropdown.style.bottom = 'auto';
    dropdown.style.maxHeight = '220px';

    const pickerRect = pickerEl.getBoundingClientRect();
    const dropdownRect = dropdown.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const gap = 12;
    const spaceBelow = viewportHeight - pickerRect.bottom - gap;
    const spaceAbove = pickerRect.top - gap;
    const needsOpenUp = dropdownRect.height > spaceBelow && spaceAbove > spaceBelow;
    const availableHeight = Math.max(140, Math.floor((needsOpenUp ? spaceAbove : spaceBelow) - 8));

    dropdown.style.maxHeight = `${availableHeight}px`;
    if (needsOpenUp) {
        dropdown.style.top = 'auto';
        dropdown.style.bottom = 'calc(100% + 3px)';
    } else {
        dropdown.style.top = 'calc(100% + 3px)';
        dropdown.style.bottom = 'auto';
    }
}

function ldEmpPickerToggle(pickerEl, lineId) {
    const dropdown = pickerEl.querySelector('.ld-emp-dropdown');
    const isOpen = dropdown.style.display !== 'none';
    // Close all open pickers first
    document.querySelectorAll('.ld-emp-dropdown').forEach(d => { d.style.display = 'none'; });
    if (!isOpen) {
        dropdown.style.display = 'block';
        ldPositionEmpDropdown(pickerEl);
        const search = dropdown.querySelector('.ld-emp-search');
        if (search) {
            search.value = '';
            ldEmpPickerFilter(search); // show all
            setTimeout(() => search.focus(), 10);
        }
    }
}

function ldEmpPickerFilter(searchInput) {
    const q = (searchInput.value || '').toLowerCase();
    const opts = searchInput.closest('.ld-emp-dropdown').querySelectorAll('.ld-emp-option');
    opts.forEach(opt => {
        if (!opt.dataset.empId) { opt.style.display = ''; return; } // always show "not assigned"
        const text = (opt.dataset.empLabel || opt.textContent).toLowerCase();
        opt.style.display = text.includes(q) ? '' : 'none';
    });
}

function ldEmpPickerSelect(optionEl, lineId) {
    if (optionEl.classList.contains('ld-emp-taken')) return; // blocked
    const picker = optionEl.closest('.ld-emp-picker');
    const dropdown = optionEl.closest('.ld-emp-dropdown');
    const empId = optionEl.dataset.empId || '';
    const label = empId ? (optionEl.dataset.empLabel || optionEl.textContent.trim()) : '— Not assigned —';
    picker.dataset.value = empId;
    picker.querySelector('.ld-emp-current-label').textContent = label;
    dropdown.style.display = 'none';

    // OT mode: auto-save employee assignment via OT API
    if (picker.dataset.otMode === '1') {
        const otLine = optionEl.dataset.otLine || lineId;
        const otDate = optionEl.dataset.otDate;
        const otWs   = optionEl.dataset.otWs || picker.dataset.ws;
        if (otDate && otWs) {
            const empCode = label.split(' — ')[0];
            assignOtEmployee(otLine, otDate, otWs, empId ? parseInt(empId, 10) : null, empCode);
            if (empId) {
                if (!window._otEmpState) window._otEmpState = {};
                if (!window._otEmpState[otDate]) window._otEmpState[otDate] = {};
                window._otEmpState[otDate][String(empId)] = { line_id: otLine, ws_code: otWs };
            }
        }
        return;
    }

    syncEmpDropdowns(lineId);
}

// Close any open picker when clicking outside
document.addEventListener('click', e => {
    if (!e.target.closest('.ld-emp-picker')) {
        document.querySelectorAll('.ld-emp-dropdown').forEach(d => { d.style.display = 'none'; });
    }
    if (!e.target.closest('[id^="ld-qr-picker-"]')) {
        document.querySelectorAll('[id^="ld-qr-dropdown-"]').forEach(d => { d.style.display = 'none'; });
    }
}, true);

window.addEventListener('resize', () => {
    document.querySelectorAll('.ld-emp-dropdown').forEach(dropdown => {
        if (dropdown.style.display !== 'none') {
            ldPositionEmpDropdown(dropdown.closest('.ld-emp-picker'));
        }
    });
}, { passive: true });

window.addEventListener('scroll', () => {
    document.querySelectorAll('.ld-emp-dropdown').forEach(dropdown => {
        if (dropdown.style.display !== 'none') {
            ldPositionEmpDropdown(dropdown.closest('.ld-emp-picker'));
        }
    });
}, { passive: true, capture: true });

// Show a QR image in a full-screen modal overlay
function showQrModal(src, label) {
    const existing = document.getElementById('qr-view-modal');
    if (existing) existing.remove();
    const m = document.createElement('div');
    m.id = 'qr-view-modal';
    m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:3000;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;';
    m.innerHTML = `
        <div style="background:#fff;border-radius:12px;padding:20px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
            <div style="font-size:14px;font-weight:700;color:#1e293b;margin-bottom:12px;">${label}</div>
            <img src="${src}" style="width:240px;height:240px;display:block;" onerror="this.src='';this.alt='QR not found'">
            <div style="font-size:11px;color:#9ca3af;margin-top:8px;">Click anywhere to close</div>
        </div>`;
    m.addEventListener('click', () => m.remove());
    document.body.appendChild(m);
}

function _buildLdTbody(tbody, lineId, wsGroups, employees, useOT, opts = {}) {
    const { workSecs = 0, target_units = 0, otMins = 0, otTarget = 0, hasOT = false } = opts;
    const regTakt = (workSecs > 0 && target_units > 0) ? workSecs / target_units : 0;
    const effColor = e => e == null ? '#9ca3af' : e >= 90 ? '#16a34a' : e >= 80 ? '#d97706' : '#dc2626';
    const lineCode = _ldData?.data?.line?.line_code || '';

    // Map empId → qr_code_path for live QR updates
    const empQrMap = new Map(employees.map(e => [String(e.id), e.qr_code_path || '']));

    // Derive workstation QR path from line code and WS code
    const wsQrPath = wsCode => {
        if (!lineCode || !wsCode) return '';
        const num = parseInt(wsCode.replace(/\D/g, '') || '0', 10);
        if (!num) return '';
        const norm = 'W' + String(num).padStart(2, '0');
        return `qrcodes/workstations/${lineCode}/ws_${lineCode}_${norm}.svg`;
    };

    // Small thumbnail HTML — click to enlarge
    const qrThumb = (path, label, imgId) => {
        if (!path) return '<span style="color:#d1d5db;font-size:11px;">—</span>';
        const idAttr = imgId ? ` id="${imgId}"` : '';
        return `<img${idAttr} src="/${path}" style="width:40px;height:40px;border-radius:6px;border:1px solid #e5e7eb;cursor:pointer;display:block;margin:0 auto;"
                     onclick="showQrModal('/${path}','${label.replace(/'/g, '&#39;')}')"
                     onerror="this.style.opacity='0.2'" title="${label} — click to enlarge">`;
    };

    // Build a set of employee IDs already taken factory-wide for this date.
    // Filter by the current shift mode so regular and OT taken-checks are independent.
    const allAssignments = (_ldData?.data?.all_assignments || []).filter(a => !!a.is_overtime === !!useOT);
    // Map: empId (string) → { line_id, workstation_code } where they're currently saved
    const savedAssignMap = new Map();
    allAssignments.forEach(a => {
        savedAssignMap.set(String(a.employee_id), { line_id: String(a.line_id), workstation_code: a.workstation_code });
    });
    // Current page WS → empId selections (from wsGroups, not yet saved)
    const pageWsEmp = new Map(); // wsCode → empId
    wsGroups.forEach(g => { if (g.ws && g.employee_id) pageWsEmp.set(g.ws, String(g.employee_id)); });

    // Build searchable picker options
    const empPickerOpts = (selId, wsCode) => {
        const selIdStr = selId ? String(selId) : '';
        const noneOpt = `<div class="ld-emp-option" data-emp-id="" data-emp-label="— Not assigned —"
             onclick="ldEmpPickerSelect(this,${lineId})"
             style="padding:7px 10px;cursor:pointer;font-size:0.82em;color:#9ca3af;border-bottom:1px solid #f3f4f6;">
             — Not assigned —</div>`;
        return noneOpt + employees.map(e => {
            const eStr = String(e.id);
            const isSelected = eStr === selIdStr;
            const takenOnPage = pageWsEmp.has(eStr) && pageWsEmp.get(eStr) !== wsCode;
            const savedTo = savedAssignMap.get(eStr);
            const takenSaved = savedTo && !(String(savedTo.line_id) === String(lineId) && savedTo.workstation_code === wsCode);
            const isTaken = !isSelected && (takenOnPage || takenSaved);
            const cleanLabel = `${e.emp_code} — ${e.emp_name}`;
            return `<div class="ld-emp-option${isTaken ? ' ld-emp-taken' : ''}"
                 data-emp-id="${eStr}" data-emp-label="${cleanLabel.replace(/"/g,'&quot;')}"
                 onclick="ldEmpPickerSelect(this,${lineId})"
                 style="padding:7px 10px;cursor:${isTaken?'default':'pointer'};font-size:0.82em;
                        background:${isSelected?'#eff6ff':''};font-weight:${isSelected?'600':'400'};
                        color:${isTaken?'#9ca3af':''};display:flex;justify-content:space-between;align-items:center;">
                 <span>${e.emp_code} — ${e.emp_name}</span>
                 ${isTaken ? '<span style="color:#f87171;font-size:11px;margin-left:6px;">Taken ✗</span>' : ''}
             </div>`;
        }).join('');
    };

    const empLabel = (selId) => {
        if (!selId) return '— Not assigned —';
        const e = employees.find(e => String(e.id) === String(selId));
        return e ? `${e.emp_code} — ${e.emp_name}` : '— Not assigned —';
    };

    tbody.innerHTML = wsGroups.map(g =>
        g.processes.map((p, idx) => {
            const isFirst = idx === 0;
            const rs = g.processes.length > 1 ? ` rowspan="${g.processes.length}"` : '';
            const samSec = (parseFloat(p.operation_sah || 0) * 3600).toFixed(1);
            // Cycle time = sum of all process times in this workstation (rowspan, first row only)
            const cycleCell = isFirst
                ? `<td style="text-align:center;vertical-align:middle;"${rs}>${g.sam.toFixed(1)}s</td>`
                : '';
            // Per-workstation efficiency calculations
            const wsOtMins = (hasOT && g.ws) ? (window._ldWsOtMins?.[lineId]?.[g.ws] ?? otMins) : 0;
            const wsOtSecs = wsOtMins * 60;
            const otTakt   = (wsOtSecs > 0 && otTarget > 0) ? wsOtSecs / otTarget : 0;
            const regEff   = (regTakt > 0 && g.has_ws) ? (g.sam / regTakt) * 100 : null;
            const otEff    = (hasOT && wsOtSecs > 0 && otTakt > 0 && g.has_ws) ? (g.sam / otTakt) * 100 : null;
            const totalEff = (regEff != null && otEff != null)
                ? (g.sam * (target_units + otTarget)) / (workSecs + wsOtSecs) * 100 : null;
            const regEffCell = isFirst
                ? `<td style="text-align:center;font-weight:700;color:${effColor(regEff)};vertical-align:middle;"${rs}>${regEff != null ? regEff.toFixed(1)+'%' : '-'}</td>`
                : '';
            const otEffCell = isFirst
                ? `<td style="text-align:center;vertical-align:middle;"${rs}>${hasOT
                    ? `<div style="font-weight:700;color:${effColor(otEff)};">${otEff != null ? otEff.toFixed(1)+'%' : 'N/A'}</div>
                       ${g.ws ? `<div style="margin-top:3px;display:flex;align-items:center;justify-content:center;gap:3px;">
                           <input type="number" min="0" max="480" value="${wsOtMins}"
                               style="width:44px;font-size:10px;padding:1px 3px;border:1px solid #c4b5fd;border-radius:4px;text-align:center;"
                               title="OT minutes for this workstation"
                               onchange="ldUpdateWsOt(${lineId},'${g.ws.replace(/'/g,"\\'")}',this.value)">
                           <span style="font-size:9px;color:#7c3aed;">min</span>
                       </div>` : ''}`
                    : '<span style="color:#9ca3af;font-size:11px;">N/A</span>'}</td>`
                : '';
            const totalEffCell = isFirst
                ? `<td style="text-align:center;font-weight:700;color:${effColor(totalEff)};vertical-align:middle;"${rs}>${totalEff != null ? totalEff.toFixed(1)+'%' : 'N/A'}</td>`
                : '';
            // Workstation QR — rowspan on first row only (same WS = same QR)
            // In OT mode: add a Skip/Active toggle button below the QR image
            const wsQr = wsQrPath(g.ws);
            const skipBtn = (useOT && g.ws) ? `
                <button class="ld-ws-ot-toggle" data-ws="${g.ws}" data-ot-skipped="${g.is_ot_skipped ? 'true' : 'false'}"
                    onclick="ldWsToggleOTSkip(this,${lineId})"
                    style="margin-top:5px;display:block;width:100%;font-size:10px;font-weight:700;border-radius:10px;cursor:pointer;padding:2px 6px;border:1px solid ${g.is_ot_skipped ? '#fca5a5' : '#86efac'};background:${g.is_ot_skipped ? '#fee2e2' : '#dcfce7'};color:${g.is_ot_skipped ? '#b91c1c' : '#15803d'};">
                    ${g.is_ot_skipped ? 'Skipped' : 'Active'}
                </button>` : '';
            const wsQrCell = isFirst
                ? `<td style="text-align:center;vertical-align:middle;padding:4px;"${rs}>${qrThumb(wsQr, g.ws || 'Workstation')}${skipBtn}</td>`
                : '';
            // Employee cell — rowspan on first row, searchable custom picker + QR
            // In OT mode, dim/disable when workstation is skipped
            const empQr = empQrMap.get(String(g.employee_id || '')) || '';
            const empImgId = `emp-qr-img-${g.ws.replace(/\W/g, '_')}`;
            const currentEmpLabel = empLabel(g.employee_id).replace(/</g,'&lt;').replace(/>/g,'&gt;');
            const empCellStyle = (useOT && g.is_ot_skipped)
                ? 'vertical-align:middle;padding:6px;opacity:0.35;pointer-events:none;'
                : 'vertical-align:middle;padding:6px;';
            const empCell = isFirst
                ? `<td${rs} style="${empCellStyle}">
                       <div class="ld-emp-picker" data-ws="${g.ws}" data-value="${g.employee_id||''}" style="position:relative;">
                           <div class="ld-emp-display" onclick="ldEmpPickerToggle(this.parentElement,${lineId})"
                               style="cursor:pointer;padding:5px 8px;border:1px solid #d1d5db;border-radius:6px;
                                      font-size:0.82em;min-width:175px;background:#fff;display:flex;
                                      justify-content:space-between;align-items:center;gap:4px;user-select:none;">
                               <span class="ld-emp-current-label" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${currentEmpLabel}</span>
                               <span style="color:#9ca3af;font-size:10px;flex-shrink:0;">▾</span>
                           </div>
                           <div class="ld-emp-dropdown" style="display:none;position:absolute;left:0;top:calc(100% + 3px);
                                z-index:600;background:#fff;border:1px solid #d1d5db;border-radius:8px;
                                box-shadow:0 6px 24px rgba(0,0,0,.15);min-width:260px;overflow:hidden;">
                               <div style="padding:6px 6px 4px;border-bottom:1px solid #f3f4f6;">
                                   <input class="ld-emp-search form-control" style="font-size:0.82em;padding:5px 8px;"
                                          placeholder="&#128269; Search by name or code..."
                                          oninput="ldEmpPickerFilter(this)"
                                          onclick="event.stopPropagation()">
                               </div>
                               <div class="ld-emp-options" style="max-height:220px;overflow-y:auto;">
                                   ${empPickerOpts(g.employee_id, g.ws)}
                               </div>
                           </div>
                       </div>
                       <div style="margin-top:6px;text-align:center;">${qrThumb(empQr, (g.emp_name||g.emp_code||'Employee'), empImgId)}</div>
                   </td>`
                : '';
            // Dim the entire row when the WS is skipped in OT mode
            const rowOpacity = (useOT && g.is_ot_skipped) ? 'opacity:0.45;' : '';
            const lpwpId = p.lpwp_id || null;
            const osmChecked = !!p.osm_checked;
            const osmCell = `<td style="text-align:center;">
                       <input type="checkbox" class="ld-osm-check" data-process-id="${p.id}"
                           title="OSM observation point" ${osmChecked ? 'checked' : ''}
                           style="width:15px;height:15px;cursor:pointer;accent-color:#7c3aed;"
                           ${lpwpId ? `onchange="toggleOsmCheck(${lpwpId}, this.checked, this)"` : ''}>
                       <div class="osm-seq-label" style="font-size:10px;color:#7c3aed;font-weight:700;margin-top:1px;min-height:12px;line-height:1;"></div>
                   </td>`;
            return `<tr style="background:${g.color};${rowOpacity}" data-process-id="${p.id}">
                <td style="text-align:center;font-weight:600;">${p.sequence_number}</td>
                <td><input type="text" class="form-control ld-group" style="font-size:0.82em;padding:3px 6px;width:64px;" value="${(p.group_name||'').trim()}" placeholder="G1" data-pid="${p.id}" onblur="recolorDetailRows(${lineId})"></td>
                ${osmCell}
                <td><input type="text" class="form-control ld-ws" style="font-size:0.82em;padding:3px 6px;width:64px;" value="${g.ws}" placeholder="W1" data-pid="${p.id}" onfocus="this.dataset.prev=this.value" onblur="validateAndApplyWs(this,${lineId})"></td>
                ${wsQrCell}
                <td>${p.operation_name}<br><small style="color:#9ca3af;font-size:0.78em;">${p.operation_code||''}</small></td>
                <td style="text-align:center;">${samSec}s</td>
                ${cycleCell}
                ${regEffCell}
                <td style="text-align:center;">${parseFloat(p.operation_sah||0).toFixed(4)}</td>
                ${empCell}
            </tr>`;
        }).join('')
    ).join('');
    // Run sync after render to apply correct disable states
    syncEmpDropdowns(lineId);
    refreshOsmLabels(tbody);
}

// Re-evaluate taken states across all WS pickers and update QR images.
// Called after any employee selection changes.
function syncEmpDropdowns(lineId) {
    const tbody = document.getElementById(`ld-body-${lineId}`);
    if (!tbody) return;
    const allPickers = Array.from(tbody.querySelectorAll('.ld-emp-picker'));

    // Collect current page selections: empId → wsCode
    const pageSelected = new Map();
    allPickers.forEach(p => { if (p.dataset.value) pageSelected.set(String(p.dataset.value), p.dataset.ws); });

    // Filter taken employees by current shift mode (regular vs OT are independent pools)
    const isOT = !!window._ldActiveOT?.[lineId];
    const allAssignments = (_ldData?.data?.all_assignments || []).filter(a => !!a.is_overtime === isOT);
    const otherLineTaken = new Map();
    allAssignments.forEach(a => {
        if (String(a.line_id) !== String(lineId))
            otherLineTaken.set(String(a.employee_id), a.workstation_code);
    });

    const empQrMap = new Map((_ldData?.data?.employees || []).map(e => [String(e.id), e.qr_code_path || '']));

    allPickers.forEach(picker => {
        const thisWs = picker.dataset.ws;
        const thisSelected = picker.dataset.value || '';

        // Update each option's taken state
        picker.querySelectorAll('.ld-emp-option').forEach(opt => {
            const eId = opt.dataset.empId || '';
            if (!eId) return; // "Not assigned" — always available
            const isThisSelected = eId === thisSelected;
            const takenOnPage = pageSelected.has(eId) && pageSelected.get(eId) !== thisWs;
            const takenOtherLine = otherLineTaken.has(eId);
            const isTaken = !isThisSelected && (takenOnPage || takenOtherLine);

            opt.classList.toggle('ld-emp-taken', isTaken);
            opt.style.cursor = isTaken ? 'default' : 'pointer';
            opt.style.color = isTaken ? '#9ca3af' : '';
            opt.style.background = isThisSelected ? '#eff6ff' : '';
            opt.style.fontWeight = isThisSelected ? '600' : '';

            // Taken badge
            let badge = opt.querySelector('.ld-taken-badge');
            if (isTaken && !badge) {
                badge = document.createElement('span');
                badge.className = 'ld-taken-badge';
                badge.style.cssText = 'color:#f87171;font-size:11px;margin-left:6px;';
                badge.textContent = 'Taken ✗';
                opt.appendChild(badge);
            } else if (!isTaken && badge) {
                badge.remove();
            }
        });

        // Update employee QR image
        const wsKey = thisWs.replace(/\W/g, '_');
        const imgEl = document.getElementById(`emp-qr-img-${wsKey}`);
        if (imgEl) {
            const qrPath = empQrMap.get(thisSelected) || '';
            if (qrPath) {
                imgEl.src = '/' + qrPath;
                imgEl.style.opacity = '1';
                const empName = _ldData?.data?.employees?.find(e => String(e.id) === thisSelected)?.emp_name || 'Employee';
                imgEl.onclick = () => showQrModal('/' + qrPath, empName);
            } else {
                imgEl.src = '';
                imgEl.style.opacity = '0.15';
            }
        }
    });
}

function renderLineDetailsPanel(panel, lineId, date, data) {
    renderLineDetailsContent(panel, lineId, date, data);
}

function _ldQrSelectionKey(lineId, date, activeOT, displayIsChangeover) {
    return [lineId, date, activeOT ? 'ot' : 'regular', displayIsChangeover ? 'changeover' : 'primary'].join(':');
}

function _ldBuildQrEmployeeList(wsGroups, employees) {
    const seen = new Set();
    const byId = new Map((employees || []).map(emp => [String(emp.id), emp]));
    const list = [];
    (wsGroups || []).forEach(group => {
        if (!group.employee_id) return;
        const key = String(group.employee_id);
        if (seen.has(key)) return;
        seen.add(key);
        const emp = byId.get(key) || {};
        list.push({
            id: key,
            emp_code: group.emp_code || emp.emp_code || '',
            emp_name: group.emp_name || emp.emp_name || ''
        });
    });
    return list.sort((a, b) => `${a.emp_name} ${a.emp_code}`.localeCompare(`${b.emp_name} ${b.emp_code}`, undefined, { sensitivity: 'base' }));
}

function _ldEnsureQrSelection(lineId, date, activeOT, displayIsChangeover, lineEmployees) {
    if (!window._ldQrSelections) window._ldQrSelections = {};
    if (!window._ldQrEmployees) window._ldQrEmployees = {};
    const key = _ldQrSelectionKey(lineId, date, activeOT, displayIsChangeover);
    window._ldQrEmployees[key] = lineEmployees;
    if (!window._ldQrSelections[key]) {
        window._ldQrSelections[key] = new Set(lineEmployees.map(emp => String(emp.id)));
    } else {
        const currentIds = new Set(lineEmployees.map(emp => String(emp.id)));
        const next = new Set();
        window._ldQrSelections[key].forEach(id => {
            if (currentIds.has(String(id))) next.add(String(id));
        });
        lineEmployees.forEach(emp => {
            const id = String(emp.id);
            if (!window._ldQrSelections[key].has(id)) next.add(id);
        });
        window._ldQrSelections[key] = next;
    }
    return window._ldQrSelections[key];
}

function _ldUpdateQrSelectionUI(lineId, date, activeOT, displayIsChangeover, lineEmployees) {
    const key = _ldQrSelectionKey(lineId, date, activeOT, displayIsChangeover);
    const selected = window._ldQrSelections?.[key] || new Set();
    const total = lineEmployees.length;
    const countEl = document.getElementById(`ld-qr-count-${lineId}`);
    if (countEl) countEl.textContent = `${selected.size} selected`;
    const allCb = document.getElementById(`ld-qr-all-${lineId}`);
    if (allCb) {
        allCb.checked = total > 0 && selected.size === total;
        allCb.indeterminate = selected.size > 0 && selected.size < total;
    }
}

function toggleLdQrEmpDropdown(lineId) {
    const dd = document.getElementById(`ld-qr-dropdown-${lineId}`);
    if (!dd) return;
    const isOpen = dd.style.display !== 'none';
    document.querySelectorAll('[id^="ld-qr-dropdown-"]').forEach(el => { el.style.display = 'none'; });
    dd.style.display = isOpen ? 'none' : 'block';
    if (!isOpen) document.getElementById(`ld-qr-search-${lineId}`)?.focus();
}

function filterLdQrEmpList(lineId) {
    const q = (document.getElementById(`ld-qr-search-${lineId}`)?.value || '').toLowerCase();
    document.querySelectorAll(`#ld-qr-list-${lineId} .ld-qr-emp-item`).forEach(item => {
        item.style.display = item.dataset.label.toLowerCase().includes(q) ? '' : 'flex';
    });
}

function toggleLdQrEmployee(lineId, date, activeOT, displayIsChangeover, employeeId, checked) {
    if (!window._ldQrSelections) window._ldQrSelections = {};
    const key = _ldQrSelectionKey(lineId, date, activeOT, displayIsChangeover);
    if (!window._ldQrSelections[key]) window._ldQrSelections[key] = new Set();
    if (checked) window._ldQrSelections[key].add(String(employeeId));
    else window._ldQrSelections[key].delete(String(employeeId));
    _ldUpdateQrSelectionUI(lineId, date, activeOT, displayIsChangeover, window._ldQrEmployees?.[key] || []);
}

function toggleLdQrAllEmployees(lineId, date, activeOT, displayIsChangeover, checked) {
    if (!window._ldQrSelections) window._ldQrSelections = {};
    const key = _ldQrSelectionKey(lineId, date, activeOT, displayIsChangeover);
    const lineEmployees = window._ldQrEmployees?.[key] || [];
    window._ldQrSelections[key] = checked ? new Set(lineEmployees.map(emp => String(emp.id))) : new Set();
    document.querySelectorAll(`#ld-qr-list-${lineId} .ld-qr-emp-item input[type="checkbox"]`).forEach(cb => {
        cb.checked = checked;
    });
    _ldUpdateQrSelectionUI(lineId, date, activeOT, displayIsChangeover, lineEmployees);
}

async function downloadLineDetailsQrExcel(lineId, date, activeOT, displayIsChangeover) {
    const key = _ldQrSelectionKey(lineId, date, activeOT, displayIsChangeover);
    const selectedIds = [...(window._ldQrSelections?.[key] || [])];
    if (!selectedIds.length) {
        showToast('Select at least one employee from this line', 'error');
        return;
    }
    const suffix = activeOT ? 'ot' : (displayIsChangeover ? 'changeover' : 'primary');
    await downloadEmployeeQrExcelForIds(selectedIds, `line_${lineId}_${suffix}_employee_qr_codes`);
}

function renderLineDetailsContent(panel, lineId, date, data) {
    // Plan-level fields — always from the primary plan data
    const { employees, products, product,
            overtime_minutes: otMins = 0, overtime_target: otTarget = 0,
            incoming_product_id = null, incoming_target_units = 0, changeover_sequence = 0,
            is_locked = false } = data;

    // Regular product mode: 'primary' or 'changeover' (for the non-OT view)
    if (!window._ldProductMode) window._ldProductMode = {};
    const mode = window._ldProductMode[lineId] || 'primary';
    const isChangeover = mode === 'changeover' && !!incoming_product_id;

    // OT toggle — available regardless of which product is selected in regular mode
    if (typeof window._ldActiveOT === 'undefined') window._ldActiveOT = {};
    if (!window._ldOTProduct) window._ldOTProduct = {};
    const hasOT = otMins > 0 && otTarget > 0;
    const activeOT = hasOT && !!(window._ldActiveOT[lineId]);
    // OT product: which product is being manufactured during overtime (independent of regular mode)
    const otProductMode = window._ldOTProduct[lineId] || 'primary';
    const isOTChangeover = activeOT && otProductMode === 'changeover' && !!incoming_product_id;

    // displayIsChangeover drives what data is shown in the table.
    // In OT mode it follows the OT product; in regular mode it follows the view toggle.
    const displayIsChangeover = activeOT ? isOTChangeover : isChangeover;
    const activeViewData = displayIsChangeover ? (_ldData?.changeoverData || data) : data;
    const processes      = activeViewData.processes || [];
    const target_units   = displayIsChangeover ? incoming_target_units : (data.target_units || 0);
    const workSecs       = _ldGetWorkSecs(lineId);
    const regularTaktSecs = (workSecs > 0 && target_units > 0)
        ? workSecs / target_units
        : (activeViewData.takt_time_seconds || 0);

    if (!processes || processes.length === 0) {
        panel.innerHTML = `<div class="alert alert-info">${displayIsChangeover ? 'No processes found for the changeover product.' : 'No product assigned for this line on ' + date + ', or product has no active processes.'}</div>`;
        return;
    }

    const otTaktSecs = hasOT ? (otMins * 60) / otTarget : 0;
    const activeTakt = activeOT ? otTaktSecs : regularTaktSecs;

    const fmtTakt = s => s > 0 ? `${Math.floor(s/60)}m ${Math.round(s%60)}s` : '-';
    const taktDisplay = fmtTakt(regularTaktSecs);
    const otTaktDisplay = fmtTakt(otTaktSecs);

    const wsGroups = _buildWsGroups(processes, activeTakt, activeOT);
    const assignedWs = wsGroups.filter(g => g.ws).length;
    const lineQrEmployees = _ldBuildQrEmployeeList(wsGroups, employees);
    const lineQrSelection = _ldEnsureQrSelection(lineId, date, activeOT, displayIsChangeover, lineQrEmployees);
    const lineQrPicker = lineQrEmployees.length ? `
        <div id="ld-qr-picker-${lineId}" style="position:relative;">
            <button class="btn btn-secondary btn-sm" onclick="toggleLdQrEmpDropdown(${lineId})" type="button">
                QR Employees
            </button>
            <div id="ld-qr-dropdown-${lineId}" style="display:none;position:absolute;right:0;top:calc(100% + 6px);z-index:800;background:#fff;border:1px solid #d1d5db;border-radius:10px;box-shadow:0 10px 28px rgba(0,0,0,.18);width:300px;overflow:hidden;">
                <div style="padding:10px;border-bottom:1px solid #eef2f7;">
                    <input id="ld-qr-search-${lineId}" class="form-control" style="font-size:12px;padding:6px 8px;" placeholder="Search employee..." oninput="filterLdQrEmpList(${lineId})">
                    <label style="display:flex;align-items:center;gap:8px;margin-top:8px;font-size:12px;font-weight:600;cursor:pointer;color:#374151;">
                        <input type="checkbox" id="ld-qr-all-${lineId}" ${lineQrSelection.size === lineQrEmployees.length ? 'checked' : ''} onchange="toggleLdQrAllEmployees(${lineId},'${date}',${activeOT ? 'true' : 'false'},${displayIsChangeover ? 'true' : 'false'},this.checked)">
                        <span>Select all line employees</span>
                    </label>
                </div>
                <div id="ld-qr-list-${lineId}" style="max-height:260px;overflow-y:auto;padding:6px 0;">
                    ${lineQrEmployees.map(emp => {
                        const label = `${emp.emp_name} (${emp.emp_code})`;
                        return `<label class="ld-qr-emp-item" data-label="${label.replace(/"/g, '&quot;')}" style="display:flex;align-items:center;gap:8px;padding:7px 12px;cursor:pointer;font-size:12px;color:#374151;">
                            <input type="checkbox" ${lineQrSelection.has(String(emp.id)) ? 'checked' : ''} onchange="toggleLdQrEmployee(${lineId},'${date}',${activeOT ? 'true' : 'false'},${displayIsChangeover ? 'true' : 'false'},'${String(emp.id)}',this.checked)">
                            <span>${emp.emp_name} <span style="color:#6b7280;">(${emp.emp_code})</span></span>
                        </label>`;
                    }).join('')}
                </div>
                <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-top:1px solid #eef2f7;background:#f8fafc;">
                    <span id="ld-qr-count-${lineId}" style="font-size:12px;color:#6b7280;">${lineQrSelection.size} selected</span>
                    <button class="btn btn-primary btn-sm" onclick="downloadLineDetailsQrExcel(${lineId},'${date}',${activeOT ? 'true' : 'false'},${displayIsChangeover ? 'true' : 'false'})" type="button">
                        Download QR Sheet
                    </button>
                </div>
            </div>
        </div>
    ` : '';

    const otToggleHtml = hasOT ? `
        <span style="display:inline-flex;align-items:center;gap:6px;margin-left:12px;background:#f3f4f6;border-radius:20px;padding:2px 4px;border:1px solid #e5e7eb;">
            <button id="ld-takt-reg-${lineId}" onclick="switchLdTakt(${lineId}, false)"
                style="border:none;border-radius:16px;padding:3px 10px;font-size:11px;font-weight:600;cursor:pointer;
                       background:${!activeOT ? '#3b82f6' : 'transparent'};color:${!activeOT ? '#fff' : '#6b7280'};">
                Regular
            </button>
            <button id="ld-takt-ot-${lineId}" onclick="switchLdTakt(${lineId}, true)"
                style="border:none;border-radius:16px;padding:3px 10px;font-size:11px;font-weight:600;cursor:pointer;
                       background:${activeOT ? '#7c3aed' : 'transparent'};color:${activeOT ? '#fff' : '#6b7280'};">
                OT +${otMins}m
            </button>
        </span>
    ` : '';

    // Plan settings card always uses primary plan data
    const planPrimaryTarget = data.target_units || 0;
    const productOpts = (products || []).map(p =>
        `<option value="${p.id}" ${p.id === product?.id ? 'selected' : ''}>${p.product_code} — ${p.product_name}</option>`
    ).join('');
    const incomingOpts = `<option value="">None (no changeover)</option>` + (products || []).map(p =>
        `<option value="${p.id}" ${p.id === incoming_product_id ? 'selected' : ''}>${p.product_code} — ${p.product_name}</option>`
    ).join('');
    const lockedAttr = is_locked ? 'disabled' : '';

    const incomingProd = (products || []).find(p => p.id === incoming_product_id);

    // Regular product toggle — only visible when NOT in OT mode
    const productToggle = (!activeOT && incoming_product_id) ? `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
            <span style="font-size:12px;font-weight:600;color:#6b7280;">Viewing plan for:</span>
            <div style="display:inline-flex;background:#f3f4f6;border-radius:20px;padding:3px 4px;gap:2px;">
                <button onclick="switchLdProduct(${lineId},'primary')"
                    style="border:none;border-radius:16px;padding:5px 14px;font-size:12px;font-weight:600;cursor:pointer;transition:all .15s;
                           background:${!isChangeover ? '#3b82f6' : 'transparent'};color:${!isChangeover ? '#fff' : '#6b7280'};">
                    &#9654; Primary: ${product?.product_code || '—'}
                </button>
                <button onclick="switchLdProduct(${lineId},'changeover')"
                    style="border:none;border-radius:16px;padding:5px 14px;font-size:12px;font-weight:600;cursor:pointer;transition:all .15s;
                           background:${isChangeover ? '#f59e0b' : 'transparent'};color:${isChangeover ? '#fff' : '#6b7280'};">
                    &#8652; Changeover: ${incomingProd?.product_code || '—'}
                </button>
            </div>
            ${isChangeover ? `<span style="font-size:11px;color:#92400e;background:#fef3c7;border-radius:10px;padding:2px 8px;">Editing changeover product plan</span>` : ''}
        </div>
    ` : '';

    // OT product toggle — only visible when in OT mode
    const otProductToggle = (activeOT && incoming_product_id) ? `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
            <span style="font-size:12px;font-weight:600;color:#7c3aed;">OT working on:</span>
            <div style="display:inline-flex;background:#f5f3ff;border-radius:20px;padding:3px 4px;gap:2px;border:1px solid #ddd6fe;">
                <button onclick="switchLdOTProduct(${lineId},'primary')"
                    style="border:none;border-radius:16px;padding:5px 14px;font-size:12px;font-weight:600;cursor:pointer;transition:all .15s;
                           background:${!isOTChangeover ? '#7c3aed' : 'transparent'};color:${!isOTChangeover ? '#fff' : '#6b7280'};">
                    &#9654; Primary: ${product?.product_code || '—'}
                </button>
                <button onclick="switchLdOTProduct(${lineId},'changeover')"
                    style="border:none;border-radius:16px;padding:5px 14px;font-size:12px;font-weight:600;cursor:pointer;transition:all .15s;
                           background:${isOTChangeover ? '#f59e0b' : 'transparent'};color:${isOTChangeover ? '#fff' : '#6b7280'};">
                    &#8652; Changeover: ${incomingProd?.product_code || '—'}
                </button>
            </div>
            ${isOTChangeover ? `<span style="font-size:11px;color:#92400e;background:#fef3c7;border-radius:10px;padding:2px 8px;">OT on changeover product</span>` : `<span style="font-size:11px;color:#5b21b6;background:#f5f3ff;border-radius:10px;padding:2px 8px;border:1px solid #ddd6fe;">OT on primary product</span>`}
        </div>
    ` : '';

    panel.innerHTML = `
        <!-- Plan Settings Card -->
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:14px 18px;margin-bottom:14px;display:flex;flex-wrap:wrap;gap:14px;align-items:flex-end;">
            <div style="flex:1;min-width:200px;">
                <label style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px;">Style (Primary)</label>
                <select id="ld-product-${lineId}" class="form-control" style="font-size:0.88em;" ${lockedAttr}>
                    ${productOpts}
                </select>
            </div>
            <div style="min-width:90px;">
                <label style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px;">Target</label>
                <input type="number" id="ld-target-${lineId}" class="form-control" style="font-size:0.88em;width:90px;" value="${planPrimaryTarget}" min="0" ${lockedAttr}>
            </div>
            <div style="flex:1;min-width:200px;">
                <label style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px;">Changeover Style</label>
                <select id="ld-incoming-${lineId}" class="form-control" style="font-size:0.88em;" ${lockedAttr}>
                    ${incomingOpts}
                </select>
            </div>
            <div style="min-width:90px;">
                <label style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px;">Incoming Target</label>
                <input type="number" id="ld-incoming-target-${lineId}" class="form-control" style="font-size:0.88em;width:90px;" value="${incoming_target_units||0}" min="0" ${lockedAttr}>
            </div>
            <div style="min-width:80px;">
                <label style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px;">CO Progress</label>
                <div style="font-size:0.95em;font-weight:700;color:${changeover_sequence > 0 ? '#92400e' : '#9ca3af'};padding:6px 4px;">
                    ${changeover_sequence > 0 ? `P${changeover_sequence}` : '—'}
                    <span style="font-size:10px;font-weight:400;color:#9ca3af;display:block;">auto-advanced</span>
                </div>
            </div>
            <div style="display:flex;align-items:flex-end;gap:6px;">
                ${is_locked
                    ? `<span style="background:#fee2e2;color:#b91c1c;padding:6px 12px;border-radius:6px;font-size:12px;font-weight:600;">🔒 Locked</span>`
                    : `<button class="btn btn-primary btn-sm" onclick="saveLdPlanSettings(${lineId})" style="white-space:nowrap;">Update Plan</button>`}
            </div>
        </div>
        <!-- Product mode toggle (regular) / OT product toggle -->
        ${productToggle}${otProductToggle}
        <!-- Workstation Summary -->
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px;">
            <span style="font-size:0.85em;color:#6b7280;">
                <strong style="color:${displayIsChangeover?'#92400e':'#1e293b'}">${displayIsChangeover ? (incomingProd?.product_code||'CO') : (product?.product_code||'')} — ${displayIsChangeover ? (incomingProd?.product_name||'') : (product?.product_name||'')}</strong>
                &nbsp;|&nbsp; Takt: <strong id="ld-takt-display-${lineId}">${activeOT ? otTaktDisplay : taktDisplay}</strong>
                ${otToggleHtml}
                &nbsp;|&nbsp; Target: <strong>${target_units}</strong>
                &nbsp;|&nbsp; Processes: <strong>${processes.length}</strong>
                &nbsp;|&nbsp; Workstations: <strong>${assignedWs}</strong>
                ${hasOT ? `&nbsp;|&nbsp; OT: <strong style="color:#7c3aed;">+${otMins}m / +${otTarget} units</strong>` : ''}
            </span>
            <div style="margin-left:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                ${lineQrPicker}
                <button class="btn btn-primary btn-sm" onclick="saveLineDetails(${lineId})" ${is_locked ? 'disabled' : ''}
                    style="${activeOT ? 'background:#7c3aed;border-color:#7c3aed;' : displayIsChangeover ? 'background:#f59e0b;border-color:#f59e0b;' : ''}">
                    &#10003; ${activeOT ? `Save OT Employees${isOTChangeover ? ' (Changeover)' : ''}` : displayIsChangeover ? 'Save Changeover Plan' : 'Save Workstation Plan'}
                </button>
            </div>
        </div>
        ${activeOT ? `<div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:8px;padding:8px 14px;margin-bottom:8px;font-size:0.82em;color:#5b21b6;display:flex;align-items:center;gap:8px;">
            <strong>OT Mode${isOTChangeover ? ' — Changeover Product' : ''}:</strong> Assigning employees for the overtime shift${isOTChangeover ? ' on the changeover product' : ''}. Workstation layout unchanged — only employee assignments are saved.
        </div>` : ''}
        <div style="font-size:0.78em;color:#6b7280;margin-bottom:8px;">
            Enter <strong>Group</strong> (e.g. G1) and <strong>Workstation</strong> (e.g. W1) per process.
            Processes with the same workstation share one employee assignment. Tab out to regroup.
        </div>
        <div class="table-container">
            <table id="ld-table-${lineId}" style="font-size:0.88em;width:100%;">
                <thead>
                    <tr>
                        <th style="text-align:center;">Seq</th>
                        <th>Group</th>
                        <th style="text-align:center;" title="OSM observation point — checked processes appear in OSM report">OSM</th>
                        <th>Workstation</th>
                        <th style="text-align:center;">WS QR</th>
                        <th>Operation</th>
                        <th style="text-align:center;">Process Time</th>
                        <th style="text-align:center;">Cycle Time</th>
                        <th style="text-align:center;">Workload%</th>
                        <th style="text-align:center;">SAH</th>
                        <th style="min-width:180px;">Employee</th>
                    </tr>
                </thead>
                <tbody id="ld-body-${lineId}"></tbody>
            </table>
        </div>
    `;
    _buildLdTbody(document.getElementById(`ld-body-${lineId}`), lineId, wsGroups, employees, activeOT,
        { workSecs, target_units, otMins, otTarget, hasOT });
    _ldUpdateQrSelectionUI(lineId, date, activeOT, displayIsChangeover, lineQrEmployees);
}

function switchLdTakt(lineId, useOT) {
    if (!_ldData || _ldData.lineId !== lineId) return;
    if (typeof window._ldActiveOT === 'undefined') window._ldActiveOT = {};
    window._ldActiveOT[lineId] = useOT;
    const panel = document.getElementById('ld-overlay-content');
    if (panel) renderLineDetailsContent(panel, lineId, _ldData.date, _ldData.data);
}

// Switch which product is being worked during OT (independent of the regular view toggle)
async function switchLdOTProduct(lineId, mode) {
    if (!_ldData || _ldData.lineId !== lineId) return;
    if (!window._ldOTProduct) window._ldOTProduct = {};
    window._ldOTProduct[lineId] = mode;

    const panel = document.getElementById('ld-overlay-content');
    if (!panel) return;

    // Lazy-load changeover data if not yet fetched
    if (mode === 'changeover' && !_ldData.changeoverData) {
        const { date, data } = _ldData;
        const incomingId = data.incoming_product_id;
        const incomingTarget = data.incoming_target_units || 0;
        if (!incomingId) { showToast('No changeover product configured for this line', 'error'); return; }
        panel.innerHTML = '<div style="text-align:center;padding:40px;color:#6b7280;">Loading changeover product plan…</div>';
        try {
            const params = new URLSearchParams({ date });
            params.set('product_id', incomingId);
            params.set('target', incomingTarget);
            const res = await fetch(`/api/lines/${lineId}/line-process-details?${params}`);
            const r = await res.json();
            if (!r.success) { showToast(r.error, 'error'); return; }
            _ldData.changeoverData = r.data;
        } catch (err) { showToast(err.message, 'error'); return; }
    }
    _ldSyncCopyPlanButton(lineId);
    renderLineDetailsContent(panel, lineId, _ldData.date, _ldData.data);
}

// Switch between primary / changeover product view in the details overlay
async function switchLdProduct(lineId, mode) {
    if (!_ldData || _ldData.lineId !== lineId) return;
    if (!window._ldProductMode) window._ldProductMode = {};
    window._ldProductMode[lineId] = mode;

    const panel = document.getElementById('ld-overlay-content');
    if (!panel) return;

    if (mode === 'changeover' && !_ldData.changeoverData) {
        const { date, data } = _ldData;
        const incomingId = data.incoming_product_id;
        const incomingTarget = data.incoming_target_units || 0;
        if (!incomingId) { showToast('No changeover product configured for this line', 'error'); return; }

        panel.innerHTML = '<div style="text-align:center;padding:40px;color:#6b7280;">Loading changeover product plan…</div>';
        try {
            const params = new URLSearchParams({ date });
            params.set('product_id', incomingId);
            params.set('target', incomingTarget);
            const res = await fetch(`/api/lines/${lineId}/line-process-details?${params}`);
            const r = await res.json();
            if (!r.success) { showToast(r.error, 'error'); return; }
            _ldData.changeoverData = r.data;
        } catch (err) { showToast(err.message, 'error'); return; }
    }

    _ldSyncCopyPlanButton(lineId);
    renderLineDetailsContent(panel, lineId, _ldData.date, _ldData.data);
}

// Save the plan settings (product, target, changeover) from the details overlay
async function saveLdPlanSettings(lineId) {
    if (!_ldData || _ldData.lineId !== lineId) return;
    const { date } = _ldData;

    const productId = parseInt(document.getElementById(`ld-product-${lineId}`)?.value || '0', 10);
    const targetUnits = parseInt(document.getElementById(`ld-target-${lineId}`)?.value || '0', 10);
    const incomingProductId = document.getElementById(`ld-incoming-${lineId}`)?.value || '';
    const incomingTarget = parseInt(document.getElementById(`ld-incoming-target-${lineId}`)?.value || '0', 10);

    if (!productId) { showToast('Please select a product', 'error'); return; }
    if (incomingProductId && parseInt(incomingProductId, 10) === productId) {
        showToast('Changeover product must be different from the primary product', 'error');
        return;
    }

    try {
        const res = await fetch('/api/daily-plans', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                line_id: lineId,
                product_id: productId,
                work_date: date,
                target_units: targetUnits,
                incoming_product_id: incomingProductId ? parseInt(incomingProductId, 10) : null,
                incoming_target_units: incomingProductId ? incomingTarget : 0
            })
        });
        const result = await res.json();
        if (!result.success) { showToast(result.error, 'error'); return; }

        showToast('Plan updated', 'success');
        // Reload details — product may have changed (different process list)
        const panel = document.getElementById('ld-overlay-content');
        if (panel) {
            panel.innerHTML = '<div style="text-align:center;padding:40px;color:#6b7280;">Reloading...</div>';
            const params = new URLSearchParams({ date });
            params.set('product_id', productId);
            params.set('target', targetUnits);
            const res2 = await fetch(`/api/lines/${lineId}/line-process-details?${params}`);
            const r2 = await res2.json();
            if (r2.success) {
                _ldData.data = r2.data;
                _ldData.changeoverData = null; // force re-fetch with new CO product
                if (window._ldProductMode) window._ldProductMode[lineId] = 'primary'; // reset to primary tab
                renderLineDetailsContent(panel, lineId, date, r2.data);
            }
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// Called onblur for each WS input. Validates the proposed change before allowing
// the table to re-render. If invalid, reverts the input to its previous value.
function validateAndApplyWs(input, lineId) {
    if (!_ldData || _ldData.lineId !== lineId) return;

    const newWs = input.value.trim();
    const prevWs = input.dataset.prev ?? '';

    // Nothing changed — just recolor normally
    if (newWs === prevWs) { recolorDetailRows(lineId); return; }

    const changedPid = parseInt(input.dataset.pid, 10);
    const tbody = document.getElementById(`ld-body-${lineId}`);
    if (!tbody) return;

    // Build the PROPOSED process list with the new WS applied, keeping sequence order
    const _valIsOT = !!window._ldActiveOT?.[lineId];
    const _valMode = _valIsOT ? (window._ldOTProduct?.[lineId] || 'primary') : (window._ldProductMode?.[lineId] || 'primary');
    const _valIsChangeover = _valMode === 'changeover' && !!_ldData.changeoverData && !!_ldData.data.incoming_product_id;
    const _valSource = _valIsChangeover ? _ldData.changeoverData : _ldData.data;
    const proposed = _valSource.processes.map(p => {
        if (p.id === changedPid) return { ...p, workstation_code: newWs };
        // Read other rows' current values directly from the DOM
        const row = tbody.querySelector(`tr[data-process-id="${p.id}"]`);
        const currentWs = row?.querySelector('.ld-ws')?.value.trim() ?? (p.workstation_code || '');
        return { ...p, workstation_code: currentWs };
    });

    // Valid change — accept it and redraw
    recolorDetailRows(lineId);
}

function recolorDetailRows(lineId) {
    if (!_ldData || _ldData.lineId !== lineId) return;
    const tbody = document.getElementById(`ld-body-${lineId}`);
    if (!tbody) return;

    const rMode = window._ldProductMode?.[lineId] || 'primary';
    const isOT = !!window._ldActiveOT?.[lineId];
    const rOTProd = window._ldOTProduct?.[lineId] || 'primary';
    // displayIsChangeover: which product's data is actually shown in the table right now
    const isRChangeover = isOT
        ? (rOTProd === 'changeover' && !!_ldData.changeoverData && !!_ldData.data.incoming_product_id)
        : (rMode === 'changeover' && !!_ldData.changeoverData);
    const rSource = isRChangeover ? _ldData.changeoverData : _ldData.data;

    // Collect employee per WS from the pickers (one per WS group)
    const wsEmpMap = new Map();
    tbody.querySelectorAll('.ld-emp-picker').forEach(p => {
        wsEmpMap.set(p.dataset.ws, p.dataset.value || null);
    });
    // In OT mode, also collect skip state per WS from the toggle buttons
    const wsSkipMap = new Map();
    if (isOT) {
        tbody.querySelectorAll('.ld-ws-ot-toggle').forEach(btn => {
            wsSkipMap.set(btn.dataset.ws, btn.dataset.otSkipped === 'true');
        });
    }
    // Collect group/ws/osm per process from text inputs and checkboxes.
    // In OT mode write employee back to ot_employee_id so regular assignments are preserved.
    const pidState = new Map();
    tbody.querySelectorAll('tr[data-process-id]').forEach(row => {
        const pid = parseInt(row.dataset.processId, 10);
        const ws = row.querySelector('.ld-ws')?.value.trim() || '';
        const group = row.querySelector('.ld-group')?.value.trim() || '';
        const empVal = wsEmpMap.get(ws) || null;
        const osmCb = row.querySelector('.ld-osm-check');
        const state = { workstation_code: ws, group_name: group || null, osm_checked: osmCb ? osmCb.checked : false };
        if (isOT) {
            state.ot_employee_id = empVal;
            if (wsSkipMap.has(ws)) state.is_ot_skipped = wsSkipMap.get(ws);
        } else {
            state.employee_id = empVal;
        }
        pidState.set(pid, state);
    });
    // Update cached processes in the correct data store
    const updatedProcesses = rSource.processes.map(p => {
        const s = pidState.get(p.id);
        return s ? { ...p, ...s } : p;
    });
    if (isRChangeover) {
        _ldData.changeoverData = { ..._ldData.changeoverData, processes: updatedProcesses };
    } else {
        _ldData.data = { ..._ldData.data, processes: updatedProcesses };
    }
    // Rebuild only the tbody (no full re-render — preserves header)
    // OT takt applies whenever isOT is true, regardless of product
    let activeTakt;
    const otMinsR   = _ldData.data.overtime_minutes || 0;
    const otTargetR = _ldData.data.overtime_target || 0;
    const hasOTData = otMinsR > 0 && otTargetR > 0;
    const workSecsR = _ldGetWorkSecs(lineId);
    const tgt       = rSource.target_units || _ldData.data.target_units || 0;
    if (isOT && hasOTData) {
        activeTakt = (otMinsR * 60) / otTargetR;
    } else {
        activeTakt = (workSecsR > 0 && tgt > 0) ? workSecsR / tgt : (rSource.takt_time_seconds || 0);
    }
    const wsGroups = _buildWsGroups(updatedProcesses, activeTakt, isOT);
    _buildLdTbody(tbody, lineId, wsGroups, rSource.employees, isOT,
        { workSecs: workSecsR, target_units: tgt, otMins: otMinsR, otTarget: otTargetR, hasOT: hasOTData });
    // Highlight out-of-sequence WS inputs
    _highlightWsSequenceErrors(tbody, updatedProcesses);
}

function _highlightWsSequenceErrors(tbody, processes) {
    tbody.querySelectorAll('tr[data-process-id]').forEach(row => {
        const wsInput = row.querySelector('.ld-ws');
        if (!wsInput) return;
        wsInput.style.borderColor = '';
        wsInput.style.background = '';
        wsInput.title = '';
    });
}

function _showWsSeqError(message) {
    const existing = document.getElementById('ws-seq-err-banner');
    if (existing) existing.remove();
    const panel = document.getElementById('ld-overlay-content') || document.getElementById('ld-content');
    if (!panel) { alert(message); return; }
    const banner = document.createElement('div');
    banner.id = 'ws-seq-err-banner';
    banner.style.cssText = 'background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;border-radius:8px;padding:12px 16px;margin-bottom:12px;font-size:13px;line-height:1.5;display:flex;gap:10px;align-items:flex-start;';
    banner.innerHTML = `
        <svg style="flex-shrink:0;margin-top:2px;" width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
        </svg>
        <div><strong>Invalid Workstation Assignment</strong><br>${message}</div>
        <button onclick="document.getElementById('ws-seq-err-banner').remove()" style="margin-left:auto;border:none;background:none;cursor:pointer;font-size:16px;color:#991b1b;flex-shrink:0;">&times;</button>
    `;
    panel.insertBefore(banner, panel.firstChild);
    banner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Returns null if ok, or an error message string describing the first violation.
// processes must be sorted by sequence_number ascending (as returned by the API).
function _validateWsSequence(processes) {
    return null;
}

async function saveLineDetails(lineId) {
    if (!_ldData || _ldData.lineId !== lineId) return;
    recolorDetailRows(lineId); // sync DOM state → _ldData
    const { date, data } = _ldData;

    const saveMode = window._ldProductMode?.[lineId] || 'primary';
    const isOT = !!window._ldActiveOT?.[lineId];
    const otProdMode = window._ldOTProduct?.[lineId] || 'primary';
    // Regular mode: which product is visible in the non-OT view
    const isSaveChangeover = !isOT && saveMode === 'changeover' && !!_ldData.changeoverData && !!data.incoming_product_id;
    // OT mode: which product is being worked during OT
    const isOTSaveChangeover = isOT && otProdMode === 'changeover' && !!_ldData.changeoverData && !!data.incoming_product_id;
    const activeProductId = isOT
        ? (isOTSaveChangeover ? data.incoming_product_id : (data.product?.id || null))
        : (isSaveChangeover   ? data.incoming_product_id : (data.product?.id || null));
    const activeTarget = isOT
        ? (isOTSaveChangeover ? (data.incoming_target_units || 0) : (data.target_units || 0))
        : (isSaveChangeover   ? (data.incoming_target_units || 0) : (data.target_units || 0));
    const activeProcesses = isOT
        ? (isOTSaveChangeover ? _ldData.changeoverData.processes : data.processes)
        : (isSaveChangeover   ? _ldData.changeoverData.processes  : data.processes);

    const tbody = document.getElementById(`ld-body-${lineId}`);
    if (!tbody) return;

    // In OT mode: only save OT employee assignments + skip state (workstation layout is unchanged)
    if (isOT) {
        // Collect employee per WS from pickers
        const wsMap = new Map(); // ws → { employee_id, is_skipped }
        tbody.querySelectorAll('.ld-emp-picker').forEach(p => {
            const ws = p.dataset.ws;
            if (ws && !wsMap.has(ws))
                wsMap.set(ws, { employee_id: p.dataset.value ? parseInt(p.dataset.value, 10) : null, is_skipped: false });
        });
        // Collect skip state from toggle buttons
        tbody.querySelectorAll('.ld-ws-ot-toggle').forEach(btn => {
            const ws = btn.dataset.ws;
            if (wsMap.has(ws)) wsMap.get(ws).is_skipped = btn.dataset.otSkipped === 'true';
            else wsMap.set(ws, { employee_id: null, is_skipped: btn.dataset.otSkipped === 'true' });
        });
        const assignments = Array.from(wsMap.entries()).map(([ws, val]) => ({
            workstation_code: ws,
            employee_id: val.is_skipped ? null : (val.employee_id || null),
            is_skipped: val.is_skipped
        }));
        try {
            const res = await fetch(`/api/lines/${lineId}/workstation-plan/employees`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ work_date: date, is_overtime: true, assignments })
            });
            const result = await res.json();
            if (result.success) {
                showToast('OT employee assignments saved', 'success');
                const params = new URLSearchParams({ date });
                if (activeProductId) params.set('product_id', activeProductId);
                if (activeTarget) params.set('target', activeTarget);
                const res2 = await fetch(`/api/lines/${lineId}/line-process-details?${params}`);
                const r2 = await res2.json();
                if (r2.success) {
                    _ldData.data = r2.data;
                    const content = document.getElementById('ld-overlay-content');
                    if (content) renderLineDetailsContent(content, lineId, date, _ldData.data);
                }
            } else {
                showToast(result.error, 'error');
            }
        } catch (err) {
            showToast(err.message, 'error');
        }
        return;
    }

    // Regular / changeover mode: full workstation plan save
    const seqError = _validateWsSequence(activeProcesses);
    if (seqError) {
        _showWsSeqError(seqError);
        return;
    }

    // Collect one employee per WS from the pickers
    const wsEmpMap = new Map();
    tbody.querySelectorAll('.ld-emp-picker').forEach(p => {
        wsEmpMap.set(p.dataset.ws, p.dataset.value || null);
    });
    // Collect OSM checkbox state per process
    const osmMap = new Map();
    tbody.querySelectorAll('.ld-osm-check').forEach(cb => {
        osmMap.set(parseInt(cb.dataset.processId, 10), cb.checked);
    });
    const rows = activeProcesses.map(p => ({
        process_id: p.id,
        group_name: p.group_name || null,
        workstation_code: p.workstation_code || '',
        employee_id: wsEmpMap.get(p.workstation_code) || null,
        osm_checked: osmMap.get(p.id) || false
    }));
    try {
        const res = await fetch(`/api/lines/${lineId}/workstation-plan/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                work_date: date,
                rows,
                product_id: activeProductId,
                target_units: activeTarget
            })
        });
        const result = await res.json();
        if (result.success) {
            showToast(result.message || 'Plan saved', 'success');
            // Reload fresh data for the active product and re-render
            const params = new URLSearchParams({ date });
            if (activeProductId) params.set('product_id', activeProductId);
            if (activeTarget) params.set('target', activeTarget);
            const res2 = await fetch(`/api/lines/${lineId}/line-process-details?${params}`);
            const r2 = await res2.json();
            if (r2.success) {
                if (isSaveChangeover) {
                    _ldData.changeoverData = r2.data;
                } else {
                    _ldData.data = r2.data;
                }
                const content = document.getElementById('ld-overlay-content');
                if (content) renderLineDetailsContent(content, lineId, date, _ldData.data);
            }
        } else {
            showToast(result.error, 'error');
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
}



async function saveDailyPlan(lineId) {
    const date = document.getElementById('plan-date').value;
    const productId = document.getElementById(`plan-product-${lineId}`).value;
    const targetUnits = parseInt(document.getElementById(`plan-target-${lineId}`).value || '0', 10);
    const incomingProductId = document.getElementById(`plan-incoming-${lineId}`).value || null;
    const incomingTargetUnits = parseInt(document.getElementById(`plan-incoming-target-${lineId}`).value || '0', 10);
    if (!productId) {
        showToast('Select a product for the line', 'error');
        return;
    }
    if (incomingProductId && incomingProductId === productId) {
        showToast('Incoming product must be different from primary product', 'error');
        return;
    }
    const changeoverEnabled = window.changeoverEnabled !== false;
    const existing = window._dailyPlanMap?.get(String(lineId));

    try {
        if (!existing) {
            // No plan yet — create via POST
            const response = await fetch('/api/daily-plans', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    line_id: lineId,
                    product_id: productId,
                    work_date: date,
                    target_units: targetUnits,
                    incoming_product_id: changeoverEnabled ? incomingProductId : null,
                    incoming_target_units: changeoverEnabled ? incomingTargetUnits : 0
                })
            });
            const result = await response.json();
            if (!result.success) { showToast(result.error, 'error'); return; }
            if (result.cap_warning) showToast(`⚠ ${result.cap_warning}`, 'warning');
            else showToast(result.copied_from ? `Plan saved — layout copied from ${result.copied_from}` : 'Daily plan saved', 'success');
        } else {
            // Plan exists — only PATCH changed fields
            const changed = {};
            if (String(productId) !== String(existing.product_id)) changed.product_id = productId;
            if (targetUnits !== parseInt(existing.target_units || 0, 10)) changed.target_units = targetUnits;
            if (changeoverEnabled) {
                const newInc = incomingProductId || null;
                const oldInc = existing.incoming_product_id ? String(existing.incoming_product_id) : null;
                if (String(newInc) !== String(oldInc)) changed.incoming_product_id = newInc;
                if (incomingTargetUnits !== parseInt(existing.incoming_target_units || 0, 10)) changed.incoming_target_units = incomingTargetUnits;
            }
            if (!Object.keys(changed).length) {
                showToast('No changes detected', 'info');
                return;
            }
            const response = await fetch('/api/daily-plans', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ line_id: lineId, work_date: date, ...changed })
            });
            const result = await response.json();
            if (!result.success) { showToast(result.error, 'error'); return; }
            if (result.cap_warning) showToast(`⚠ ${result.cap_warning}`, 'warning');
            else showToast(`Updated: ${Object.keys(changed).join(', ').replace(/_/g, ' ')}`, 'success');
        }
        loadDailyPlanData();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function lockDailyPlan(lineId) {
    const date = document.getElementById('plan-date').value;
    try {
        const response = await fetch('/api/daily-plans/lock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ line_id: lineId, work_date: date })
        });
        const result = await response.json();
        if (!result.success) {
            showToast(result.error, 'error');
            return;
        }
        showToast('Plan locked', 'success');
        loadDailyPlanData();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function unlockDailyPlan(lineId) {
    const date = document.getElementById('plan-date').value;
    try {
        const response = await fetch('/api/daily-plans/unlock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ line_id: lineId, work_date: date })
        });
        const result = await response.json();
        if (!result.success) {
            showToast(result.error, 'error');
            return;
        }
        showToast('Plan unlocked', 'success');
        loadDailyPlanData();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function deleteDailyPlan(lineId) {
    const date = document.getElementById('plan-date').value;
    try {
        let result = await requestDailyPlanDelete(lineId, date);
        if (result?.requires_confirmation) {
            const confirmed = confirm('This is an ongoing plan. Are you sure you want to delete it permanently?');
            if (!confirmed) return;
            result = await requestDailyPlanDelete(lineId, date, true);
        }
        // 404 = plan was already gone — treat as success
        if (result?.http_status !== 404 && !result?.success) {
            showToast(result?.error || 'Delete failed', 'error');
            return;
        }
        if (window._dailyPlanMap?.delete) window._dailyPlanMap.delete(String(lineId));
        clearDailyPlanRow(lineId);
        await loadDailyPlanData();
        showToast('Daily plan deleted', 'success');
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function fetchDailyPlanSnapshot(date) {
    const response = await fetch(`/api/daily-plans?date=${encodeURIComponent(date)}&_=${Date.now()}`, {
        cache: 'no-store',
        credentials: 'include'
    });
    return response.json();
}

async function doesDailyPlanExist(lineId, date) {
    const result = await fetchDailyPlanSnapshot(date);
    if (!result?.success) return false;
    return (result.data?.plans || []).some(plan => String(plan.line_id) === String(lineId));
}

async function requestDailyPlanDelete(lineId, date, force = false) {
    const params = new URLSearchParams({ line_id: String(lineId), work_date: date });
    if (force) params.set('force', 'true');

    const response = await fetch(`/api/daily-plans?${params.toString()}`, {
        method: 'DELETE',
        credentials: 'include'
    });
    const raw = await response.text();
    try {
        const parsed = raw ? JSON.parse(raw) : {};
        return { ...parsed, http_status: response.status };
    } catch (parseErr) {
        throw new Error(`Delete request returned an unexpected response (HTTP ${response.status})`);
    }
}

function clearDailyPlanRow(lineId) {
    const productEl = document.getElementById(`plan-product-${lineId}`);
    const targetEl = document.getElementById(`plan-target-${lineId}`);
    const incomingEl = document.getElementById(`plan-incoming-${lineId}`);
    const incomingTargetEl = document.getElementById(`plan-incoming-target-${lineId}`);
    const wsRow = document.getElementById(`ws-plan-row-${lineId}`);
    const wsPanel = document.getElementById(`ws-plan-panel-${lineId}`);

    if (productEl) productEl.value = '';
    if (targetEl) targetEl.value = '0';
    if (incomingEl) incomingEl.value = '';
    if (incomingTargetEl) incomingTargetEl.value = '0';
    if (wsRow) wsRow.style.display = 'none';
    if (wsPanel) wsPanel.innerHTML = '';
}

function copyDailyPlan(lineId) {
    const targetDate = document.getElementById('plan-date').value;
    const _td = new Date(targetDate + 'T00:00:00');
    _td.setDate(_td.getDate() - 1);
    const yesterday = `${_td.getFullYear()}-${String(_td.getMonth()+1).padStart(2,'0')}-${String(_td.getDate()).padStart(2,'0')}`;

    const existing = document.getElementById('copy-plan-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'copy-plan-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:10001;display:flex;align-items:center;justify-content:center;';
    modal.innerHTML = `
        <div style="background:#fff;border-radius:12px;padding:28px;width:360px;box-shadow:0 8px 32px rgba(0,0,0,.18);">
            <h3 style="margin:0 0 6px;font-size:17px;font-weight:700;">Copy Plan to ${targetDate}</h3>
            <p style="margin:0 0 18px;font-size:13px;color:#6b7280;">Choose a source date to copy the workstation plan and employee assignments from.</p>
            <label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:6px;">Copy from date</label>
            <input type="date" id="copy-plan-source-date" value="${yesterday}"
                style="width:100%;padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;box-sizing:border-box;margin-bottom:18px;">
            <div id="copy-plan-error" style="display:none;background:#fee2e2;color:#991b1b;border-radius:6px;padding:8px 12px;font-size:13px;margin-bottom:14px;"></div>
            <div style="display:flex;gap:10px;justify-content:flex-end;">
                <button class="btn btn-secondary" onclick="document.getElementById('copy-plan-modal').remove()">Cancel</button>
                <button class="btn btn-primary" onclick="submitCopyDailyPlan(${lineId}, '${targetDate}')">Copy Plan</button>
            </div>
        </div>`;
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);
}

async function submitCopyDailyPlan(lineId, targetDate) {
    const sourceDate = document.getElementById('copy-plan-source-date').value;
    const errorDiv = document.getElementById('copy-plan-error');
    if (!sourceDate) { errorDiv.textContent = 'Please select a source date.'; errorDiv.style.display = 'block'; return; }
    try {
        const res = await fetch('/api/daily-plans/copy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ line_id: lineId, source_date: sourceDate, target_date: targetDate })
        });
        const result = await res.json();
        if (!result.success) { errorDiv.textContent = result.error; errorDiv.style.display = 'block'; return; }
        document.getElementById('copy-plan-modal').remove();
        showToast(`Plan copied from ${sourceDate} to ${targetDate}`, 'success');
        loadDailyPlanData();
    } catch (err) {
        errorDiv.textContent = err.message;
        errorDiv.style.display = 'block';
    }
}

// ============================================================================
// OT Toggle (Daily Plan)
// ============================================================================
async function toggleOTPlan(lineId, enable, date) {
    try {
        const res = await fetch('/api/daily-plans/ot-toggle', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ line_id: lineId, work_date: date, ot_enabled: enable })
        });
        const result = await res.json();
        if (!result.success) { showToast(result.error || 'Failed to update OT', 'error'); return; }
        showToast(enable ? 'OT enabled' : 'OT disabled', 'success');
        if (window._dpTab === 'ot') {
            const date = document.getElementById('plan-date')?.value || new Date().toISOString().slice(0, 10);
            loadOtPlanSection(date);
        } else {
            loadDailyPlanData();
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ============================================================================
// OT Plan Section (Daily Plans → OT Tab)
// ============================================================================

async function loadOtPlanSection(date) {
    const container = document.getElementById('daily-plan-table');
    if (!container) return;
    container.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';
    try {
        const res = await fetch(`/api/daily-plans?date=${date}`);
        const result = await res.json();
        if (!result.success) { container.innerHTML = `<div class="alert alert-danger">${result.error}</div>`; return; }
        const { plans, lines } = result.data;
        const planMap = new Map(plans.map(p => [String(p.line_id), p]));
        const renderedLines = isIeMode
            ? lines.filter(line => planMap.has(String(line.id)))
            : lines;
        if (!renderedLines.length) {
            container.innerHTML = `<div style="padding:24px;color:#6b7280;">${isIeMode ? 'No saved OT plans found for this date.' : 'No active lines found.'}</div>`;
            return;
        }

        container.innerHTML = renderedLines.map(line => {
            const plan = planMap.get(String(line.id));
            const hasPlan = !!plan?.id;
            const otEnabled = plan?.ot_enabled || false;
            return renderOtLineCard(line, plan, date, hasPlan, otEnabled);
        }).join('');

        // Auto-load expanded cards
        renderedLines.forEach(line => {
            const plan = planMap.get(String(line.id));
            if (plan?.ot_enabled) loadOtLineCard(line.id, date);
        });
    } catch (err) {
        container.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    }
}

function renderOtLineCard(line, plan, date, hasPlan, otEnabled) {
    const productLabel = plan ? `${plan.product_code || ''} ${plan.product_name || ''}`.trim() : '';
    const targetLabel  = plan ? `${plan.target_units || 0} units` : '';

    const leaderBadge = line.line_leader
        ? `<span style="color:#1d6f42;font-weight:600;font-size:13px;background:#f0fdf4;border:1px solid #86efac;border-radius:6px;padding:2px 10px;">${line.line_leader}</span>`
        : '';

    if (!hasPlan) {
        return `
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px 18px;margin-bottom:10px;opacity:0.55;display:flex;align-items:center;gap:12px;">
            <span style="font-weight:700;font-size:14px;color:#374151;">${line.line_code}</span>
            <span style="font-size:13px;color:#9ca3af;">${line.line_name}</span>
            ${leaderBadge}
            <span style="margin-left:auto;font-size:12px;color:#9ca3af;">No plan set for this date</span>
        </div>`;
    }

    if (!otEnabled) {
        return `
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:14px 18px;margin-bottom:10px;display:flex;align-items:center;gap:12px;">
            <span style="font-weight:700;font-size:14px;color:#1e293b;">${line.line_code}</span>
            <span style="font-size:13px;color:#374151;">${line.line_name}</span>
            ${leaderBadge}
            ${productLabel ? `<span style="font-size:12px;color:#6b7280;background:#f3f4f6;border-radius:10px;padding:2px 10px;">${productLabel} · ${targetLabel}</span>` : ''}
            <button onclick="toggleOTPlan(${line.id},true,'${date}')"
                style="margin-left:auto;padding:6px 16px;background:#7c3aed;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;">
                Enable OT ▶
            </button>
        </div>`;
    }

    // OT enabled — expanded card with lazy-loaded body
    return `
    <div style="background:#fff;border:2px solid #7c3aed;border-radius:10px;margin-bottom:12px;overflow:hidden;">
        <!-- Card header -->
        <div style="background:#f5f3ff;padding:12px 18px;display:flex;align-items:center;gap:12px;border-bottom:1px solid #ddd6fe;">
            <span style="font-weight:700;font-size:14px;color:#1e293b;">${line.line_code}</span>
            <span style="font-size:13px;color:#374151;">${line.line_name}</span>
            ${leaderBadge}
            ${productLabel ? `<span style="font-size:12px;color:#6b7280;background:#ede9fe;border-radius:10px;padding:2px 10px;">${productLabel}</span>` : ''}
            <span style="background:#7c3aed;color:#fff;border-radius:10px;padding:2px 10px;font-size:11px;font-weight:700;margin-left:4px;">● OT ON</span>
            <button onclick="toggleOTPlan(${line.id},false,'${date}')"
                style="margin-left:auto;padding:5px 14px;background:#fee2e2;color:#b91c1c;border:1px solid #fca5a5;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;">
                Disable OT ✕
            </button>
        </div>
        <!-- Card body — lazy loaded -->
        <div id="ot-card-body-${line.id}" style="padding:16px;">
            <div style="text-align:center;padding:24px;color:#6b7280;">Loading OT plan…</div>
        </div>
    </div>`;
}

async function loadOtLineCard(lineId, date) {
    const body = document.getElementById(`ot-card-body-${lineId}`);
    if (!body) return;
    try {
        const res = await fetch(`/api/lines/${lineId}/ot-plan?date=${date}`);
        const result = await res.json();
        if (!result.success) { body.innerHTML = `<div class="alert alert-danger">${result.error}</div>`; return; }
        if (!result.data) {
            body.innerHTML = '<div style="padding:12px;color:#6b7280;">No OT plan found. Try disabling and re-enabling OT.</div>';
            return;
        }
        window._otCardData = window._otCardData || {};
        window._otCardData[lineId] = result.data;
        fillOtLineCard(lineId, date, result.data);
    } catch (err) {
        body.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    }
}

function fillOtLineCard(lineId, date, data) {
    const body = document.getElementById(`ot-card-body-${lineId}`);
    if (!body) return;
    const { ot_plan, workstations, products, employees, all_ot_assignments } = data;
    const globalMins     = ot_plan.global_ot_minutes || 60;
    const otTarget       = ot_plan.ot_target_units   || 0;
    const perHourTarget  = data.per_hour_target        || 0;
    const supAuthorized  = ot_plan.supervisor_authorized === true;

    // Build factory-wide OT assignment map for this date (employee_id → {line_id, ws_code})
    if (!window._otEmpState) window._otEmpState = {};
    if (!window._otEmpState[date]) window._otEmpState[date] = {};
    // Seed from server data (don't overwrite in-session changes)
    (all_ot_assignments || []).forEach(a => {
        if (!window._otEmpState[date][String(a.employee_id)]) {
            window._otEmpState[date][String(a.employee_id)] = { line_id: a.line_id, ws_code: a.workstation_code };
        }
    });

    const effColor = p => p >= 90 ? '#16a34a' : p >= 80 ? '#d97706' : '#dc2626';
    const idPfx    = `otc-${lineId}`;

    const wsRows = workstations.map(ws => {
        const isActive = ws.is_active !== false;
        const efMins  = (ws.ot_minutes > 0 ? ws.ot_minutes : globalMins);
        const taktSec = (otTarget > 0 && efMins > 0) ? (efMins * 60) / otTarget : 0;
        const wl      = (taktSec > 0 && ws.actual_sam_seconds > 0)
            ? Math.round((parseFloat(ws.actual_sam_seconds) / taktSec) * 1000) / 10 : null;
        const wlCell  = wl != null
            ? `<span style="font-weight:700;color:${effColor(wl)};">${wl}%</span>`
            : '<span style="color:#9ca3af;">—</span>';
        const procs   = ws.processes.map(p => p.operation_code).join(' / ') || '—';
        const samDisp = ws.actual_sam_seconds ? (Math.round(parseFloat(ws.actual_sam_seconds) * 10) / 10) + 's' : '—';
        const emp     = ws.assigned_employee;
        const taken   = window._otEmpState?.[date] || {};
        const currentEmpLabel = emp ? `${emp.emp_code} — ${emp.emp_name}` : '— Not assigned —';
        const noneOpt = `<div class="ld-emp-option" data-emp-id="" data-emp-label="— Not assigned —"
            onclick="ldEmpPickerSelect(this,${lineId})" data-ot-line="${lineId}" data-ot-date="${date}" data-ot-ws="${ws.workstation_code}"
            style="padding:7px 10px;cursor:pointer;font-size:0.82em;color:#9ca3af;border-bottom:1px solid #f3f4f6;">— Not assigned —</div>`;
        const empOpts = noneOpt + employees.map(e => {
            const eStr = String(e.id);
            const isSel = emp && String(emp.employee_id || emp.id) === eStr;
            const takenEntry = taken[eStr];
            const isTaken = !isSel && takenEntry && takenEntry.ws_code !== ws.workstation_code;
            const lbl = `${e.emp_code} — ${e.emp_name}`;
            return `<div class="ld-emp-option${isTaken ? ' ld-emp-taken' : ''}"
                data-emp-id="${eStr}" data-emp-label="${lbl.replace(/"/g,'&quot;')}"
                data-ot-line="${lineId}" data-ot-date="${date}" data-ot-ws="${ws.workstation_code}"
                onclick="ldEmpPickerSelect(this,${lineId})"
                style="padding:7px 10px;cursor:${isTaken?'default':'pointer'};font-size:0.82em;
                       background:${isSel?'#eff6ff':''};font-weight:${isSel?'600':'400'};
                       color:${isTaken?'#9ca3af':''};display:flex;justify-content:space-between;align-items:center;">
                <span>${e.emp_code} — ${e.emp_name}</span>
                ${isTaken ? '<span style="color:#f87171;font-size:11px;margin-left:6px;">Taken ✗</span>' : ''}
            </div>`;
        }).join('');
        const empCell = `<div class="ld-emp-picker" data-ws="${ws.workstation_code}" data-value="${emp ? (emp.employee_id || emp.id) : ''}" data-ot-mode="1" style="position:relative;">
            <div class="ld-emp-display" onclick="ldEmpPickerToggle(this.parentElement,${lineId})"
                style="cursor:pointer;padding:5px 8px;border:1px solid #d1d5db;border-radius:6px;
                       font-size:0.82em;min-width:175px;background:#fff;display:flex;
                       justify-content:space-between;align-items:center;gap:4px;user-select:none;">
                <span class="ld-emp-current-label" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${currentEmpLabel}</span>
                <span style="color:#9ca3af;font-size:10px;flex-shrink:0;">▾</span>
            </div>
            <div class="ld-emp-dropdown" style="display:none;position:absolute;left:0;top:calc(100% + 3px);
                 z-index:600;background:#fff;border:1px solid #d1d5db;border-radius:8px;
                 box-shadow:0 6px 24px rgba(0,0,0,.15);min-width:260px;overflow:hidden;">
                <div style="padding:6px 6px 4px;border-bottom:1px solid #f3f4f6;">
                    <input class="ld-emp-search form-control" style="font-size:0.82em;padding:5px 8px;"
                        placeholder="🔍 Search by name or code..."
                        oninput="ldEmpPickerFilter(this)" onclick="event.stopPropagation()">
                </div>
                <div class="ld-emp-options" style="max-height:220px;overflow-y:auto;">${empOpts}</div>
            </div>
        </div>`;
        return `
        <tr style="${isActive ? '' : 'opacity:0.45;'}">
            <td style="font-weight:600;padding:8px 10px;">${ws.workstation_code}</td>
            <td style="color:#6b7280;font-size:12px;padding:8px 10px;">${ws.group_name || '—'}</td>
            <td style="font-size:12px;padding:8px 10px;max-width:260px;">${procs}</td>
            <td style="text-align:center;font-size:12px;padding:8px 10px;">${samDisp}</td>
            <td style="text-align:center;padding:6px 8px;">
                <select data-ws="${ws.workstation_code}" class="${idPfx}-ws-mins"
                    title="0 = use global (${globalMins} min)"
                    style="font-size:12px;border:1px solid #d1d5db;border-radius:4px;padding:3px 4px;">
                    <option value="0"   ${!ws.ot_minutes ? 'selected' : ''}>Global</option>
                    <option value="60"  ${ws.ot_minutes == 60  ? 'selected' : ''}>1h</option>
                    <option value="120" ${ws.ot_minutes == 120 ? 'selected' : ''}>2h</option>
                    <option value="180" ${ws.ot_minutes == 180 ? 'selected' : ''}>3h</option>
                    <option value="240" ${ws.ot_minutes == 240 ? 'selected' : ''}>4h</option>
                </select>
            </td>
            <td style="text-align:center;padding:8px 10px;">${wlCell}</td>
            <td style="text-align:center;padding:6px 8px;">
                <button id="${idPfx}-actbtn-${ws.workstation_code}"
                    data-ws-active="${isActive}"
                    onclick="toggleOtWsAdminBtn(${lineId},'${date}','${ws.workstation_code}',this)"
                    style="min-width:78px;padding:3px 10px;border-radius:5px;font-size:12px;font-weight:600;cursor:pointer;
                           background:${isActive ? '#dcfce7' : '#fee2e2'};
                           color:${isActive ? '#16a34a' : '#dc2626'};
                           border:1px solid ${isActive ? '#bbf7d0' : '#fecaca'};">
                    ${isActive ? '● Active' : '○ Inactive'}
                </button>
            </td>
            <td id="${idPfx}-emp-${ws.workstation_code}" style="padding:8px 10px;white-space:nowrap;">${empCell}</td>
        </tr>`;
    }).join('');

    const productOpts = products.map(p =>
        `<option value="${p.id}" ${p.id == ot_plan.product_id ? 'selected' : ''}>${p.product_code} — ${p.product_name}</option>`
    ).join('');

    body.innerHTML = `
        <!-- Settings row -->
        <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;margin-bottom:14px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px 16px;">
            <div>
                <label style="display:block;font-size:11px;font-weight:600;color:#6b7280;margin-bottom:3px;text-transform:uppercase;">OT Style</label>
                <select id="${idPfx}-product" style="font-size:13px;border:1px solid #d1d5db;border-radius:6px;padding:5px 8px;min-width:180px;">${productOpts}</select>
            </div>
            <div>
                <label style="display:block;font-size:11px;font-weight:600;color:#6b7280;margin-bottom:3px;text-transform:uppercase;">OT Duration</label>
                <select id="${idPfx}-hrs" onchange="calcOtTarget(${lineId})"
                    style="font-size:13px;border:1px solid #d1d5db;border-radius:6px;padding:5px 8px;">
                    <option value="60"  ${globalMins <= 60                     ? 'selected' : ''}>1 Hour</option>
                    <option value="120" ${globalMins > 60  && globalMins <= 120 ? 'selected' : ''}>2 Hours</option>
                    <option value="180" ${globalMins > 120 && globalMins <= 180 ? 'selected' : ''}>3 Hours</option>
                    <option value="240" ${globalMins > 180                      ? 'selected' : ''}>4 Hours</option>
                </select>
            </div>
            <div>
                <label style="display:block;font-size:11px;font-weight:600;color:#6b7280;margin-bottom:3px;text-transform:uppercase;">OT Target (units)</label>
                <div style="display:flex;align-items:center;gap:6px;padding:6px 0;">
                    <span id="${idPfx}-target-display" style="font-size:18px;font-weight:700;color:#1e1b4b;">${otTarget}</span>
                    <span style="font-size:11px;color:#9ca3af;">units</span>
                    <input type="hidden" id="${idPfx}-target" value="${otTarget}">
                </div>
                ${perHourTarget ? `<div style="font-size:10px;color:#9ca3af;">${perHourTarget.toFixed(1)} units/hr</div>` : ''}
            </div>
            <button onclick="saveOtCardSettings(${lineId},'${date}')"
                style="padding:6px 16px;background:#7c3aed;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;">
                Save Settings
            </button>
            <button id="${idPfx}-auth-btn" onclick="toggleOtSupervisorAuth(${lineId},'${date}',${supAuthorized})"
                style="padding:6px 16px;background:${supAuthorized ? '#dcfce7' : '#f1f5f9'};
                       color:${supAuthorized ? '#16a34a' : '#6b7280'};
                       border:1px solid ${supAuthorized ? '#bbf7d0' : '#d1d5db'};
                       border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;">
                ${supAuthorized ? '✓ Supervisor Authorized' : 'Authorize Supervisor'}
            </button>
        </div>
        <!-- Workstation table -->
        <div style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:12px;">
            <div style="background:#1e1b4b;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;">
                <span style="color:#fff;font-weight:700;font-size:13px;">OT Workstations</span>
                <span style="color:#a5b4fc;font-size:11px;">${workstations.length} workstations</span>
            </div>
            <div style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;font-size:13px;">
                    <thead>
                        <tr style="background:#f8fafc;border-bottom:2px solid #e5e7eb;">
                            <th style="padding:8px 10px;text-align:left;font-size:11px;color:#6b7280;">WS</th>
                            <th style="padding:8px 10px;font-size:11px;color:#6b7280;">Group</th>
                            <th style="padding:8px 10px;font-size:11px;color:#6b7280;">Processes</th>
                            <th style="padding:8px 10px;text-align:center;font-size:11px;color:#6b7280;">SAM</th>
                            <th style="padding:8px 10px;text-align:center;font-size:11px;color:#6b7280;">OT Min<br><span style="font-weight:400;font-size:10px;">(0=global)</span></th>
                            <th style="padding:8px 10px;text-align:center;font-size:11px;color:#6b7280;">Wkld%</th>
                            <th style="padding:8px 10px;text-align:center;font-size:11px;color:#6b7280;">Status</th>
                            <th style="padding:8px 10px;font-size:11px;color:#6b7280;">Employee</th>
                        </tr>
                    </thead>
                    <tbody>${wsRows || '<tr><td colspan="8" style="padding:16px;text-align:center;color:#9ca3af;">No workstations</td></tr>'}</tbody>
                </table>
            </div>
        </div>
        <!-- Footer actions -->
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button onclick="saveOtWsTimes(${lineId},'${date}')"
                style="padding:6px 16px;background:#059669;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;">
                Save WS Times
            </button>
            <button onclick="openOtLayoutEditor(${lineId},'${date}')"
                style="padding:6px 16px;background:#1e40af;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;">
                Edit Layout
            </button>
            <button onclick="resetOtFromRegular(${lineId},'${date}')"
                style="padding:6px 14px;background:#f1f5f9;color:#374151;border:1px solid #d1d5db;border-radius:6px;cursor:pointer;font-size:12px;">
                Reset from Regular Plan
            </button>
        </div>`;
}

async function saveOtCardSettings(lineId, date) {
    const pfx = `otc-${lineId}`;
    const productId  = document.getElementById(`${pfx}-product`)?.value;
    const globalMins = parseInt(document.getElementById(`${pfx}-hrs`)?.value, 10)    || 60;
    const otTarget   = parseInt(document.getElementById(`${pfx}-target`)?.value, 10) || 0;
    if (!productId) { showToast('Please select a product', 'error'); return; }
    try {
        const res = await fetch(`/api/lines/${lineId}/ot-plan`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date, product_id: productId, global_ot_minutes: globalMins, ot_target_units: otTarget })
        });
        const result = await res.json();
        if (!result.success) { showToast(result.error || 'Failed to save', 'error'); return; }
        showToast('OT settings saved', 'success');
        loadOtLineCard(lineId, date);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function calcOtTarget(lineId) {
    const pfx = `otc-${lineId}`;
    const hrsEl = document.getElementById(`${pfx}-hrs`);
    const hrs = parseInt(hrsEl?.value || 60, 10) / 60;
    const perHour = window._otCardData?.[lineId]?.per_hour_target || 0;
    const target = Math.round(perHour * hrs);
    const display = document.getElementById(`${pfx}-target-display`);
    const hidden  = document.getElementById(`${pfx}-target`);
    if (display) display.textContent = target;
    if (hidden)  hidden.value = target;
}

async function toggleOtSupervisorAuth(lineId, date, currentAuth) {
    const newAuth = !currentAuth;
    try {
        const res = await fetch(`/api/lines/${lineId}/ot-plan/supervisor-auth`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date, supervisor_authorized: newAuth })
        });
        const result = await res.json();
        if (!result.success) { showToast(result.error || 'Failed', 'error'); return; }
        showToast(newAuth ? 'Supervisor authorized for OT' : 'OT authorization revoked', 'success');
        const pfx = `otc-${lineId}`;
        const btn = document.getElementById(`${pfx}-auth-btn`);
        if (btn) {
            btn.style.background   = newAuth ? '#dcfce7' : '#f1f5f9';
            btn.style.color        = newAuth ? '#16a34a' : '#6b7280';
            btn.style.borderColor  = newAuth ? '#bbf7d0' : '#d1d5db';
            btn.textContent        = newAuth ? '✓ Supervisor Authorized' : 'Authorize Supervisor';
            btn.setAttribute('onclick', `toggleOtSupervisorAuth(${lineId},'${date}',${newAuth})`);
        }
        if (window._otCardData?.[lineId]?.ot_plan) {
            window._otCardData[lineId].ot_plan.supervisor_authorized = newAuth;
        }
    } catch (err) { showToast(err.message, 'error'); }
}

async function toggleOtWsAdminBtn(lineId, date, wsCode, btn) {
    const makeActive = btn.dataset.wsActive !== 'true';
    const pfx = `otc-${lineId}`;
    const minsInput = document.querySelector(`.${pfx}-ws-mins[data-ws="${wsCode}"]`);
    const ot_minutes = parseInt(minsInput?.value || 0, 10);
    try {
        const res = await fetch(`/api/lines/${lineId}/ot-plan/workstations`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date, workstations: [{ workstation_code: wsCode, is_active: makeActive, ot_minutes }] })
        });
        const result = await res.json();
        if (!result.success) { showToast(result.error || 'Failed', 'error'); return; }
    } catch (err) { showToast(err.message, 'error'); return; }

    // Update button
    btn.dataset.wsActive = makeActive ? 'true' : 'false';
    btn.style.background = makeActive ? '#dcfce7' : '#fee2e2';
    btn.style.color = makeActive ? '#16a34a' : '#dc2626';
    btn.style.borderColor = makeActive ? '#bbf7d0' : '#fecaca';
    btn.textContent = makeActive ? '● Active' : '○ Inactive';
    // Dim/undim the row
    const row = btn.closest('tr');
    if (row) row.style.opacity = makeActive ? '1' : '0.45';
    showToast(`${wsCode} ${makeActive ? 'activated' : 'deactivated'}`, 'success');
}

async function saveOtWsTimes(lineId, date) {
    const pfx = `otc-${lineId}`;
    const inputs = document.querySelectorAll(`.${pfx}-ws-mins`);
    if (!inputs.length) { showToast('No workstations to save', 'error'); return; }
    const workstations = Array.from(inputs).map(inp => {
        const wsCode = inp.dataset.ws;
        const activeBtn = document.getElementById(`${pfx}-actbtn-${wsCode}`);
        const is_active = activeBtn ? activeBtn.dataset.wsActive === 'true' : true;
        return { workstation_code: wsCode, is_active, ot_minutes: parseInt(inp.value, 10) || 0 };
    });
    try {
        const res = await fetch(`/api/lines/${lineId}/ot-plan/workstations`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date, workstations })
        });
        const result = await res.json();
        if (!result.success) { showToast(result.error || 'Failed to save', 'error'); return; }
        showToast('Workstation settings saved', 'success');
        loadOtLineCard(lineId, date);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function resetOtFromRegular(lineId, date) {
    // Re-enable OT (which copies the regular plan) by disabling + re-enabling
    try {
        const disRes = await fetch('/api/daily-plans/ot-toggle', {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ line_id: lineId, work_date: date, ot_enabled: false })
        });
        if (!(await disRes.json()).success) { showToast('Failed to reset OT', 'error'); return; }
        const enRes = await fetch('/api/daily-plans/ot-toggle', {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ line_id: lineId, work_date: date, ot_enabled: true })
        });
        const enResult = await enRes.json();
        if (!enResult.success) { showToast('Failed to reset OT', 'error'); return; }
        showToast('OT plan reset from regular plan', 'success');
        loadOtLineCard(lineId, date);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ── Employee picker for OT card ──────────────────────────────────────────────

function openOtEmpPicker(lineId, date, wsCode, btn) {
    // Close any existing picker
    document.querySelectorAll('.ot-emp-picker').forEach(el => el.remove());

    const data      = window._otCardData?.[lineId];
    const employees = data?.employees || [];
    const taken     = window._otEmpState?.[date] || {};

    const picker = document.createElement('div');
    picker.className = 'ot-emp-picker';
    picker.style.cssText = 'position:absolute;z-index:2000;background:#fff;border:1px solid #d1d5db;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.15);padding:10px;max-height:260px;overflow-y:auto;min-width:200px;';

    picker.innerHTML = `
        <div style="font-size:11px;font-weight:600;color:#6b7280;margin-bottom:6px;text-transform:uppercase;">Select Employee</div>
        <div style="display:flex;flex-wrap:wrap;gap:5px;">
            ${employees.map(e => {
                const takenEntry = taken[String(e.id)];
                const isTaken    = takenEntry && takenEntry.ws_code !== wsCode;
                return `<button
                    onclick="${isTaken ? '' : `assignOtEmployee(${lineId},'${date}','${wsCode}',${e.id},'${e.emp_code}')`}"
                    style="padding:4px 10px;border-radius:16px;font-size:12px;font-weight:600;cursor:${isTaken ? 'not-allowed' : 'pointer'};
                           background:${isTaken ? '#f3f4f6' : '#ede9fe'};color:${isTaken ? '#9ca3af' : '#5b21b6'};
                           border:1px solid ${isTaken ? '#e5e7eb' : '#c4b5fd'};opacity:${isTaken ? '0.6' : '1'};"
                    title="${isTaken ? 'Already assigned to OT' : e.emp_name}">
                    ${e.emp_code}
                </button>`;
            }).join('')}
        </div>`;

    // Position below the button
    document.body.appendChild(picker);
    const rect = btn.getBoundingClientRect();
    picker.style.top  = (rect.bottom + window.scrollY + 4) + 'px';
    picker.style.left = (rect.left + window.scrollX) + 'px';

    // Close on outside click
    setTimeout(() => {
        document.addEventListener('click', function closePicker(e) {
            if (!picker.contains(e.target) && e.target !== btn) {
                picker.remove();
                document.removeEventListener('click', closePicker);
            }
        });
    }, 0);
}

async function assignOtEmployee(lineId, date, wsCode, empId, empCode) {
    document.querySelectorAll('.ot-emp-picker').forEach(el => el.remove());
    try {
        const res = await fetch(`/api/lines/${lineId}/ot-plan/employee`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date, workstation_code: wsCode, employee_id: empId })
        });
        const result = await res.json();
        if (!result.success) { showToast(result.error || 'Failed to assign', 'error'); return; }

        // Update in-session state
        if (!window._otEmpState[date]) window._otEmpState[date] = {};
        window._otEmpState[date][String(empId)] = { line_id: lineId, ws_code: wsCode };

        // Update the ld-emp-picker display inline
        const pfx  = `otc-${lineId}`;
        const cell = document.getElementById(`${pfx}-emp-${wsCode}`);
        if (cell) {
            const picker = cell.querySelector('.ld-emp-picker');
            if (picker) {
                picker.dataset.value = String(empId || '');
                const lbl = picker.querySelector('.ld-emp-current-label');
                if (lbl) lbl.textContent = empCode ? `${empCode}` : '— Not assigned —';
            }
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function clearOtEmployee(lineId, date, wsCode) {
    try {
        const res = await fetch(`/api/lines/${lineId}/ot-plan/employee`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date, workstation_code: wsCode, employee_id: null })
        });
        const result = await res.json();
        if (!result.success) { showToast(result.error || 'Failed to clear', 'error'); return; }

        // Remove from in-session state
        if (window._otEmpState?.[date]) {
            Object.keys(window._otEmpState[date]).forEach(empId => {
                if (window._otEmpState[date][empId]?.ws_code === wsCode &&
                    String(window._otEmpState[date][empId]?.line_id) === String(lineId)) {
                    delete window._otEmpState[date][empId];
                }
            });
        }
        // Reset the ld-emp-picker display to unassigned
        const pfx  = `otc-${lineId}`;
        const cell = document.getElementById(`${pfx}-emp-${wsCode}`);
        if (cell) {
            const picker = cell.querySelector('.ld-emp-picker');
            if (picker) {
                picker.dataset.value = '';
                const lbl = picker.querySelector('.ld-emp-current-label');
                if (lbl) lbl.textContent = '— Not assigned —';
            }
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ── OT Layout Editor ──────────────────────────────────────────────────────────

function openOtLayoutEditor(lineId, date) {
    const existing = document.getElementById('ot-layout-modal');
    if (existing) existing.remove();

    const data = window._otCardData?.[lineId];
    if (!data) { showToast('OT plan data not loaded', 'error'); return; }

    const { workstations, all_processes, ot_plan } = data;
    // Build a map: process_id → {workstation_code, group_name}
    const procToWs = {};
    (workstations || []).forEach(ws => {
        (ws.processes || []).forEach(p => {
            procToWs[p.process_id] = { ws_code: ws.workstation_code, group: ws.group_name || '' };
        });
    });

    const rows = (all_processes || []).map(p => {
        const assigned = procToWs[p.id] || { ws_code: '', group: '' };
        const samDisp  = p.operation_sah ? (Math.round(parseFloat(p.operation_sah) * 36000) / 10) + 's' : '—';
        return `<tr>
            <td style="padding:6px 8px;font-size:12px;color:#6b7280;">${p.sequence_number}</td>
            <td style="padding:6px 8px;font-size:12px;font-weight:600;">${p.operation_code}</td>
            <td style="padding:6px 8px;font-size:12px;">${p.operation_name}</td>
            <td style="padding:6px 8px;font-size:12px;text-align:center;">${samDisp}</td>
            <td style="padding:6px 8px;">
                <input type="text" data-ppid="${p.id}" data-field="ws"
                    value="${assigned.ws_code}" placeholder="e.g. WS01"
                    style="width:70px;font-size:12px;border:1px solid #d1d5db;border-radius:4px;padding:3px 6px;text-transform:uppercase;">
            </td>
            <td style="padding:6px 8px;">
                <input type="text" data-ppid="${p.id}" data-field="grp"
                    value="${assigned.group}" placeholder="e.g. G1"
                    style="width:60px;font-size:12px;border:1px solid #d1d5db;border-radius:4px;padding:3px 6px;">
            </td>
        </tr>`;
    }).join('');

    const overlay = document.createElement('div');
    overlay.id = 'ot-layout-modal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:3500;display:flex;align-items:flex-start;justify-content:center;padding-top:40px;';
    overlay.innerHTML = `
        <div style="background:#fff;border-radius:12px;width:min(820px,95vw);max-height:85vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
            <div style="padding:16px 20px;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;gap:10px;">
                <span style="font-size:16px;font-weight:700;color:#1e1b4b;">Edit OT Layout</span>
                <span style="font-size:12px;color:#6b7280;">Assign each process to a workstation (leave WS blank to exclude)</span>
                <button onclick="document.getElementById('ot-layout-modal').remove()"
                    style="margin-left:auto;background:none;border:none;font-size:18px;cursor:pointer;color:#6b7280;">✕</button>
            </div>
            <div style="overflow-y:auto;flex:1;">
                <table style="width:100%;border-collapse:collapse;">
                    <thead style="position:sticky;top:0;background:#f8fafc;z-index:1;">
                        <tr>
                            <th style="padding:8px;font-size:11px;color:#6b7280;text-align:left;border-bottom:2px solid #e5e7eb;">SEQ</th>
                            <th style="padding:8px;font-size:11px;color:#6b7280;text-align:left;border-bottom:2px solid #e5e7eb;">CODE</th>
                            <th style="padding:8px;font-size:11px;color:#6b7280;text-align:left;border-bottom:2px solid #e5e7eb;">NAME</th>
                            <th style="padding:8px;font-size:11px;color:#6b7280;text-align:center;border-bottom:2px solid #e5e7eb;">SAM</th>
                            <th style="padding:8px;font-size:11px;color:#6b7280;border-bottom:2px solid #e5e7eb;">WS</th>
                            <th style="padding:8px;font-size:11px;color:#6b7280;border-bottom:2px solid #e5e7eb;">Group</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
            <div style="padding:14px 20px;border-top:1px solid #e5e7eb;display:flex;justify-content:flex-end;gap:8px;">
                <button onclick="document.getElementById('ot-layout-modal').remove()"
                    style="padding:7px 18px;background:#f1f5f9;color:#374151;border:1px solid #d1d5db;border-radius:6px;cursor:pointer;font-size:13px;">
                    Cancel
                </button>
                <button onclick="saveOtLayout(${lineId},'${date}')"
                    style="padding:7px 20px;background:#1e40af;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;">
                    Save Layout
                </button>
            </div>
        </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

async function saveOtLayout(lineId, date) {
    const modal = document.getElementById('ot-layout-modal');
    if (!modal) return;

    // Collect inputs: build map wsCode → {group, ppIds[]}
    const wsMap = {};
    modal.querySelectorAll('[data-ppid]').forEach(input => {
        const ppId  = input.dataset.ppid;
        const field = input.dataset.field;
        const val   = input.value.trim().toUpperCase();
        if (!ppId) return;
        if (!wsMap[ppId]) wsMap[ppId] = { ws: '', grp: '' };
        wsMap[ppId][field] = val;
    });

    // Group by WS code (skip blank WS)
    const grouped = {};
    Object.entries(wsMap).forEach(([ppId, { ws, grp }]) => {
        if (!ws) return;
        if (!grouped[ws]) grouped[ws] = { group: grp, ppIds: [] };
        grouped[ws].ppIds.push(parseInt(ppId, 10));
    });

    const wsCodes = Object.keys(grouped).sort();
    if (!wsCodes.length) { showToast('Assign at least one process to a workstation', 'error'); return; }

    const workstations = wsCodes.map((code, i) => ({
        workstation_code:   code,
        workstation_number: i + 1,
        group_name:         grouped[code].group || null,
        ot_minutes:         0,
        processes:          grouped[code].ppIds
    }));

    try {
        const res = await fetch(`/api/lines/${lineId}/ot-plan/layout`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date, workstations })
        });
        const result = await res.json();
        if (!result.success) { showToast(result.error || 'Failed to save layout', 'error'); return; }
        modal.remove();
        showToast('OT layout saved', 'success');
        loadOtLineCard(lineId, date);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ============================================================================
// Production Day Lock (Admin)
// ============================================================================
async function loadProductionDays() {
    const content = document.getElementById('main-content');
    const today = new Date().toISOString().slice(0, 10);
    content.innerHTML = `
        <div class="page-header">
            <div>
                <h1 class="page-title">Production Day Lock</h1>
                <p class="page-subtitle">Lock or unlock daily execution</p>
            </div>
        </div>
        <div class="card">
            <div class="card-body">
                <div class="ie-settings">
                    <div>
                        <label class="form-label">Date</label>
                        <input type="date" class="form-control" id="lock-date" value="${today}">
                    </div>
                    <div>
                        <label class="form-label">Status</label>
                        <div class="status-badge" id="lock-status">Checking...</div>
                    </div>
                    <div class="ie-settings-action">
                        <button class="btn btn-danger" id="lock-btn">Lock</button>
                        <button class="btn btn-secondary" id="unlock-btn">Unlock</button>
                    </div>
                </div>
            </div>
        </div>
        <div class="card">
            <div class="card-header">
                <h3 class="card-title">Closed Shifts (Per Line)</h3>
            </div>
            <div class="card-body table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Line</th>
                            <th>Closed At</th>
                            <th>Notes</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody id="line-shift-body">
                        <tr><td colspan="4">Loading...</td></tr>
                    </tbody>
                </table>
            </div>
        </div>
    `;
    document.getElementById('lock-date').addEventListener('change', refreshLockStatus);
    document.getElementById('lock-btn').addEventListener('click', () => updateLock(true));
    document.getElementById('unlock-btn').addEventListener('click', () => updateLock(false));
    refreshLockStatus();
    loadLineShiftClosures();
}

async function refreshLockStatus() {
    const date = document.getElementById('lock-date').value;
    const status = document.getElementById('lock-status');
    try {
        const response = await fetch(`/api/production-days/status?date=${date}`);
        const result = await response.json();
        if (result.success && result.data) {
            status.textContent = 'Locked';
            status.style.background = '#fee2e2';
            status.style.color = '#b91c1c';
        } else {
            status.textContent = 'Open';
            status.style.background = '#dcfce7';
            status.style.color = '#15803d';
        }
    } catch (err) {
        status.textContent = 'Unknown';
    }
    loadLineShiftClosures();
}

async function updateLock(isLock) {
    const date = document.getElementById('lock-date').value;
    try {
        const response = await fetch(`/api/production-days/${isLock ? 'lock' : 'unlock'}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ work_date: date })
        });
        const result = await response.json();
        if (!result.success) {
            showToast(result.error, 'error');
            return;
        }
        showToast(isLock ? 'Day locked' : 'Day unlocked', 'success');
        refreshLockStatus();
        loadLineShiftClosures();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function loadLineShiftClosures() {
    const date = document.getElementById('lock-date').value;
    const body = document.getElementById('line-shift-body');
    try {
        const response = await fetch(`/api/line-shifts?date=${date}`);
        const result = await response.json();
        if (!result.success) {
            body.innerHTML = `<tr><td colspan="4">${result.error}</td></tr>`;
            return;
        }
        const rows = result.data || [];
        if (!rows.length) {
            body.innerHTML = '<tr><td colspan="4">No closed shifts</td></tr>';
            return;
        }
        body.innerHTML = rows.map(row => `
            <tr>
                <td><strong>${row.line_name}</strong><div style="color: var(--secondary); font-size: 12px;">${row.line_code}</div></td>
                <td>${new Date(row.closed_at).toLocaleString()}</td>
                <td>${row.notes || '-'}</td>
                <td>
                    <button class="btn btn-secondary btn-sm" onclick="unlockLineShift(${row.line_id})">Unlock</button>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        body.innerHTML = `<tr><td colspan="4">${err.message}</td></tr>`;
    }
}

async function unlockLineShift(lineId) {
    const date = document.getElementById('lock-date').value;
    try {
        const response = await fetch('/api/line-shifts/unlock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ line_id: lineId, work_date: date })
        });
        const result = await response.json();
        if (!result.success) {
            showToast(result.error, 'error');
            return;
        }
        showToast('Shift unlocked', 'success');
        loadLineShiftClosures();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ============================================================================
// Users (Admin)
// ============================================================================
async function loadUsers() {
    const content = document.getElementById('main-content');
    content.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';
    try {
        const response = await fetch('/api/users');
        const result = await response.json();
        if (!result.success) {
            content.innerHTML = `<div class="alert alert-danger">${result.error}</div>`;
            return;
        }
        const users = result.data;
        content.innerHTML = `
            <div class="page-header">
                <div>
                    <h1 class="page-title">Users</h1>
                    <p class="page-subtitle">Manage system access</p>
                </div>
                <button class="btn btn-primary" onclick="showUserModal()">Add User</button>
            </div>
            <div class="card">
                <div class="card-body table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Username</th>
                                <th>Name</th>
                                <th>Role</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${users.map(user => `
                                <tr>
                                    <td><strong>${user.username}</strong></td>
                                    <td>${user.full_name}</td>
                                    <td>${user.role}</td>
                                    <td>${user.is_active ? 'Active' : 'Inactive'}</td>
                                    <td>
                                        <div class="action-btns">
                                            <button class="btn btn-secondary btn-sm" onclick='showUserModal(${JSON.stringify(user)})'>Edit</button>
                                            <button class="btn btn-danger btn-sm" onclick="deactivateUser(${user.id})">Deactivate</button>
                                        </div>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    } catch (err) {
        content.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    }
}

function showUserModal(user = null) {
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.id = 'user-modal';
    modal.innerHTML = `
        <div class="modal">
            <div class="modal-header">
                <h3 class="modal-title">${user ? 'Edit User' : 'Add User'}</h3>
                <button class="modal-close" onclick="closeModal('user-modal')">
                    <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                    </svg>
                </button>
            </div>
            <div class="modal-body">
                <form id="user-form">
                    <div class="form-group">
                        <label class="form-label">Username</label>
                        <input type="text" class="form-control" name="username" value="${user?.username || ''}" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Full Name</label>
                        <input type="text" class="form-control" name="full_name" value="${user?.full_name || ''}" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Role</label>
                        <select class="form-control" name="role">
                            ${['admin', 'ie', 'supervisor'].map(role => `
                                <option value="${role}" ${user?.role === role ? 'selected' : ''}>${role.toUpperCase()}</option>
                            `).join('')}
                        </select>
                    </div>
                </form>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="closeModal('user-modal')">Cancel</button>
                <button class="btn btn-primary" onclick="saveUser(${user?.id || 'null'})">${user ? 'Update' : 'Save'}</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    setTimeout(() => modal.classList.add('active'), 10);
}

async function saveUser(id) {
    const form = document.getElementById('user-form');
    const formData = new FormData(form);
    const data = Object.fromEntries(formData);
    const url = id ? `/api/users/${id}` : '/api/users';
    const method = id ? 'PUT' : 'POST';
    try {
        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await response.json();
        if (!result.success) {
            showToast(result.error, 'error');
            return;
        }
        showToast('User saved', 'success');
        closeModal('user-modal');
        loadUsers();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function deactivateUser(id) {
    if (!confirm('Deactivate this user?')) return;
    try {
        const response = await fetch(`/api/users/${id}`, { method: 'DELETE' });
        const result = await response.json();
        if (!result.success) {
            showToast(result.error, 'error');
            return;
        }
        showToast('User deactivated', 'success');
        loadUsers();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ============================================================================
// Audit Logs (Admin)
// ============================================================================
async function loadAuditLogs() {
    const content = document.getElementById('main-content');
    content.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';
    try {
        const response = await fetch('/api/audit-logs?limit=200');
        const result = await response.json();
        if (!result.success) {
            content.innerHTML = `<div class="alert alert-danger">${result.error}</div>`;
            return;
        }
        const logs = result.data;
        content.innerHTML = `
            <div class="page-header">
                <div>
                    <h1 class="page-title">Audit Logs</h1>
                    <p class="page-subtitle">Recent changes across the system</p>
                </div>
            </div>
            <div class="card">
                <div class="card-body table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Time</th>
                                <th>Table</th>
                                <th>Record</th>
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${logs.map(log => `
                                <tr>
                                    <td>${new Date(log.changed_at).toLocaleString()}</td>
                                    <td>${log.table_name}</td>
                                    <td>${log.record_id}</td>
                                    <td>${log.action}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    } catch (err) {
        content.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    }
}

// ============================================================================
// DAILY PLAN PRINT / EXCEL EXPORT
// ============================================================================

// Global per-line print config: { [lineId]: { start, end, lunchMins, otMins, otTarget, productId, wsOt:{[ws]:mins}, wsLoaded } }
window._dpPrintConfig = {};

async function openDailyPlanPrintModal() {
    if (document.getElementById('dp-print-modal')) document.getElementById('dp-print-modal').remove();
    const modal = document.createElement('div');
    modal.id = 'dp-print-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:2000;display:flex;align-items:center;justify-content:center;';
    const planDate = document.getElementById('plan-date')?.value || new Date().toISOString().slice(0, 10);
    modal.innerHTML = `
        <div style="background:#fff;border-radius:12px;padding:22px 24px 18px;width:700px;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,0.22);">
            <h3 style="margin:0 0 14px;font-size:17px;font-weight:700;color:#111827;">Print / Export Daily Plan</h3>
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap;">
                <label style="font-size:12px;font-weight:600;color:#374151;">Date</label>
                <input type="date" id="dp-print-date" value="${planDate}"
                    style="font-size:13px;border:1px solid #d1d5db;border-radius:6px;padding:5px 10px;">
                <button onclick="dpLoadPrintPreview()"
                    style="padding:6px 14px;background:#f3f4f6;color:#374151;border:1px solid #d1d5db;border-radius:6px;font-size:12px;cursor:pointer;">
                    Preview
                </button>
            </div>
            <div id="dp-print-preview" style="flex:1;overflow-y:auto;min-height:120px;border:1px solid #e5e7eb;border-radius:8px;padding:10px;">
                <div style="text-align:center;padding:24px;color:#6b7280;font-size:13px;">Loading preview\u2026</div>
            </div>
            <div id="dp-print-status" style="min-height:18px;margin-top:10px;font-size:12px;color:#6b7280;"></div>
            <div style="display:flex;gap:8px;justify-content:flex-end;border-top:1px solid #e5e7eb;padding-top:14px;margin-top:6px;">
                <button onclick="document.getElementById('dp-print-modal').remove()"
                    style="padding:8px 16px;background:#f3f4f6;color:#374151;border:none;border-radius:6px;font-size:13px;cursor:pointer;">Cancel</button>
                <button onclick="downloadDailyPlansExcel()"
                    style="padding:8px 16px;background:#1d6f42;color:#fff;border:none;border-radius:6px;font-weight:600;font-size:13px;cursor:pointer;">&#8595; Excel</button>
                <button onclick="printDailyPlans()"
                    style="padding:8px 16px;background:#1e40af;color:#fff;border:none;border-radius:6px;font-weight:600;font-size:13px;cursor:pointer;">&#9113; Print</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    const dateInput = document.getElementById('dp-print-date');
    if (dateInput) {
        dateInput.addEventListener('change', () => dpLoadPrintPreview());
    }
    dpLoadPrintPreview();
}

function dpToggleSelectAll(checked) {
    document.querySelectorAll('[id^="dp-sel-"]:not(#dp-sel-all)').forEach(cb => { cb.checked = checked; });
}

async function dpLoadPrintPreview() {
    const date = document.getElementById('dp-print-date')?.value;
    const previewEl = document.getElementById('dp-print-preview');
    const statusEl = document.getElementById('dp-print-status');
    if (!date || !previewEl) return;
    previewEl.innerHTML = '<div style="text-align:center;padding:24px;color:#6b7280;font-size:13px;">Loading preview\u2026</div>';
    if (statusEl) statusEl.textContent = '';
    try {
        const [dpResp, phResp] = await Promise.all([
            fetch(`/api/daily-plans?date=${date}`),
            fetch(`/api/plan-history?date=${date}`)
        ]);
        const dpResult = await dpResp.json();
        const phResult = await phResp.json();
        if (!dpResult.success) throw new Error(dpResult.error);
        if (!phResult.success) throw new Error(phResult.error);

        const plans = dpResult.data?.plans || [];
        const planMap = new Map(plans.map(p => [String(p.line_id), p]));
        const lines = phResult.lines || [];

        window._dpPrintConfig = {};
        plans.forEach(plan => {
            window._dpPrintConfig[plan.line_id] = {
                start:     '08:00',
                end:       '17:00',
                lunchMins: 60,
                otMins:    parseInt(plan.overtime_minutes || 0, 10),
                otTarget:  parseInt(plan.overtime_target  || 0, 10),
                productId: plan.product_id,
                wsOt:      {},
                wsLoaded:  false,
            };
        });

        if (!lines.length) {
            previewEl.innerHTML = '<div style="color:#6b7280;font-size:13px;padding:8px 0;">No workstation plans found for this date.</div>';
            return;
        }

        const lineBlocks = lines.map(line => {
            const plan = planMap.get(String(line.line_id));
            const productLabel = line.product_code ? `${line.product_code} \u2014 ${line.product_name}` : 'Deleted / Not Available';
            const targetUnits = plan?.target_units ?? line.target_units ?? 0;
            const wsRows = (line.workstations || []).map(ws => {
                const procList = (ws.processes || []).map(p =>
                    `${p.operation_code || ''} ${p.operation_name || ''}`.trim()
                ).filter(Boolean).join('<br>');
                const emp = ws.employee ? `${ws.employee.emp_code} \u2014 ${ws.employee.emp_name}` : '\u2014';
                return `
                    <tr>
                        <td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;font-weight:600;">${ws.workstation_code || '\u2014'}</td>
                        <td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;">${ws.group_name || '\u2014'}</td>
                        <td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;">
                            <div style="max-height:180px;overflow:auto;font-size:11px;line-height:1.4;">${procList || '\u2014'}</div>
                        </td>
                        <td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;">${emp}</td>
                    </tr>`;
            }).join('');

            return `
                <div style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;margin-bottom:12px;">
                    <div style="background:#f8fafc;padding:10px 12px;display:flex;flex-wrap:wrap;gap:12px;align-items:center;">
                        <div style="font-weight:700;">${line.line_code} ${line.line_name ? '— ' + line.line_name : ''}</div>
                        <div style="color:#6b7280;font-size:12px;">${productLabel}</div>
                        <div style="margin-left:auto;font-size:12px;color:#374151;">
                            Target: <strong>${targetUnits}</strong> &nbsp;|&nbsp;
                            Workstations: <strong>${line.workstation_count ?? 0}</strong> &nbsp;|&nbsp;
                            Processes: <strong>${line.process_count ?? 0}</strong>
                        </div>
                    </div>
                    <div style="overflow-x:auto;">
                        <table style="width:100%;border-collapse:collapse;font-size:12px;">
                            <thead>
                                <tr style="background:#fff;border-bottom:1px solid #e5e7eb;">
                                    <th style="text-align:left;padding:6px 8px;">WS</th>
                                    <th style="text-align:left;padding:6px 8px;">Group</th>
                                    <th style="text-align:left;padding:6px 8px;">Processes</th>
                                    <th style="text-align:left;padding:6px 8px;">Employee</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${wsRows || `<tr><td colspan="4" style="padding:8px;color:#6b7280;">No workstations</td></tr>`}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        }).join('');

        previewEl.innerHTML = lineBlocks;
        if (statusEl) statusEl.textContent = `${lines.length} line plans found for ${date}.`;
    } catch (err) {
        previewEl.innerHTML = `<div style="color:#dc2626;font-size:13px;">\u26a0 ${err.message}</div>`;
    }
}

function _renderDpPrintConfig(activeLines, planMap) {
    const hasAnyOT = activeLines.some(l => (planMap.get(String(l.id))?.overtime_minutes || 0) > 0);
    const totalCols = 5 + (hasAnyOT ? 2 : 0); // checkbox + line + start + end + lunch [+ ot + ws-ot-btn]
    const cont = document.getElementById('dp-print-lines-config');
    cont.innerHTML = `
        <div style="font-size:12px;color:#374151;font-weight:600;margin-bottom:8px;">Select lines and set working hours</div>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
                <tr style="background:#f3f4f6;font-size:11px;">
                    <th style="padding:7px 8px;text-align:center;border-bottom:1px solid #e5e7eb;width:32px;">
                        <input type="checkbox" id="dp-sel-all" checked title="Select / Deselect all" onchange="dpToggleSelectAll(this.checked)">
                    </th>
                    <th style="padding:7px 8px;text-align:left;border-bottom:1px solid #e5e7eb;">Line</th>
                    <th style="padding:7px 8px;text-align:center;border-bottom:1px solid #e5e7eb;">Start</th>
                    <th style="padding:7px 8px;text-align:center;border-bottom:1px solid #e5e7eb;">End</th>
                    <th style="padding:7px 8px;text-align:center;border-bottom:1px solid #e5e7eb;">Lunch (min)</th>
                    ${hasAnyOT ? '<th style="padding:7px 8px;text-align:center;border-bottom:1px solid #e5e7eb;color:#7c3aed;">OT (mins)</th><th style="padding:7px 8px;border-bottom:1px solid #e5e7eb;"></th>' : ''}
                </tr>
            </thead>
            <tbody>
                ${activeLines.map(line => {
                    const plan  = planMap.get(String(line.id));
                    const hasOT = (plan?.overtime_minutes || 0) > 0;
                    const cfg   = window._dpPrintConfig[line.id];
                    return `
                        <tr style="border-bottom:1px solid #f3f4f6;" id="dp-line-row-${line.id}">
                            <td style="padding:5px 8px;text-align:center;">
                                <input type="checkbox" id="dp-sel-${line.id}" checked
                                    style="width:15px;height:15px;cursor:pointer;accent-color:#1e40af;">
                            </td>
                            <td style="padding:7px 8px;">
                                <div style="font-weight:600;font-size:12px;">${plan.line_code}</div>
                                ${plan.line_name ? `<div style="font-size:10px;color:#6b7280;">${plan.line_name}</div>` : ''}
                            </td>
                            <td style="padding:5px 6px;text-align:center;">
                                <input type="time" value="08:00"
                                    onchange="window._dpPrintConfig[${line.id}].start=this.value"
                                    style="padding:3px 5px;border:1px solid #d1d5db;border-radius:5px;font-size:12px;width:88px;">
                            </td>
                            <td style="padding:5px 6px;text-align:center;">
                                <input type="time" value="17:00"
                                    onchange="window._dpPrintConfig[${line.id}].end=this.value"
                                    style="padding:3px 5px;border:1px solid #d1d5db;border-radius:5px;font-size:12px;width:88px;">
                            </td>
                            <td style="padding:5px 6px;text-align:center;">
                                <input type="number" value="60" min="0" max="120"
                                    onchange="window._dpPrintConfig[${line.id}].lunchMins=parseInt(this.value)||0"
                                    style="padding:3px 5px;border:1px solid #d1d5db;border-radius:5px;font-size:12px;width:60px;text-align:center;">
                            </td>
                            ${hasAnyOT ? `
                            <td style="padding:5px 6px;text-align:center;">
                                ${hasOT
                                    ? `<input type="number" value="${cfg.otMins}" min="0" max="600"
                                           onchange="window._dpPrintConfig[${line.id}].otMins=parseInt(this.value)||0"
                                           style="padding:3px 5px;border:1px solid #c4b5fd;border-radius:5px;font-size:12px;width:60px;text-align:center;background:#faf5ff;">
                                       <div style="font-size:10px;color:#7c3aed;margin-top:1px;">+${parseInt(plan.overtime_target)||0} units</div>`
                                    : '<span style="color:#9ca3af;font-size:12px;">\u2014</span>'}
                            </td>
                            <td style="padding:5px 6px;text-align:center;">
                                ${hasOT
                                    ? `<button onclick="dpToggleWsOt(${line.id})" id="dp-ws-ot-btn-${line.id}"
                                           style="font-size:10px;padding:3px 7px;border:1px solid #c4b5fd;border-radius:4px;background:#faf5ff;color:#6d28d9;cursor:pointer;white-space:nowrap;">WS OT \u25be</button>`
                                    : ''}
                            </td>` : ''}
                        </tr>
                        ${hasOT ? `
                        <tr id="dp-ws-ot-row-${line.id}" style="display:none;background:#faf5ff;">
                            <td colspan="${hasAnyOT ? 7 : 5}" style="padding:0 14px 10px 24px;">
                                <div id="dp-ws-ot-content-${line.id}" style="font-size:11px;color:#7c3aed;padding-top:6px;">
                                    Click "WS OT" to load workstation OT overrides\u2026
                                </div>
                            </td>
                        </tr>` : ''}
                    `;
                }).join('')}
            </tbody>
        </table>`;
}

async function dpToggleWsOt(lineId) {
    const row = document.getElementById(`dp-ws-ot-row-${lineId}`);
    const btn = document.getElementById(`dp-ws-ot-btn-${lineId}`);
    if (!row) return;
    const open = row.style.display !== 'none';
    row.style.display = open ? 'none' : '';
    btn.textContent = open ? 'WS OT \u25be' : 'WS OT \u25b4';
    if (open || window._dpPrintConfig[lineId]?.wsLoaded) return;

    const cfg     = window._dpPrintConfig[lineId];
    const date    = document.getElementById('plan-date').value;
    const content = document.getElementById(`dp-ws-ot-content-${lineId}`);
    content.textContent = 'Loading\u2026';
    try {
        const params = new URLSearchParams({ date, product_id: cfg.productId });
        const rj = await fetch(`/api/lines/${lineId}/line-process-details?${params}`).then(r => r.json());
        if (!rj.success) throw new Error(rj.error);
        const wsList = [...new Set((rj.data.processes || []).map(p => (p.workstation_code || '').trim()).filter(Boolean))];
        wsList.forEach(ws => { if (!(ws in cfg.wsOt)) cfg.wsOt[ws] = cfg.otMins; });
        cfg.wsLoaded = true;
        if (!wsList.length) { content.textContent = 'No workstations found.'; return; }
        content.innerHTML = `
            <div style="font-weight:600;margin-bottom:6px;">OT Minutes per Workstation <span style="font-weight:400;color:#9ca3af;">(default: ${cfg.otMins} min)</span></div>
            <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px 10px;">
                ${wsList.map(ws => `
                    <div style="display:flex;align-items:center;gap:4px;">
                        <span style="font-weight:700;min-width:38px;font-size:11px;">${ws}</span>
                        <input type="number" value="${cfg.wsOt[ws]}" min="0" max="600"
                            onchange="window._dpPrintConfig[${lineId}].wsOt['${ws}']=parseInt(this.value)||0"
                            style="width:52px;padding:2px 4px;border:1px solid #c4b5fd;border-radius:4px;font-size:11px;">
                    </div>`).join('')}
            </div>`;
    } catch (err) {
        content.innerHTML = `<span style="color:#dc2626;">\u26a0 ${err.message}</span>`;
    }
}

async function printDailyPlans() {
    const date     = document.getElementById('dp-print-date')?.value || document.getElementById('plan-date')?.value;
    const statusEl = document.getElementById('dp-print-status');
    const config   = window._dpPrintConfig || {};
    if (!Object.keys(config).length) { statusEl.textContent = 'Open this modal from the daily plans page first.'; return; }
    const selectedIds = Object.keys(config);
    if (!selectedIds.length) { statusEl.textContent = 'No plans found for this date.'; return; }
    statusEl.textContent = 'Fetching workstation data\u2026';

    const fmtTakt  = s => s > 0 ? `${Math.floor(s / 60)}m ${(s % 60).toFixed(1)}s` : '\u2014';
    const effColor = e => e == null ? '#9ca3af' : e >= 90 ? '#16a34a' : e >= 80 ? '#d97706' : '#dc2626';
    const effStr   = e => e == null ? '<span style="color:#9ca3af;">N/A</span>' : `${e.toFixed(1)}%`;
    const WS_COLORS = ['#EFF6FF','#FFF7ED','#F0FDF4','#FDF4FF','#FFFBEB','#F0F9FF','#FFF1F2','#F5F3FF','#ECFDF5','#FEF9C3'];

    try {
        const lineDataList = await Promise.all(selectedIds.map(async lineId => {
            const cfg    = config[lineId];
            const params = new URLSearchParams({ date, product_id: cfg.productId });
            const rj     = await fetch(`/api/lines/${lineId}/line-process-details?${params}`).then(r => r.json());
            return { lineId, cfg, data: rj.success ? rj.data : null };
        }));

        const validLines = lineDataList.filter(ld => ld.data?.processes?.length > 0);
        if (!validLines.length) { statusEl.textContent = 'No workstation plans found for any line.'; return; }

        const pagesHtml = validLines.map((ld, ldIdx) => {
            const { lineId, cfg, data } = ld;
            const [sh, sm] = cfg.start.split(':').map(Number);
            const [eh, em] = cfg.end.split(':').map(Number);
            const workSecs  = ((eh * 60 + em) - (sh * 60 + sm) - cfg.lunchMins) * 60;
            const target    = data.target_units || 0;
            const regTakt   = target > 0 ? workSecs / target : 0;
            const otTarget  = cfg.otTarget || 0;
            const hasLineOT = cfg.otMins > 0 && otTarget > 0;
            const line      = data.line;
            const product   = data.product;

            // Build workstation groups + efficiency
            const groups   = [];
            const wsIdxMap = new Map();
            (data.processes || []).forEach(p => {
                const ws  = (p.workstation_code || '').trim();
                const hasWs = !!ws && ws !== '-';
                const key = hasWs ? ws : `__u_${p.id}`;
                if (!wsIdxMap.has(key)) {
                    wsIdxMap.set(key, groups.length);
                    groups.push({ ws, processes: [], sam: 0, group_name: '', emp_name: '', emp_code: '', has_ws: hasWs });
                }
                const g = groups[wsIdxMap.get(key)];
                g.processes.push(p);
                g.sam += parseFloat(p.operation_sah || 0) * 3600;
                if (!g.group_name && p.group_name) g.group_name = p.group_name;
                if (!g.emp_name && p.emp_name) {
                    g.emp_name = p.emp_name;
                    g.emp_code = p.emp_code || '';
                }
                if (hasWs) g.has_ws = true;
            });
            groups.forEach(g => {
                g.reg_eff = (regTakt > 0 && g.has_ws) ? (g.sam / regTakt) * 100 : null;
                // Per-workstation OT: use WS override if set, else line OT
                const wsOtMins = hasLineOT ? ((g.ws && cfg.wsOt[g.ws] != null) ? cfg.wsOt[g.ws] : cfg.otMins) : 0;
                const otSecs   = wsOtMins * 60;
                const otTakt   = (otSecs > 0 && otTarget > 0) ? otSecs / otTarget : 0;
                g.ot_eff    = (hasLineOT && wsOtMins > 0 && otTakt > 0 && g.has_ws) ? (g.sam / otTakt) * 100 : null;
                g.total_eff = (g.reg_eff != null && g.ot_eff != null)
                    ? (g.sam * (target + otTarget)) / (workSecs + otSecs) * 100
                    : null;
            });

            const rows = groups.map((g, gi) => g.processes.map((p, pi) => {
                const isFirst = pi === 0;
                const rs  = g.processes.length > 1 ? ` rowspan="${g.processes.length}"` : '';
                const bg  = `background:${WS_COLORS[gi % WS_COLORS.length]};`;
                return `<tr>
                    ${isFirst ? `<td${rs} class="ws-cell" style="${bg}font-weight:700;">${g.ws || '\u2014'}</td>` : ''}
                    ${isFirst ? `<td${rs} style="${bg}">${g.group_name || '\u2014'}</td>` : ''}
                    <td style="${bg}text-align:center;">${p.sequence_number}</td>
                    <td style="${bg}color:#6b7280;font-size:8px;">${p.operation_code || ''}</td>
                    <td style="${bg}">${p.operation_name || ''}</td>
                    <td style="${bg}text-align:right;">${parseFloat(p.operation_sah || 0).toFixed(4)}</td>
                    ${isFirst ? `<td${rs} style="${bg}text-align:right;font-weight:700;">${g.sam.toFixed(1)}s</td>` : ''}
                    ${isFirst ? `<td${rs} style="${bg}text-align:center;font-weight:700;color:${effColor(g.reg_eff)};">${effStr(g.reg_eff)}</td>` : ''}
                    ${isFirst ? `<td${rs} style="${bg}">${g.emp_name || '\u2014'}${g.emp_code ? '<br><small style="color:#6b7280;">' + g.emp_code + '</small>' : ''}</td>` : ''}
                </tr>`;
            }).join('')).join('');

            const isLast = ldIdx === validLines.length - 1;
            const otInfo = hasLineOT ? ` &nbsp;|&nbsp; OT: ${cfg.otMins}m / +${otTarget} units` : '';
            return `<div class="line-page" style="${isLast ? '' : 'page-break-after:always;'}">
                <div class="lp-header">
                    <div class="lp-title">LINE DAILY PLAN</div>
                    <div class="lp-meta">
                        <div><b>Line:</b> ${line.line_code}${line.line_name ? ' \u2014 ' + line.line_name : ''}</div>
                        <div><b>Date:</b> ${date}</div>
                        <div><b>Product:</b> ${product.product_code} \u2014 ${product.product_name}</div>
                        <div><b>Target:</b> ${target} units</div>
                        <div><b>Working:</b> ${cfg.start} \u2013 ${cfg.end} (lunch ${cfg.lunchMins}min)</div>
                        <div><b>Takt:</b> ${fmtTakt(regTakt)}${otInfo}</div>
                    </div>
                </div>
                <table>
                    <thead><tr>
                        <th>WS</th><th>Group</th><th>Seq</th><th>Op. Code</th>
                        <th>Operation Name</th><th>SAH</th><th>Cycle (s)</th>
                        <th>Workload%</th><th>Employee</th>
                    </tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>`;
        }).join('');

        statusEl.textContent = '';
        const win = window.open('', '_blank');
        win.document.write(`<!DOCTYPE html><html><head><title>Daily Plan \u2014 ${date}</title><style>
            *{box-sizing:border-box;margin:0;padding:0;}
            body{font-family:Arial,sans-serif;font-size:10px;color:#111;}
            .line-page{padding:8mm;}
            .lp-header{margin-bottom:10px;}
            .lp-title{font-size:15px;font-weight:700;color:#1e40af;border-bottom:2px solid #1e40af;padding-bottom:4px;margin-bottom:8px;}
            .lp-meta{display:grid;grid-template-columns:repeat(3,1fr);gap:3px 16px;font-size:10px;}
            .lp-meta div{padding:1px 0;}
            table{width:100%;border-collapse:collapse;font-size:9px;}
            th{background:#1e3a5f;color:#fff;padding:5px 4px;text-align:center;border:1px solid #999;}
            td{padding:3px 4px;border:1px solid #ccc;vertical-align:middle;}
            td.ws-cell{text-align:center;}
            @media print{@page{size:A4 landscape;margin:8mm;}.line-page{padding:0;}}
        </style></head><body>${pagesHtml}<script>window.onload=()=>window.print();<\/script></body></html>`);
        win.document.close();
    } catch (err) {
        statusEl.textContent = '\u26a0 ' + err.message;
    }
}

async function downloadDailyPlansExcel() {
    const date     = document.getElementById('dp-print-date')?.value || document.getElementById('plan-date')?.value;
    const statusEl = document.getElementById('dp-print-status');
    const config   = window._dpPrintConfig || {};
    if (!Object.keys(config).length) { statusEl.textContent = 'Open this modal from the daily plans page first.'; return; }
    statusEl.textContent = 'Generating Excel\u2026';
    try {
        const resp = await fetch('/api/daily-plans/export-excel', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ date, lineConfigs: config }),
        });
        if (!resp.ok) {
            const j = await resp.json().catch(() => ({}));
            throw new Error(j.error || `Server error ${resp.status}`);
        }
        const blob = await resp.blob();
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = `daily_plan_${date}.xlsx`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
        statusEl.textContent = '';
    } catch (err) {
        statusEl.textContent = '\u26a0 ' + err.message;
    }
}

// ============================================================================
// OT PLAN DETAILS (Line Details Overlay — OT Tab)
// ============================================================================
function switchLdTab(tab, lineId) {
    if (!_ldData) return;
    _ldData.otTab = (tab === 'ot');
    const content = document.getElementById('ld-overlay-content');
    if (!content) return;
    // Update tab button styles
    const tabRegular = document.getElementById('ld-tab-regular');
    const tabOT = document.getElementById('ld-tab-ot');
    if (tabRegular) {
        tabRegular.style.background = tab === 'regular' ? '#3b82f6' : '#fff';
        tabRegular.style.color = tab === 'regular' ? '#fff' : '#374151';
        tabRegular.style.borderColor = tab === 'regular' ? '#3b82f6' : '#d1d5db';
    }
    if (tabOT) {
        tabOT.style.background = tab === 'ot' ? '#7c3aed' : '#fff';
        tabOT.style.color = tab === 'ot' ? '#fff' : '#374151';
        tabOT.style.borderColor = tab === 'ot' ? '#7c3aed' : '#d1d5db';
    }
    if (tab === 'ot') {
        loadOTPlanDetails(content, lineId, _ldData.date);
    } else {
        renderLineDetailsContent(content, lineId, _ldData.date, _ldData.data);
    }
}

async function loadOTPlanDetails(panel, lineId, date) {
    panel.innerHTML = '<div style="text-align:center;padding:40px;color:#6b7280;">Loading OT Plan...</div>';
    try {
        const res = await fetch(`/api/lines/${lineId}/ot-plan?date=${date}`);
        const result = await res.json();
        if (!result.success) throw new Error(result.error);
        if (!result.data) {
            panel.innerHTML = '<div style="padding:24px;color:#6b7280;">No OT plan found. Try disabling and re-enabling OT.</div>';
            return;
        }
        renderOTPlanDetails(panel, lineId, date, result.data);
    } catch (err) {
        panel.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    }
}

function renderOTPlanDetails(panel, lineId, date, data) {
    const { ot_plan, workstations, products, employees } = data;
    const globalMins = ot_plan.global_ot_minutes || 60;
    const otTarget = ot_plan.ot_target_units || 0;

    // Build employee map for quick lookup
    const empMap = new Map(employees.map(e => [e.id, e]));

    // Helper: effective ot_minutes for a workstation
    const effectiveMins = (ws) => (ws.ot_minutes && ws.ot_minutes > 0) ? ws.ot_minutes : globalMins;

    // Helper: workload color
    const effColor = e => e >= 90 ? '#16a34a' : e >= 80 ? '#d97706' : '#dc2626';

    // Build workstation rows
    const wsRows = workstations.map(ws => {
        const efMins = effectiveMins(ws);
        const taktSecs = (otTarget > 0 && efMins > 0) ? (efMins * 60) / otTarget : 0;
        const wl = (taktSecs > 0 && ws.actual_sam_seconds > 0)
            ? Math.round((ws.actual_sam_seconds / taktSecs) * 1000) / 10 : null;
        const wlCell = ws.is_active && wl != null
            ? `<span style="font-weight:700;color:${effColor(wl)};">${wl}%</span>`
            : `<span style="color:#9ca3af;">—</span>`;
        const procNames = ws.processes.map(p => p.operation_name).join(' / ') || '—';
        const samDisplay = ws.actual_sam_seconds ? Math.round(ws.actual_sam_seconds * 10) / 10 + 's' : '—';
        const assignedEmp = ws.assigned_employee;
        const empOptions = employees.map(e =>
            `<option value="${e.id}" ${assignedEmp && assignedEmp.employee_id === e.id ? 'selected' : ''}>${e.emp_code} - ${e.emp_name}</option>`
        ).join('');
        return `
            <tr style="${ws.is_active ? '' : 'opacity:0.45;'}">
                <td style="text-align:center;">
                    <input type="checkbox" ${ws.is_active ? 'checked' : ''}
                        onchange="otToggleWs(this, '${ws.workstation_code}')">
                </td>
                <td style="font-weight:600;">${ws.workstation_code}</td>
                <td style="color:#6b7280;font-size:12px;">${ws.group_name || '—'}</td>
                <td style="font-size:12px;max-width:220px;">${procNames}</td>
                <td style="text-align:center;font-size:13px;">${samDisplay}</td>
                <td style="text-align:center;">
                    <input type="number" min="0" max="480" value="${ws.ot_minutes}"
                        style="width:60px;text-align:center;border:1px solid #d1d5db;border-radius:4px;padding:2px 4px;font-size:12px;"
                        placeholder="0=global"
                        onchange="otUpdateWsMins(this, '${ws.workstation_code}')"
                        title="0 = use global OT duration">
                </td>
                <td>
                    <select style="font-size:12px;border:1px solid #d1d5db;border-radius:4px;padding:2px 4px;max-width:170px;"
                        onchange="otUpdateWsEmployee(${lineId}, '${date}', '${ws.workstation_code}', this.value)">
                        <option value="">— No employee —</option>
                        ${empOptions}
                    </select>
                </td>
                <td style="text-align:center;">${wlCell}</td>
            </tr>
        `;
    }).join('');

    panel.innerHTML = `
        <div style="max-width:1200px;margin:0 auto;">
            <!-- Settings bar -->
            <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:16px 20px;margin-bottom:18px;display:flex;flex-wrap:wrap;gap:14px;align-items:flex-end;">
                <div>
                    <label style="display:block;font-size:11px;font-weight:600;color:#6b7280;margin-bottom:3px;text-transform:uppercase;">OT Style</label>
                    <select id="ot-product-sel" style="font-size:13px;border:1px solid #d1d5db;border-radius:6px;padding:5px 8px;min-width:200px;">
                        ${products.map(p => `<option value="${p.id}" ${p.id == ot_plan.product_id ? 'selected' : ''}>${p.product_code} — ${p.product_name}</option>`).join('')}
                    </select>
                </div>
                <div>
                    <label style="display:block;font-size:11px;font-weight:600;color:#6b7280;margin-bottom:3px;text-transform:uppercase;">Global OT Minutes</label>
                    <input type="number" id="ot-global-mins" min="0" max="480" value="${globalMins}"
                        style="font-size:13px;border:1px solid #d1d5db;border-radius:6px;padding:5px 8px;width:90px;">
                </div>
                <div>
                    <label style="display:block;font-size:11px;font-weight:600;color:#6b7280;margin-bottom:3px;text-transform:uppercase;">OT Target (units)</label>
                    <input type="number" id="ot-target-units" min="0" value="${otTarget}"
                        style="font-size:13px;border:1px solid #d1d5db;border-radius:6px;padding:5px 8px;width:90px;">
                </div>
                <div style="display:flex;gap:8px;align-items:flex-end;">
                    <button onclick="saveOTPlanSettings(${lineId}, '${date}')"
                        style="padding:6px 16px;background:#7c3aed;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;">
                        Save Settings
                    </button>
                    <button onclick="regenOTPlanFromRegular(${lineId}, '${date}')"
                        style="padding:6px 14px;background:#f1f5f9;color:#374151;border:1px solid #d1d5db;border-radius:6px;cursor:pointer;font-size:12px;">
                        Reset from Regular Plan
                    </button>
                </div>
            </div>

            <!-- Workstation table -->
            <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
                <div style="background:#1e1b4b;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;">
                    <span style="color:#fff;font-weight:700;font-size:14px;">OT Workstations</span>
                    <span style="color:#a5b4fc;font-size:12px;">${workstations.filter(w => w.is_active).length} of ${workstations.length} active</span>
                </div>
                <div style="overflow-x:auto;">
                    <table style="width:100%;border-collapse:collapse;font-size:13px;">
                        <thead>
                            <tr style="background:#f8fafc;border-bottom:2px solid #e5e7eb;">
                                <th style="padding:10px 8px;text-align:center;font-size:11px;color:#6b7280;width:50px;">Active</th>
                                <th style="padding:10px 8px;font-size:11px;color:#6b7280;">WS</th>
                                <th style="padding:10px 8px;font-size:11px;color:#6b7280;">Group</th>
                                <th style="padding:10px 8px;font-size:11px;color:#6b7280;">Processes</th>
                                <th style="padding:10px 8px;text-align:center;font-size:11px;color:#6b7280;">SAM (s)</th>
                                <th style="padding:10px 8px;text-align:center;font-size:11px;color:#6b7280;">OT Min<br><span style="font-weight:400;">(0=global)</span></th>
                                <th style="padding:10px 8px;font-size:11px;color:#6b7280;">Employee</th>
                                <th style="padding:10px 8px;text-align:center;font-size:11px;color:#6b7280;">Workload%</th>
                            </tr>
                        </thead>
                        <tbody id="ot-ws-tbody">
                            ${wsRows}
                        </tbody>
                    </table>
                </div>
                <div style="padding:12px 16px;border-top:1px solid #e5e7eb;display:flex;justify-content:flex-end;">
                    <button onclick="saveOTPlanWorkstations(${lineId}, '${date}')"
                        style="padding:8px 20px;background:#7c3aed;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;">
                        Save OT Plan
                    </button>
                </div>
            </div>
        </div>
    `;

    // Store WS state locally for edits before save
    window._otWsState = {};
    workstations.forEach(ws => {
        window._otWsState[ws.workstation_code] = { is_active: ws.is_active, ot_minutes: ws.ot_minutes };
    });
}

function otToggleWs(checkbox, wsCode) {
    if (!window._otWsState) window._otWsState = {};
    if (!window._otWsState[wsCode]) window._otWsState[wsCode] = { is_active: true, ot_minutes: 0 };
    window._otWsState[wsCode].is_active = checkbox.checked;
    const row = checkbox.closest('tr');
    if (row) row.style.opacity = checkbox.checked ? '1' : '0.45';
}

function otUpdateWsMins(input, wsCode) {
    if (!window._otWsState) window._otWsState = {};
    if (!window._otWsState[wsCode]) window._otWsState[wsCode] = { is_active: true, ot_minutes: 0 };
    window._otWsState[wsCode].ot_minutes = parseInt(input.value, 10) || 0;
}

async function otUpdateWsEmployee(lineId, date, wsCode, employeeId) {
    try {
        const res = await fetch(`/api/lines/${lineId}/ot-plan/employee`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date, workstation_code: wsCode, employee_id: employeeId || null })
        });
        const result = await res.json();
        if (!result.success) showToast(result.error || 'Failed to update employee', 'error');
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function saveOTPlanSettings(lineId, date) {
    const productId = document.getElementById('ot-product-sel')?.value;
    const globalMins = parseInt(document.getElementById('ot-global-mins')?.value, 10) || 60;
    const otTarget = parseInt(document.getElementById('ot-target-units')?.value, 10) || 0;
    if (!productId) { showToast('Please select a product', 'error'); return; }
    try {
        const res = await fetch(`/api/lines/${lineId}/ot-plan`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date, product_id: productId, global_ot_minutes: globalMins, ot_target_units: otTarget })
        });
        const result = await res.json();
        if (!result.success) { showToast(result.error || 'Failed to save OT settings', 'error'); return; }
        showToast('OT settings saved', 'success');
        // Reload OT details to reflect any regenerated workstations
        const content = document.getElementById('ld-overlay-content');
        if (content) loadOTPlanDetails(content, lineId, date);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function regenOTPlanFromRegular(lineId, date) {
    const productSel = document.getElementById('ot-product-sel');
    const primaryProductId = _ldData?.data?.product?.id;
    if (productSel && primaryProductId) productSel.value = primaryProductId;
    await saveOTPlanSettings(lineId, date);
}

async function saveOTPlanWorkstations(lineId, date) {
    const state = window._otWsState || {};
    const workstations = Object.entries(state).map(([workstation_code, s]) => ({
        workstation_code,
        is_active: s.is_active,
        ot_minutes: s.ot_minutes
    }));
    try {
        const res = await fetch(`/api/lines/${lineId}/ot-plan/workstations`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date, workstations })
        });
        const result = await res.json();
        if (!result.success) { showToast(result.error || 'Failed to save', 'error'); return; }
        showToast('OT plan saved', 'success');
        // Reload to recalculate workload%
        const content = document.getElementById('ld-overlay-content');
        if (content) loadOTPlanDetails(content, lineId, date);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ============================================================================
// PLAN HISTORY — view any past date's line setup and copy to any line
// ============================================================================
async function loadPlanHistory() {
    const content = document.getElementById('main-content');
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    let lineOptions = '<option value=\"\">All Lines</option>';
    try {
        const res = await fetch(`${API_BASE}/lines?include_inactive=true`);
        const data = await res.json();
        const lines = data.data || [];
        lineOptions += lines.map(line =>
            `<option value="${line.id}">${line.line_code} — ${line.line_name}</option>`
        ).join('');
    } catch (_) {
        // Keep the filter usable even if line-list loading fails.
    }
    content.innerHTML = `
        <div style="padding:24px;max-width:1400px;margin:0 auto;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:10px;">
                <h2 style="margin:0;font-size:1.3rem;font-weight:700;color:#1e293b;">Plan History</h2>
                <div style="display:flex;align-items:center;gap:10px;">
                    <label style="font-size:13px;color:#6b7280;font-weight:600;">Line:</label>
                    <select id="ph-line"
                        style="min-width:220px;font-size:13px;border:1px solid #d1d5db;border-radius:6px;padding:5px 10px;">
                        ${lineOptions}
                    </select>
                    <label style="font-size:13px;color:#6b7280;font-weight:600;">Date:</label>
                    <input type="date" id="ph-date" value="${yesterday}" max="${yesterday}"
                        style="font-size:13px;border:1px solid #d1d5db;border-radius:6px;padding:5px 10px;">
                    <button onclick="refreshPlanHistory()"
                        style="padding:6px 18px;background:#1e40af;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;">
                        Load
                    </button>
                </div>
            </div>
            <div id="ph-content">
                <div style="text-align:center;padding:40px;color:#9ca3af;">Select a date and click Load to view past plans.</div>
            </div>
        </div>
    `;
    document.getElementById('ph-date').addEventListener('keydown', e => { if (e.key === 'Enter') refreshPlanHistory(); });
}

async function refreshPlanHistory() {
    const date = document.getElementById('ph-date')?.value;
    const lineId = document.getElementById('ph-line')?.value || '';
    if (!date) return;
    const container = document.getElementById('ph-content');
    if (!container) return;
    container.innerHTML = '<div style="text-align:center;padding:40px;color:#6b7280;">Loading...</div>';
    try {
        const params = new URLSearchParams({ date });
        if (lineId) params.set('line_id', lineId);
        const res = await fetch(`/api/plan-history?${params.toString()}`);
        const data = await res.json();
        if (!data.success) throw new Error(data.error);
        if (!data.lines.length) {
            container.innerHTML = `<div style="text-align:center;padding:40px;color:#9ca3af;">No workstation plans found for the selected line/date.</div>`;
            return;
        }
        container.innerHTML = renderPlanHistoryCards(data.lines, date);
    } catch (err) {
        container.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    }
}

function renderPlanHistoryCards(lines, date) {
    const effColor = p => p >= 90 ? '#16a34a' : p >= 80 ? '#d97706' : '#dc2626';

    return lines.map(line => {
        const rows = line.workstations.map(ws => {
            const wl = ws.workload_pct != null ? Math.round(ws.workload_pct * 10) / 10 : null;
            const wlCell = wl != null
                ? `<span style="font-weight:700;color:${effColor(wl)};">${wl}%</span>`
                : '<span style="color:#9ca3af;">—</span>';
            const procText = ws.processes.map(p => `${p.operation_code} ${p.operation_name}`).join(' / ') || '—';
            const empText = ws.employee ? `<span style="font-size:12px;">${ws.employee.emp_code}<br><span style="color:#6b7280;">${ws.employee.emp_name}</span></span>` : '<span style="color:#9ca3af;">—</span>';
            const samText = ws.actual_sam_seconds ? `${Math.round(ws.actual_sam_seconds * 10) / 10}s` : '—';
            return `
                <tr style="border-bottom:1px solid #f1f5f9;">
                    <td style="padding:7px 10px;font-weight:600;white-space:nowrap;">${ws.workstation_code}</td>
                    <td style="padding:7px 10px;color:#6b7280;font-size:12px;">${ws.group_name || '—'}</td>
                    <td style="padding:7px 10px;font-size:12px;max-width:260px;">${procText}</td>
                    <td style="padding:7px 10px;text-align:center;font-size:12px;">${samText}</td>
                    <td style="padding:7px 10px;text-align:center;">${wlCell}</td>
                    <td style="padding:7px 10px;">${empText}</td>
                </tr>
            `;
        }).join('');

        const lockBadge = line.is_locked
            ? '<span style="background:#fee2e2;color:#b91c1c;padding:2px 7px;border-radius:4px;font-size:11px;font-weight:600;">Locked</span>'
            : '';

        return `
            <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;margin-bottom:20px;overflow:hidden;">
                <!-- Card header -->
                <div style="background:#1e293b;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
                    <div>
                        <span style="color:#fff;font-weight:700;font-size:14px;">${line.line_code}</span>
                        <span style="color:#94a3b8;font-size:13px;margin-left:8px;">${line.line_name}</span>
                        ${lockBadge ? `<span style="margin-left:8px;">${lockBadge}</span>` : ''}
                    </div>
                    <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap;">
                        <span style="color:#93c5fd;font-size:12px;">
                            <span style="color:#64748b;">Product:</span>
                            <strong style="color:#e2e8f0;">${line.product_code ? `${line.product_code} — ${line.product_name}` : 'Deleted / Not Available'}</strong>
                        </span>
                        <span style="color:#93c5fd;font-size:12px;">
                            <span style="color:#64748b;">Target:</span>
                            <strong style="color:#e2e8f0;">${line.target_units} units</strong>
                        </span>
                        <span style="color:#64748b;font-size:12px;">${line.workstation_count} WS &middot; ${line.process_count} processes</span>
                    </div>
                </div>
                <!-- Workstation table -->
                <div style="overflow-x:auto;">
                    <table style="width:100%;border-collapse:collapse;font-size:13px;">
                        <thead>
                            <tr style="background:#f8fafc;border-bottom:2px solid #e5e7eb;">
                                <th style="padding:8px 10px;text-align:left;font-size:11px;color:#6b7280;font-weight:600;">WS</th>
                                <th style="padding:8px 10px;text-align:left;font-size:11px;color:#6b7280;font-weight:600;">Group</th>
                                <th style="padding:8px 10px;text-align:left;font-size:11px;color:#6b7280;font-weight:600;">Processes</th>
                                <th style="padding:8px 10px;text-align:center;font-size:11px;color:#6b7280;font-weight:600;">SAM (s)</th>
                                <th style="padding:8px 10px;text-align:center;font-size:11px;color:#6b7280;font-weight:600;">Workload%</th>
                                <th style="padding:8px 10px;text-align:left;font-size:11px;color:#6b7280;font-weight:600;">Employee</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
                <!-- Card footer -->
                <div style="padding:10px 16px;border-top:1px solid #e5e7eb;background:#f9fafb;display:flex;justify-content:flex-end;">
                    <button onclick="${line.product_id ? `openCopyPlanModal(${line.line_id},'${date}',${line.product_id},'${(line.product_code ? `${line.product_code} ${line.product_name}` : 'Deleted / Not Available').replace(/'/g,"\\'")}','${line.line_code} — ${line.line_name.replace(/'/g,"\\'")}')` : ''}"
                        ${line.product_id ? '' : 'disabled'}
                        style="padding:6px 16px;background:${line.product_id ? '#1e40af' : '#94a3b8'};color:#fff;border:none;border-radius:6px;cursor:${line.product_id ? 'pointer' : 'not-allowed'};font-size:13px;font-weight:600;">
                        Replicate Plan →
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function openCopyPlanModal(fromLineId, fromDate, fromProductId, fromProductLabel, fromLineLabel) {
    const existing = document.getElementById('copy-plan-modal');
    if (existing) existing.remove();

    const today = new Date().toISOString().slice(0, 10);

    // Fetch all active lines to populate the target dropdown
    fetch('/api/lines')
        .then(r => r.json())
        .then(data => {
            const lines = (data.data || data.lines || []);
            const lineOptions = lines.map(l =>
                `<option value="${l.id}" ${String(l.id) === String(fromLineId) ? 'selected' : ''}>${l.line_code} — ${l.line_name}</option>`
            ).join('');

            const overlay = document.createElement('div');
            overlay.id = 'copy-plan-modal';
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:3000;display:flex;align-items:center;justify-content:center;';
            overlay.innerHTML = `
                <div style="background:#fff;border-radius:12px;padding:28px;width:440px;max-width:95vw;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
                    <h3 style="margin:0 0 6px;font-size:17px;font-weight:700;color:#1e293b;">Replicate Workstation Plan</h3>
                    <p style="margin:0 0 20px;font-size:13px;color:#64748b;">
                        Source: <strong>${fromLineLabel}</strong><br>
                        Product: <strong>${fromProductLabel}</strong><br>
                        Date: <strong>${fromDate}</strong>
                    </p>
                    <div style="margin-bottom:14px;">
                        <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:4px;text-transform:uppercase;">Target Line</label>
                        <select id="cpm-target-line" class="form-control" style="width:100%;">
                            <option value="">— Select target line —</option>
                            ${lineOptions}
                        </select>
                    </div>
                    <div style="margin-bottom:20px;">
                        <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:4px;text-transform:uppercase;">Target Date</label>
                        <input type="date" id="cpm-target-date" value="${today}" class="form-control" style="width:100%;">
                        <div style="font-size:11px;color:#9ca3af;margin-top:3px;">Target line must have a daily plan set for this date with the same product. Can be any line including the source line.</div>
                    </div>
                    <div id="cpm-error" style="display:none;background:#fee2e2;color:#b91c1c;padding:8px 12px;border-radius:6px;font-size:13px;margin-bottom:14px;"></div>
                    <div style="display:flex;gap:8px;justify-content:flex-end;">
                        <button class="btn btn-secondary" onclick="document.getElementById('copy-plan-modal').remove()">Cancel</button>
                        <button onclick="executeCopyPlan(${fromLineId},'${fromDate}',${fromProductId})"
                            style="padding:7px 20px;background:#1e40af;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;">
                            Copy Plan
                        </button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);
            overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
        })
        .catch(err => showToast('Failed to load lines: ' + err.message, 'error'));
}

async function executeCopyPlan(fromLineId, fromDate, productId) {
    const toLineId = document.getElementById('cpm-target-line')?.value;
    const toDate = document.getElementById('cpm-target-date')?.value;
    const errEl = document.getElementById('cpm-error');
    if (!toLineId) { if (errEl) { errEl.textContent = 'Please select a target line.'; errEl.style.display = 'block'; } return; }
    if (!toDate) { if (errEl) { errEl.textContent = 'Please select a target date.'; errEl.style.display = 'block'; } return; }
    if (errEl) errEl.style.display = 'none';
    try {
        const res = await fetch(`/api/lines/${toLineId}/workstation-plan/copy-from-date`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from_date: fromDate, to_date: toDate, product_id: productId, from_line_id: fromLineId })
        });
        const result = await res.json();
        if (!result.success) {
            if (errEl) { errEl.textContent = result.error; errEl.style.display = 'block'; }
            return;
        }
        document.getElementById('copy-plan-modal')?.remove();
        showToast(`Plan copied successfully to target line for ${toDate}`, 'success');
    } catch (err) {
        if (errEl) { errEl.textContent = err.message; errEl.style.display = 'block'; }
    }
}

// Recompute and display OSM sequence numbers in the plan table
function refreshOsmLabels(tbody) {
    if (!tbody) return;
    tbody.querySelectorAll('.osm-seq-label').forEach(el => { el.textContent = ''; });
    let seq = 1;
    tbody.querySelectorAll('.ld-osm-check').forEach(cb => {
        const label = cb.parentElement.querySelector('.osm-seq-label');
        if (cb.checked && label) label.textContent = `OSM${seq++}`;
    });
}

// Toggle OSM observation point checkbox for a workstation process
async function toggleOsmCheck(lpwpId, checked, cbEl) {
    try {
        const r = await fetch(`/api/workstation-plan/processes/${lpwpId}/osm`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ osm_checked: checked })
        });
        const result = await r.json();
        if (!result.success) { showToast(result.error || 'Failed to update OSM', 'error'); return; }
        showToast(checked ? 'Marked as OSM point' : 'OSM point removed', 'success');
        if (cbEl) refreshOsmLabels(cbEl.closest('tbody'));
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ============================================================================
function getDefaultReportHour() {
    const nowHour = new Date().getHours() - 1;
    if (ADMIN_WORK_HOURS.includes(nowHour)) return nowHour;
    if (nowHour < ADMIN_WORK_HOURS[0]) return ADMIN_WORK_HOURS[0];
    return ADMIN_WORK_HOURS[ADMIN_WORK_HOURS.length - 1];
}

function buildReportHourOptions(selectedHour) {
    const selected = Number.isFinite(parseInt(selectedHour, 10)) ? parseInt(selectedHour, 10) : getDefaultReportHour();
    return ADMIN_WORK_HOURS.map(hour =>
        `<option value="${hour}" ${hour === selected ? 'selected' : ''}>${adminHourLabel(hour)}</option>`
    ).join('');
}

function formatReportHourLabel(hour) {
    const hourValue = parseInt(hour, 10);
    if (!Number.isFinite(hourValue)) return '';
    return adminHourLabel(hourValue);
}

function setAdminLiveReportTimer(refreshFn, guardId) {
    if (window._adminLiveReportTimer) clearInterval(window._adminLiveReportTimer);
    if (typeof refreshFn !== 'function') return;
    window._adminLiveReportTimer = setInterval(() => {
        if (!document.getElementById(guardId)) {
            clearInterval(window._adminLiveReportTimer);
            window._adminLiveReportTimer = null;
            return;
        }
        refreshFn();
    }, 30000);
}

// OSM REPORT — Stagewise Hourly OSM Report
// ============================================================================
async function loadOsmReport() {
    const content = document.getElementById('main-content');
    const today = new Date().toISOString().slice(0, 10);
    content.innerHTML = `
        <div class="page-header">
            <div>
                <h1 class="page-title">Stagewise Hourly OSM Report</h1>
                <p class="page-subtitle">Process-level OSM observation points</p>
            </div>
        </div>
        <div style="display:flex;gap:0;border-bottom:2px solid #e5e7eb;margin-bottom:16px;">
            <button id="osm-tab-daily" onclick="osmSwitchTab('daily')"
                style="padding:8px 22px;font-size:13px;font-weight:600;border:none;background:#1e3a5f;color:#fff;cursor:pointer;border-radius:6px 6px 0 0;margin-right:4px;">
                Daily OSM
            </button>
            <button id="osm-tab-range" onclick="osmSwitchTab('range')"
                style="padding:8px 22px;font-size:13px;font-weight:600;border:none;background:#e5e7eb;color:#374151;cursor:pointer;border-radius:6px 6px 0 0;">
                Date to Date
            </button>
        </div>

        <!-- Daily OSM controls -->
        <div id="osm-ctrl-daily" style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;margin-bottom:16px;">
            <div class="ie-date"><label>Line</label>
                <select id="osm-line-daily" class="form-control" style="min-width:180px;" onchange="refreshOsmReport()"></select>
            </div>
            <div class="ie-date"><label>Date</label>
                <input type="date" id="osm-date-daily" value="${today}" onchange="refreshOsmReport()">
            </div>
            <button class="btn btn-secondary" onclick="refreshOsmReport()">Refresh</button>
            <button class="btn btn-secondary" onclick="printOsmReport()">&#9113; Print</button>
            <button class="btn btn-secondary" onclick="downloadOsmExcel()" style="background:#1d6f42;color:#fff;border-color:#1d6f42;">&#8595; Excel</button>
        </div>

        <!-- Date-to-Date controls -->
        <div id="osm-ctrl-range" style="display:none;flex-wrap:wrap;gap:8px;align-items:flex-end;margin-bottom:16px;">
            <div class="ie-date"><label>Line</label>
                <select id="osm-line-range" class="form-control" style="min-width:180px;" onchange="refreshOsmRangeReport()"></select>
            </div>
            <div class="ie-date"><label>From</label>
                <input type="date" id="osm-from-range" value="${today}" onchange="refreshOsmRangeReport()">
            </div>
            <div class="ie-date"><label>To</label>
                <input type="date" id="osm-to-range" value="${today}" onchange="refreshOsmRangeReport()">
            </div>
            <button class="btn btn-secondary" onclick="refreshOsmRangeReport()">Refresh</button>
            <button class="btn btn-secondary" onclick="printOsmReport()">&#9113; Print</button>
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
            document.getElementById('osm-line-daily').innerHTML = opts;
            document.getElementById('osm-line-range').innerHTML = opts;
            // Restore last selected line and auto-load if available
            if (window._lastOsmLineId) {
                const sel = document.getElementById('osm-line-daily');
                if (sel) { sel.value = window._lastOsmLineId; refreshOsmReport(); }
            }
        }
    } catch (e) { /* ignore */ }
}

function osmSwitchTab(tab) {
    const isDaily = tab === 'daily';
    document.getElementById('osm-tab-daily').style.background = isDaily ? '#1e3a5f' : '#e5e7eb';
    document.getElementById('osm-tab-daily').style.color = isDaily ? '#fff' : '#374151';
    document.getElementById('osm-tab-range').style.background = isDaily ? '#e5e7eb' : '#1e3a5f';
    document.getElementById('osm-tab-range').style.color = isDaily ? '#374151' : '#fff';
    document.getElementById('osm-ctrl-daily').style.display = isDaily ? 'flex' : 'none';
    document.getElementById('osm-ctrl-range').style.display = isDaily ? 'none' : 'flex';
    document.getElementById('osm-content').innerHTML =
        '<div style="text-align:center;padding:40px;color:var(--secondary);">Select a line to load the report.</div>';
}

async function refreshOsmReport() {
    const lineId = document.getElementById('osm-line-daily')?.value;
    const date   = document.getElementById('osm-date-daily')?.value;
    const container = document.getElementById('osm-content');
    if (!container) return;
    if (lineId) window._lastOsmLineId = lineId;
    if (!lineId) {
        container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--secondary);">Select a line to load the report.</div>';
        return;
    }
    container.innerHTML = '<div style="text-align:center;padding:40px;"><div class="spinner" style="display:inline-block;"></div></div>';
    try {
        const r = await fetch(`${API_BASE}/osm-report?line_id=${lineId}&to_date=${date}`, { credentials: 'include' });
        const data = await r.json();
        if (!data.success) {
            container.innerHTML = `<div class="card"><div class="card-body" style="color:#dc2626;">${data.error || 'Failed to load report'}</div></div>`;
            return;
        }
        if (data.no_osm_points || !data.osm_points?.length) {
            container.innerHTML = `<div class="card"><div class="card-body" style="text-align:center;padding:40px;color:var(--secondary);">
                No OSM points configured for <strong>${data.line_name}</strong> on <strong>${date}</strong>.<br>
                Open <em>Daily Plans → Details</em> and check the <strong>OSM</strong> checkbox.
            </div></div>`;
            return;
        }
        container.innerHTML = _buildOsmTable(data);
    } catch (err) {
        container.innerHTML = `<div class="card"><div class="card-body" style="color:#dc2626;">Error: ${err.message}</div></div>`;
    }
}

async function refreshOsmRangeReport() {
    const lineId   = document.getElementById('osm-line-range')?.value;
    const fromDate = document.getElementById('osm-from-range')?.value;
    const toDate   = document.getElementById('osm-to-range')?.value;
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
            container.innerHTML = `<div class="card"><div class="card-body" style="color:#dc2626;">${data.error || 'Failed to load report'}</div></div>`;
            return;
        }
        if (data.no_osm_points || !data.osm_points?.length) {
            container.innerHTML = `<div class="card"><div class="card-body" style="text-align:center;padding:40px;color:var(--secondary);">
                No OSM points configured for <strong>${data.line_name}</strong>.<br>
                Open <em>Daily Plans → Details</em> and check the <strong>OSM</strong> checkbox.
            </div></div>`;
            return;
        }
        container.innerHTML = _buildOsmRangeTable(data);
    } catch (err) {
        container.innerHTML = `<div class="card"><div class="card-body" style="color:#dc2626;">Error: ${err.message}</div></div>`;
    }
}

function _buildOsmTable(data) {
    const { osm_points, target_units, total_target, working_hours, in_time, out_time, to_date, buyer_name, product_code, product_name } = data;
    const inH  = parseInt((in_time  || '08:00').split(':')[0]);
    const outH = parseInt((out_time || '17:00').split(':')[0]);

    const hours = [];
    for (let h = inH; h < outH; h++) {
        if (h === 12) continue; // skip lunch hour 12:00-13:00
        hours.push(h);
    }

    const perHourTarget = (working_hours > 0 && target_units > 0)
        ? Math.round(target_units / working_hours) : 0;

    // Elapsed hours: based on highest hour slot that has any data
    let maxDataHour = -1;
    for (const pt of osm_points) {
        for (const h of Object.keys(pt.hourly)) {
            const hInt = parseInt(h, 10);
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
            const d = pt.hourly[h];
            const qty = (d && d.quantity != null) ? d.quantity : '';
            return `<td style="${tcS}">${qty}</td>`;
        }).join('');

        const todayOutput = Object.values(pt.hourly).reduce((s, d) => s + (d.quantity || 0), 0);

        let combinedBacklog = 0;
        for (const h of hours.filter(h => h <= maxDataHour)) {
            const qty = pt.hourly[h]?.quantity || 0;
            if (qty < perHourTarget) combinedBacklog += (qty - perHourTarget);
        }
        const backlog = combinedBacklog < 0 ? combinedBacklog : 0;

        let combinedExtra = 0;
        for (const h of hours.filter(h => h <= maxDataHour)) {
            const qty = pt.hourly[h]?.quantity || 0;
            if (qty > perHourTarget) combinedExtra += (qty - perHourTarget);
        }
        const extra = combinedExtra > 0 ? combinedExtra : 0;

        const balToProd = totalTargetSoFar - todayOutput;
        const orderBalProd = (total_target || 0) - (pt.cumulative_output || 0);
        const orderComplete = total_target > 0 && orderBalProd <= 0;
        const remainingDays = (target_units > 0 && orderBalProd > 0)
            ? Math.ceil(orderBalProd / target_units) : 0;

        const reasons = [...new Set(
            Object.values(pt.hourly).map(d => d.shortfall_reason).filter(Boolean)
        )].join('; ');

        const rowBg = orderComplete ? 'background:#f0fdf4;' : '';

        return `<tr style="${rowBg}">
            <td style="${tcS}font-weight:700;color:#7c3aed;">${pt.osm_label}</td>
            <td style="${tcS}font-weight:600;">${pt.cumulative_output || 0}</td>
            <td style="${tcS}font-weight:600;">${pt.workstation_code}</td>
            <td style="${tdS}font-size:11px;min-width:180px;max-width:260px;white-space:normal;word-break:break-word;">${pt.operation_code} - ${pt.operation_name}</td>
            ${hourCells}
            <td style="${tcS}font-weight:700;">${totalTargetSoFar}</td>
            <td style="${tcS}font-weight:700;">${todayOutput}</td>
            <td style="${tcS}font-weight:700;color:#dc2626;">${backlog < 0 ? backlog : ''}</td>
            <td style="${tcS}font-weight:700;color:#16a34a;">${extra > 0 ? '+'+extra : ''}</td>
            <td style="${tcS}font-weight:700;color:${balToProd > 0 ? '#dc2626' : '#16a34a'};">${balToProd}</td>
            <td style="${tcS}font-weight:700;color:${orderComplete ? '#16a34a' : '#dc2626'};">${orderComplete ? '✓ COMPLETE' : orderBalProd}</td>
            <td style="${tcS}font-weight:700;color:${remainingDays > 0 ? '#b45309' : '#16a34a'};">${orderComplete ? '—' : remainingDays}</td>
            <td style="${tdS}font-size:11px;">${reasons}</td>
        </tr>`;
    }).join('');

    const maxCumulative = total_target > 0 ? Math.max(...osm_points.map(pt => pt.cumulative_output || 0)) : 0;
    const orderOver = total_target > 0 && maxCumulative > total_target;
    const orderComplete = total_target > 0 && maxCumulative >= total_target;
    const completionBanner = orderOver
        ? `<div style="background:#f59e0b;color:#fff;padding:10px 16px;font-weight:700;font-size:13px;border-radius:6px;margin-bottom:10px;display:flex;align-items:center;gap:8px;">
               <span style="font-size:18px;">⚠</span> OVER-PRODUCED — ${maxCumulative.toLocaleString()} units produced vs order quantity of ${total_target.toLocaleString()} (+${(maxCumulative - total_target).toLocaleString()} extra).
           </div>`
        : orderComplete
        ? `<div style="background:#16a34a;color:#fff;padding:10px 16px;font-weight:700;font-size:13px;border-radius:6px;margin-bottom:10px;display:flex;align-items:center;gap:8px;">
               <span style="font-size:18px;">✓</span> ORDER QUANTITY REACHED — This style has met its full order quantity of ${total_target.toLocaleString()} units.
           </div>` : '';

    return `<div class="card" id="osm-print-area"
        data-buyer="${(buyer_name||'').replace(/"/g,'&quot;')}"
        data-style="${(product_code||'').replace(/"/g,'&quot;')}"
        data-from="${to_date}"
        data-to="${to_date}">
        ${completionBanner}
        <div class="card-header">
            <div>
                <h3 class="card-title">STAGEWISE HOURLY OSM REPORT — DAILY</h3>
                <div style="font-size:12px;color:var(--secondary);margin-top:2px;">
                    ${data.line_name} (${data.line_code})
                    &nbsp;&bull;&nbsp; Style: ${product_code} — ${product_name}
                    &nbsp;&bull;&nbsp; Date: ${to_date}
                    &nbsp;&bull;&nbsp; Daily Target: ${target_units} &nbsp;&bull;&nbsp; Per Hour: ${perHourTarget}
                    &nbsp;&bull;&nbsp; Elapsed: ${elapsedHours}h &nbsp;&bull;&nbsp; Target as on time: ${totalTargetSoFar}
                </div>
            </div>
        </div>
        <div class="card-body" style="overflow-x:auto;padding:0;">
            <table style="border-collapse:collapse;white-space:nowrap;width:100%;" id="osm-table">
                <thead>
                    <tr>
                        <th style="${thS}min-width:55px;">OSM #</th>
                        <th style="${thS}min-width:80px;">CUMULATIVE<br>OUTPUT</th>
                        <th style="${thS}min-width:60px;">WS</th>
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
                        <td colspan="4" style="${tdS}text-align:right;font-weight:700;padding:4px 10px;">TARGET / HOUR</td>
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

function _buildOsmRangeTable(data) {
    const { osm_points, range_target, day_count, from_date, to_date, buyer_name, product_code, product_name, target_units } = data;

    const thS = 'background:#1e3a5f;color:#fff;padding:5px 6px;text-align:center;white-space:nowrap;font-size:11px;border:1px solid #0f2744;';
    const tdS = 'padding:4px 6px;border:1px solid #d1d5db;font-size:12px;';
    const tcS = tdS + 'text-align:center;';

    const dataRows = osm_points.map(pt => {
        const blog = pt.blog;
        const extra = pt.extra;
        const balToProd = range_target - pt.total_output;
        const orderBalProd = (range_target || 0) - pt.total_output;
        const remainingDays = (target_units > 0 && orderBalProd > 0)
            ? Math.ceil(orderBalProd / target_units) : 0;
        return `<tr>
            <td style="${tcS}font-weight:700;">${pt.workstation_number || ''}</td>
            <td style="${tcS}font-weight:700;color:#7c3aed;">${pt.osm_label}</td>
            <td style="${tcS}font-weight:600;">${pt.workstation_code}</td>
            <td style="${tdS}font-size:11px;min-width:180px;max-width:260px;white-space:normal;word-break:break-word;">${pt.operation_code} - ${pt.operation_name}</td>
            <td style="${tcS}font-weight:700;">${range_target}</td>
            <td style="${tcS}font-weight:700;">${pt.total_output}</td>
            <td style="${tcS}font-weight:700;color:#dc2626;">${blog < 0 ? blog : ''}</td>
            <td style="${tcS}font-weight:700;color:${balToProd > 0 ? '#dc2626' : '#16a34a'};">${balToProd}</td>
            <td style="${tcS}font-weight:700;color:${orderBalProd > 0 ? '#dc2626' : '#16a34a'};">${orderBalProd}</td>
            <td style="${tcS}font-weight:700;color:${remainingDays > 0 ? '#b45309' : '#16a34a'};">${remainingDays}</td>
            <td style="${tdS}font-size:11px;white-space:normal;word-break:break-word;">${pt.reasons || ''}</td>
        </tr>`;
    }).join('');

    return `<div class="card" id="osm-print-area"
        data-buyer="${(buyer_name||'').replace(/"/g,'&quot;')}"
        data-style="${(product_code||'').replace(/"/g,'&quot;')}"
        data-from="${from_date}"
        data-to="${to_date}">
        <div class="card-header">
            <div>
                <h3 class="card-title">STAGEWISE OSM REPORT — DATE TO DATE</h3>
                <div style="font-size:12px;color:var(--secondary);margin-top:2px;">
                    ${data.line_name} (${data.line_code})
                    &nbsp;&bull;&nbsp; Style: ${product_code} — ${product_name}
                    &nbsp;&bull;&nbsp; Period: ${from_date} → ${to_date}
                    &nbsp;&bull;&nbsp; Production Days: ${day_count} &nbsp;&bull;&nbsp; Daily Target: ${target_units} &nbsp;&bull;&nbsp; Range Target: ${range_target}
                </div>
            </div>
        </div>
        <div class="card-body" style="overflow-x:auto;padding:0;">
            <table style="border-collapse:collapse;white-space:nowrap;width:100%;" id="osm-table">
                <thead>
                    <tr>
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
                    </tr>
                </thead>
                <tbody>${dataRows}</tbody>
            </table>
        </div>
    </div>`;
}

function printOsmReport() {
    const area = document.getElementById('osm-print-area');
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
        .card{border:none;}
        .card-header{padding:6px 10px;background:#f8fafc;border-bottom:1px solid #e5e7eb;}
        .card-title{font-size:12px;font-weight:700;margin:0 0 2px;}
        .card-header div{font-size:9px;}
        .card-body{padding:0;overflow:visible;}
        table{border-collapse:collapse;width:100%;table-layout:auto;}
        th,td{padding:2px 4px!important;font-size:8px!important;white-space:normal!important;
              min-width:0!important;max-width:none!important;word-break:break-word;border:1px solid #ccc!important;}
        th{background:#1e3a5f!important;color:#fff!important;font-weight:700;text-align:center;}
        @media print{@page{size:A4 landscape;margin:5mm;}body{margin:0;padding:0;}}
    </style></head><body>${area.outerHTML}</body></html>`;
    iframe.onload = function() {
        setTimeout(() => {
            const doc = iframe.contentDocument;
            const printArea = doc.getElementById('osm-print-area');
            const table = doc.querySelector('table');
            if (table && printArea) {
                // A4 landscape @ 96dpi with 5mm margins each side ≈ 1084px usable
                const pageW = 1084;
                const tableW = table.offsetWidth;
                if (tableW > pageW) {
                    const z = (pageW / tableW).toFixed(4);
                    printArea.style.zoom = z;
                }
            }
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
            setTimeout(() => document.body.removeChild(iframe), 2000);
        }, 250);
    };
    document.body.appendChild(iframe);
}

function downloadOsmExcel() {
    const area = document.getElementById('osm-print-area');
    if (!area) { showToast('No report loaded', 'error'); return; }
    const sel = document.getElementById('osm-line');
    const lineText = sel ? (sel.options[sel.selectedIndex]?.text || 'Line') : 'Line';
    const date = document.getElementById('osm-date')?.value || '';
    const filename = `OSM_${lineText.replace(/[^a-zA-Z0-9]/g, '_')}_${date}.xls`;

    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office"
        xmlns:x="urn:schemas-microsoft-com:office:excel"
        xmlns="http://www.w3.org/TR/REC-html40">
        <head><meta charset="UTF-8">
        <!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets>
        <x:ExcelWorksheet><x:Name>OSM Report</x:Name>
        <x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
        </x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
        <style>
            table { border-collapse: collapse; }
            th, td { border: 1px solid #999; padding: 4px 6px; font-size: 11px; font-family: Arial, sans-serif; }
            th { background: #1e3a5f; color: #fff; font-weight: bold; }
            .card-title { font-size: 14px; font-weight: bold; }
        </style>
        </head><body>${area.innerHTML}</body></html>`;

    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ============================================================================
// EFFICIENCY REPORT
// ============================================================================
async function loadEfficiencyReport() {
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
                    <label for="eff-line">Line</label>
                    <select id="eff-line" class="form-control" style="min-width:180px;"></select>
                </div>
                <div class="ie-date">
                    <label for="eff-date">Date</label>
                    <input type="date" id="eff-date" value="${today}">
                </div>
                <div class="ie-date">
                    <label for="eff-hour">Hour</label>
                    <select id="eff-hour" class="form-control" style="min-width:180px;">${buildReportHourOptions()}</select>
                </div>
                <button class="btn btn-secondary" onclick="refreshEfficiencyReport()">Refresh</button>
                <button class="btn btn-secondary" onclick="printEfficiencyReport()">&#9113; Print</button>
                <button class="btn btn-secondary" onclick="downloadEfficiencyExcel()" style="background:#1d6f42;color:#fff;border-color:#1d6f42;">&#8595; Excel</button>
            </div>
        </div>
        <div id="eff-content">
            <div style="text-align:center;padding:40px;color:var(--secondary);">Select a line to load the report.</div>
        </div>
    `;

    try {
        const r = await fetch(`${API_BASE}/lines`, { credentials: 'include' });
        const result = await r.json();
        if (result.success) {
            const sel = document.getElementById('eff-line');
            sel.innerHTML = '<option value="">-- Select Line --</option>' +
                result.data.filter(l => l.is_active).map(l =>
                    `<option value="${l.id}">${l.line_name} (${l.line_code})</option>`
                ).join('');
            sel.addEventListener('change', refreshEfficiencyReport);
        }
    } catch (e) { /* ignore */ }

    document.getElementById('eff-date').addEventListener('change', refreshEfficiencyReport);
    document.getElementById('eff-hour').addEventListener('change', refreshEfficiencyReport);
    setAdminLiveReportTimer(() => refreshEfficiencyReport(), 'eff-content');
}

async function refreshEfficiencyReport() {
    const lineId = document.getElementById('eff-line')?.value;
    const date   = document.getElementById('eff-date')?.value;
    const hour   = document.getElementById('eff-hour')?.value || String(getDefaultReportHour());
    const container = document.getElementById('eff-content');
    if (!container) return;

    if (!lineId) {
        container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--secondary);">Select a line to load the report.</div>';
        return;
    }

    // Save scroll before refresh so auto-refresh doesn't jump page to top
    const savedScrollY = window.scrollY;
    const isInitialLoad = !container.querySelector('table');
    if (isInitialLoad) {
        container.innerHTML = '<div style="text-align:center;padding:40px;"><div class="spinner" style="display:inline-block;"></div></div>';
    }

    try {
        const r = await fetch(`${API_BASE}/efficiency-report?line_id=${lineId}&date=${date}&hour=${hour}`, { credentials: 'include' });
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

        container.innerHTML = _buildEfficiencyTable(resp.data, hour);
        requestAnimationFrame(() => window.scrollTo(0, savedScrollY));
    } catch (err) {
        container.innerHTML = `<div class="card"><div class="card-body" style="color:#dc2626;">Error: ${err.message}</div></div>`;
    }
}

function _buildEfficiencyTable(data, selectedHour) {
    const { line, plan, summary, workstations, employee_progress = [] } = data;
    const thS = 'background:#1e3a5f;color:#fff;padding:5px 6px;text-align:center;white-space:nowrap;font-size:11px;border:1px solid #0f2744;';
    const tdS = 'padding:4px 6px;border:1px solid #d1d5db;font-size:12px;';
    const tcS = tdS + 'text-align:center;';
    const reportLabel = plan.report_hour_label || 'Full Day';
    const hourlyTarget = plan.hourly_target_units || 0;
    const liveHours = plan.live_hours || 0;
    const reportHourLabel = reportLabel;

    // Live window: from working day start to end of selected hour
    const reportHourNum = parseInt(selectedHour, 10);
    const liveWindowStart = plan.in_time || '08:00';
    const liveWindowEnd = Number.isFinite(reportHourNum)
        ? `${String(reportHourNum + 1).padStart(2, '0')}:00`
        : (plan.out_time || '17:00');
    const liveWindowLabel = `${liveWindowStart} → ${liveWindowEnd}`;

    const liveEff = summary.live_efficiency_pct;
    const liveEffColor = liveEff === null ? '#6b7280' : liveEff >= 90 ? '#16a34a' : liveEff >= 80 ? '#d97706' : '#dc2626';
    const liveEffText = liveEff === null ? 'N/A' : liveEff.toFixed(2) + '%';
    const hourlyEff = summary.hourly_efficiency_pct;
    const hourlyEffColor = hourlyEff === null ? '#6b7280' : hourlyEff >= 90 ? '#16a34a' : hourlyEff >= 80 ? '#d97706' : '#dc2626';
    const hourlyEffText = hourlyEff === null ? 'N/A' : hourlyEff.toFixed(2) + '%';

    // Formula explanations
    const formulaBox = `
        <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:6px;padding:10px 14px;margin-bottom:12px;font-size:11px;color:#374151;line-height:1.8;">
            <strong style="font-size:12px;">Efficiency Formulas</strong>
            <div style="display:flex;flex-wrap:wrap;gap:16px;margin-top:6px;">
                <span><strong>Hourly WS Eff%</strong> = (Hourly Output × WS SAM) ÷ 3600 × 100</span>
                <span><strong>Live WS Eff%</strong> = (Live Output × WS SAM) ÷ (Live Hours × 3600) × 100</span>
                <span><strong>Hourly Line Eff%</strong> = (Last WS Hourly Output × Style SAH) ÷ Manpower × 100</span>
                <span><strong>Live Line Eff%</strong> = (Last WS Live Output × Style SAH) ÷ (Manpower × Live Hours) × 100</span>
                <span style="color:#6b7280;font-style:italic;">SAM = Cycle Time in seconds &nbsp;|&nbsp; Style SAH = Total SAH for all processes</span>
            </div>
        </div>`;

    const summaryBar = `
        <div style="display:flex;flex-wrap:wrap;gap:12px;padding:12px 16px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px;margin-bottom:12px;align-items:center;">
            <span style="font-size:12px;"><strong>Product:</strong> ${plan.product_name || '-'} (${plan.product_code || '-'})</span>
            <span style="font-size:12px;"><strong>Selected Hour:</strong> ${reportLabel}</span>
            <span style="font-size:12px;"><strong>Live Window:</strong> ${liveWindowLabel}</span>
            <span style="font-size:12px;"><strong>Style SAH:</strong> ${plan.style_sah.toFixed(4)} h</span>
            <span style="font-size:12px;"><strong>Manpower:</strong> ${summary.manpower}</span>
            <span style="font-size:12px;"><strong>Hour Target:</strong> ${hourlyTarget}</span>
            <span style="font-size:12px;"><strong>Live Hours:</strong> ${liveHours}</span>
            <span style="font-size:12px;"><strong>Takt Time:</strong> ${plan.takt_time_seconds} s</span>
            <span style="font-size:12px;"><strong>Daily Target:</strong> ${plan.target_units}</span>
            <span style="margin-left:auto;"></span>
        </div>`;

    const empAvgMap = new Map((employee_progress || []).map(emp => [String(emp.emp_code || ''), emp.hourly_efficiency_avg]));

    const dataRows = workstations.map(ws => {
        const wl = parseFloat(ws.workload_pct || 0);
        const wlColor = wl >= 90 ? '#16a34a' : wl >= 80 ? '#d97706' : '#dc2626';
        const wlBg    = wl >= 90 ? '#dcfce7' : wl >= 80 ? '#fef3c7' : '#fee2e2';

        const liveWe = ws.live_efficiency_pct;
        let liveWeText, liveWeColor, liveWeBg;
        if (liveWe === null || !ws.employee_code) {
            liveWeText = '—'; liveWeColor = '#6b7280'; liveWeBg = '#f9fafb';
        } else {
            liveWeText = liveWe.toFixed(2) + '%';
            liveWeColor = liveWe >= 90 ? '#16a34a' : liveWe >= 80 ? '#d97706' : '#dc2626';
            liveWeBg    = liveWe >= 90 ? '#dcfce7'  : liveWe >= 80 ? '#fef3c7'  : '#fee2e2';
        }

        const hourlyWe = ws.hourly_efficiency_pct;
        let hourlyWeText, hourlyWeColor, hourlyWeBg;
        if (hourlyWe === null || !ws.employee_code) {
            hourlyWeText = '—'; hourlyWeColor = '#6b7280'; hourlyWeBg = '#f9fafb';
        } else {
            hourlyWeText = hourlyWe.toFixed(2) + '%';
            hourlyWeColor = hourlyWe >= 90 ? '#16a34a' : hourlyWe >= 80 ? '#d97706' : '#dc2626';
            hourlyWeBg    = hourlyWe >= 90 ? '#dcfce7'  : hourlyWe >= 80 ? '#fef3c7'  : '#fee2e2';
        }

        return `<tr>
            <td style="${tcS}font-weight:600;">${ws.group_name || '-'}</td>
            <td style="${tcS}font-weight:600;">${ws.workstation_code}</td>
            <td style="${tdS}">${ws.employee_code ? `${ws.employee_name} (${ws.employee_code})` : '<span style="color:#9ca3af;">Unassigned</span>'}</td>
            <td style="${tcS}">${ws.actual_sam_seconds.toFixed(2)}</td>
            <td style="${tcS}">${ws.takt_time_seconds.toFixed(0)}</td>
            <td style="${tcS}font-weight:700;color:${wlColor};background:${wlBg};">${wl.toFixed(1)}%</td>
            <td style="${tcS}font-weight:700;">${ws.hourly_output ?? 0}</td>
            <td style="${tcS}font-weight:700;color:${hourlyWeColor};background:${hourlyWeBg};">${hourlyWeText}</td>
            <td style="${tcS}font-weight:700;">${ws.live_output ?? 0}</td>
            <td style="${tcS}font-weight:700;color:${liveWeColor};background:${liveWeBg};">${liveWeText}</td>
            <td style="${tcS}font-weight:700;color:#0f172a;">${
                ws.employee_code ? ((empAvgMap.get(String(ws.employee_code)) || 0).toFixed(2) + '%') : '—'
            }</td>
        </tr>`;
    }).join('');

    const employeeRows = employee_progress.length
        ? employee_progress.map(emp => {
            const updatedText = emp.last_updated
                ? new Date(emp.last_updated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                : '—';
            const remarksText = emp.hourly_not_entered
                ? `<span style="color:#d97706;font-size:11px;">⚠ Output not entered for ${reportHourLabel}</span>`
                : (emp.hourly_output === 0
                    ? `<span style="color:#dc2626;font-size:11px;">0 pcs entered for ${reportHourLabel}</span>`
                    : '—');
            return `<tr>
                <td style="${tdS}"><strong>${emp.emp_code}</strong><div style="color:var(--secondary);font-size:11px;">${emp.emp_name}</div></td>
                <td style="${tcS}">${emp.workstation_code || '—'}</td>
                <td style="${tcS}font-weight:700;">${emp.hourly_output || 0}</td>
                <td style="${tcS}font-weight:700;">${(emp.hourly_efficiency_percent || 0).toFixed(2)}%</td>
                <td style="${tcS}font-weight:700;">${(emp.hourly_efficiency_avg || 0).toFixed(2)}%</td>
                <td style="${tcS}font-weight:700;">${emp.live_output || 0}</td>
                <td style="${tcS}font-weight:700;">${(emp.live_efficiency_percent || 0).toFixed(2)}%</td>
                <td style="${tdS}">${remarksText}</td>
            </tr>`;
        }).join('')
        : `<tr><td colspan="7" style="${tdS}text-align:center;color:#6b7280;">No employee progress recorded for ${reportLabel}.</td></tr>`;

    return `<div id="efficiency-print-area">
        <div class="card">
            <div class="card-header">
                <div>
                    <h3 class="card-title">LIVE AND HOURLY EFFICIENCY REPORT</h3>
                    <div style="font-size:12px;color:var(--secondary);margin-top:2px;">
                        ${line.line_name} (${line.line_code})
                        &nbsp;&bull;&nbsp; Date: ${document.getElementById('eff-date')?.value || ''}
                        &nbsp;&bull;&nbsp; Hourly Window: ${reportLabel}
                    </div>
                </div>
            </div>
            <div class="card-body">
                ${formulaBox}
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
                                <th style="${thS}min-width:90px;">HOURLY OUTPUT<br>${reportLabel}</th>
                                <th style="${thS}min-width:90px;">HOURLY EFF%</th>
                                <th style="${thS}min-width:90px;">LIVE OUTPUT</th>
                                <th style="${thS}min-width:90px;">LIVE EFF%</th>
                                <th style="${thS}min-width:90px;">AVG EFF</th>
                            </tr>
                        </thead>
                        <tbody>${dataRows}</tbody>
                    </table>
                </div>
                <div style="margin-top:16px;overflow-x:auto;">
                    <table style="border-collapse:collapse;width:100%;white-space:nowrap;">
                        <thead>
                            <tr>
                                <th style="${thS}min-width:150px;">EMPLOYEE</th>
                                <th style="${thS}min-width:70px;">WS</th>
                                <th style="${thS}min-width:90px;">HOURLY OUTPUT</th>
                                <th style="${thS}min-width:100px;">HOURLY EFFICIENCY</th>
                                <th style="${thS}min-width:90px;">AVG EFF</th>
                                <th style="${thS}min-width:90px;">LIVE OUTPUT</th>
                                <th style="${thS}min-width:100px;">LIVE EFFICIENCY</th>
                                <th style="${thS}min-width:180px;white-space:normal;">REMARKS</th>
                            </tr>
                        </thead>
                        <tbody>${employeeRows}</tbody>
                    </table>
                </div>
            </div>
        </div>
    </div>`;
}

function printEfficiencyReport() {
    const area = document.getElementById('efficiency-print-area');
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

function downloadEfficiencyExcel() {
    const area = document.getElementById('efficiency-print-area');
    if (!area) { alert('No report loaded.'); return; }
    const sel = document.getElementById('eff-line');
    const lineText = sel ? (sel.options[sel.selectedIndex]?.text || '') : '';
    const date = document.getElementById('eff-date')?.value || '';
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
// WORKER INDIVIDUAL EFFICIENCY REPORT
// ============================================================================
let _wieData = null;
let _wieMetric = 'all'; // 'all' | 'efficiency' | 'target' | 'output'

async function loadWorkerIndividualEff() {
    const content = document.getElementById('main-content');
    const today = new Date().toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 6 * 24 * 3600000).toISOString().slice(0, 10);
    _wieData = null;
    _wieMetric = 'all';
    content.innerHTML = `
        <div class="page-header">
            <div>
                <h1 class="page-title">Worker Efficiency</h1>
                <p class="page-subtitle">Target · Output · Efficiency across all active lines</p>
            </div>
            <div class="ie-actions" style="flex-wrap:wrap;gap:8px;">
                <div class="ie-date">
                    <label for="wie-from">From</label>
                    <input type="date" id="wie-from" value="${weekAgo}">
                </div>
                <div class="ie-date">
                    <label for="wie-to">To</label>
                    <input type="date" id="wie-to" value="${today}">
                </div>
                <button class="btn btn-primary" onclick="refreshWorkerIndividualEff()">Load</button>
                <button class="btn btn-secondary" onclick="printWorkerIndividualEff()">&#9113; Print</button>
                <button class="btn btn-secondary" onclick="downloadWorkerIndividualEffExcel()" style="background:#1d6f42;color:#fff;border-color:#1d6f42;">&#8595; Excel</button>
            </div>
        </div>
        <!-- Filters row -->
        <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:14px;">
            <div style="display:flex;gap:4px;background:#f3f4f6;border-radius:8px;padding:3px;">
                <button id="wie-btn-all"        onclick="setWieMetric('all')"        style="padding:5px 14px;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;background:#1e40af;color:#fff;">All</button>
                <button id="wie-btn-target"     onclick="setWieMetric('target')"     style="padding:5px 14px;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;background:transparent;color:#374151;">Target</button>
                <button id="wie-btn-wip"        onclick="setWieMetric('wip')"        style="padding:5px 14px;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;background:transparent;color:#374151;">WIP</button>
                <button id="wie-btn-output"     onclick="setWieMetric('output')"     style="padding:5px 14px;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;background:transparent;color:#374151;">Output</button>
                <button id="wie-btn-efficiency" onclick="setWieMetric('efficiency')" style="padding:5px 14px;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;background:transparent;color:#374151;">Efficiency</button>
            </div>
            <div style="position:relative;" id="wie-emp-picker">
                <label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:3px;">Employee</label>
                <button type="button" id="wie-emp-btn" onclick="toggleWieEmpDropdown()"
                    style="min-width:220px;max-width:320px;padding:7px 12px;border:1px solid #d1d5db;border-radius:6px;background:#fff;font-size:13px;text-align:left;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:8px;">
                    <span id="wie-emp-label">All Employees</span>
                    <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
                </button>
                <div id="wie-emp-dropdown" style="display:none;position:absolute;top:100%;left:0;z-index:999;background:#fff;border:1px solid #d1d5db;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.12);min-width:280px;max-width:360px;overflow:hidden;">
                    <div style="padding:8px;">
                        <input type="text" id="wie-emp-search" placeholder="Search employees..." oninput="filterWieEmpList()"
                            style="width:100%;padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;box-sizing:border-box;">
                    </div>
                    <div style="padding:4px 8px 4px;border-bottom:1px solid #f3f4f6;display:flex;gap:10px;">
                        <button type="button" onclick="selectAllWieEmp()" style="font-size:11px;color:#3b82f6;background:none;border:none;cursor:pointer;padding:2px 0;font-weight:600;">Select All</button>
                        <button type="button" onclick="clearAllWieEmp()" style="font-size:11px;color:#6b7280;background:none;border:none;cursor:pointer;padding:2px 0;">Clear</button>
                    </div>
                    <div id="wie-emp-list" style="max-height:220px;overflow-y:auto;padding:4px 0;"></div>
                </div>
            </div>
        </div>
        <div id="wie-content" style="overflow-x:auto;">
            <div style="text-align:center;padding:60px;color:#9ca3af;">Select a date range and click <strong>Load</strong>.</div>
        </div>
    `;
    document.getElementById('wie-from').addEventListener('change', () => {});
    document.getElementById('wie-to').addEventListener('change', () => {});
}

function setWieMetric(metric) {
    _wieMetric = metric;
    ['all','target','wip','output','efficiency'].forEach(m => {
        const btn = document.getElementById(`wie-btn-${m}`);
        if (!btn) return;
        btn.style.background = m === metric ? '#1e40af' : 'transparent';
        btn.style.color      = m === metric ? '#fff'    : '#374151';
    });
    _wieRenderFiltered();
}

let _wieSelectedEmps = new Set(); // empty = all

function toggleWieEmpDropdown() {
    const dd = document.getElementById('wie-emp-dropdown');
    if (!dd) return;
    const isOpen = dd.style.display !== 'none';
    dd.style.display = isOpen ? 'none' : 'block';
    if (!isOpen) document.getElementById('wie-emp-search')?.focus();
}

function filterWieEmpList() {
    const q = (document.getElementById('wie-emp-search')?.value || '').toLowerCase();
    document.querySelectorAll('#wie-emp-list .wie-emp-item').forEach(item => {
        item.style.display = item.dataset.label.toLowerCase().includes(q) ? '' : 'none';
    });
}

function _wieUpdateEmpLabel() {
    const label = document.getElementById('wie-emp-label');
    if (!label) return;
    if (_wieSelectedEmps.size === 0) { label.textContent = 'All Employees'; return; }
    if (_wieSelectedEmps.size === 1) {
        const id = [..._wieSelectedEmps][0];
        const item = document.querySelector(`#wie-emp-list .wie-emp-item[data-id="${id}"]`);
        label.textContent = item ? item.dataset.label : `${_wieSelectedEmps.size} selected`;
        return;
    }
    label.textContent = `${_wieSelectedEmps.size} employees selected`;
}

function toggleWieEmp(id) {
    if (_wieSelectedEmps.has(id)) _wieSelectedEmps.delete(id);
    else _wieSelectedEmps.add(id);
    _wieUpdateEmpLabel();
    _wieRenderFiltered();
}

function selectAllWieEmp() {
    document.querySelectorAll('#wie-emp-list .wie-emp-item input[type=checkbox]').forEach(cb => {
        cb.checked = true;
        _wieSelectedEmps.add(cb.dataset.id);
    });
    _wieUpdateEmpLabel();
    _wieRenderFiltered();
}

function clearAllWieEmp() {
    _wieSelectedEmps.clear();
    document.querySelectorAll('#wie-emp-list .wie-emp-item input[type=checkbox]').forEach(cb => cb.checked = false);
    _wieUpdateEmpLabel();
    _wieRenderFiltered();
}

function _wiePopulateEmpList(rows) {
    const empMap = new Map();
    rows.forEach(r => { if (r.employee_id) empMap.set(String(r.employee_id), { code: r.emp_code, name: r.emp_name }); });
    const sorted = [...empMap.entries()].sort((a, b) => (a[1].name || '').localeCompare(b[1].name || ''));
    const list = document.getElementById('wie-emp-list');
    if (!list) return;
    list.innerHTML = sorted.map(([id, e]) => {
        const label = `${e.name} (${e.code})`;
        return `<label class="wie-emp-item" data-id="${id}" data-label="${label}"
            style="display:flex;align-items:center;gap:8px;padding:6px 12px;cursor:pointer;font-size:13px;user-select:none;"
            onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background=''">
            <input type="checkbox" data-id="${id}" ${_wieSelectedEmps.has(id) ? 'checked' : ''}
                onchange="toggleWieEmp('${id}')" style="width:15px;height:15px;accent-color:#1e40af;cursor:pointer;">
            <span>${label}</span>
        </label>`;
    }).join('');
}

// Close dropdown when clicking outside
document.addEventListener('click', e => {
    const picker = document.getElementById('wie-emp-picker');
    if (picker && !picker.contains(e.target)) {
        const dd = document.getElementById('wie-emp-dropdown');
        if (dd) dd.style.display = 'none';
    }
});

function _wieRenderFiltered() {
    const container = document.getElementById('wie-content');
    if (!container || !_wieData) return;
    let rows = _wieData.rows;
    if (_wieSelectedEmps.size > 0) rows = rows.filter(r => _wieSelectedEmps.has(String(r.employee_id)));
    if (!rows.length) {
        container.innerHTML = '<div class="card"><div class="card-body" style="text-align:center;padding:40px;color:var(--secondary);">No data for selected employees.</div></div>';
        return;
    }
    container.innerHTML = _buildWorkerIndividualEffTable({ ..._wieData, rows }, _wieMetric);
}

async function refreshWorkerIndividualEff() {
    const from = document.getElementById('wie-from')?.value;
    const to   = document.getElementById('wie-to')?.value;
    const container = document.getElementById('wie-content');
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
        _wieData = resp.data;
        _wieSelectedEmps.clear();
        _wiePopulateEmpList(resp.data.rows);
        _wieUpdateEmpLabel();
        _wieRenderFiltered();
    } catch (err) {
        container.innerHTML = `<div class="card"><div class="card-body" style="color:#dc2626;">Error: ${err.message}</div></div>`;
    }
}

function _buildWorkerIndividualEffTable(data, metric = 'all') {
    const { dates, rows } = data;
    const thS  = 'background:#1e3a5f;color:#fff;padding:6px 5px;text-align:center;white-space:nowrap;font-size:11px;border:1px solid #0f2744;font-weight:700;';
    const thSS = 'background:#1e3a5f;color:#fff;padding:4px 4px;text-align:center;white-space:nowrap;font-size:10px;border:1px solid #0f2744;';
    const tdS  = 'padding:4px 5px;border:1px solid #9ca3af;font-size:11px;';
    const tcS  = tdS + 'text-align:center;';

    const showTarget = metric === 'all' || metric === 'target';
    const showWip    = metric === 'all' || metric === 'wip';
    const showOutput = metric === 'all' || metric === 'output';
    const showEff    = metric === 'all' || metric === 'efficiency';

    const dateCols = (showTarget?1:0) + (showWip?1:0) + (showOutput?1:0) + (showEff?1:0);
    const fixedCols = 3; // S.No | WORKER NAME | ID NO
    const overallCols = (showOutput?1:0) + (showEff?1:0);

    const months = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const fmtDate = d => {
        const [, m, day] = d.split('-');
        return `${parseInt(day)}-${months[parseInt(m)]}`;
    };

    const tagStyle = {
        'DEP':  'background:#fee2e2;color:#991b1b;',
        'PRE':  'background:#eff6ff;color:#1d4ed8;',
        'POST': 'background:#f0fdf4;color:#166534;',
        'COMB': 'background:#faf5ff;color:#6b21a8;'
    };
    const effColor = eff => {
        if (eff == null) return '#6b7280';
        return eff >= 90 ? '#16a34a' : eff >= 80 ? '#d97706' : '#dc2626';
    };

    // Header row 1: DATE label | per-date group headers | OVERALL
    const dateGroupHeaders = dates.map(d =>
        `<th colspan="${dateCols}" style="${thS}">${fmtDate(d)}</th>`
    ).join('');

    // Header row 2: fixed cols | per-date sub-cols | overall sub-cols
    const subHeaders = dates.map(() => [
        showTarget ? `<th style="${thSS}">TARGET</th>` : '',
        showWip    ? `<th style="${thSS}">WIP</th>`    : '',
        showOutput ? `<th style="${thSS}">OUTPUT</th>` : '',
        showEff    ? `<th style="${thSS}">EFF%</th>`   : '',
    ].join('')).join('');

    const dataRows = rows.map((row, idx) => {
        const dateCells = dates.map(d => {
            const cell = row.dates[d];
            const hasWorkedHours = Number(cell?.hours_worked || 0) > 0;
            const tagKey = cell?.tag ? cell.tag.split(' ')[0] : null;
            const tS = tagKey && tagStyle[tagKey] ? tagStyle[tagKey] : '';
            const tagBadge = cell?.tag ? `<br><span style="font-size:8px;font-weight:700;">${cell.tag}</span>` : '';
            const effVal = Number.isFinite(Number(cell?.eff)) ? Number(cell.eff) : 0;
            const effTxt = effVal.toFixed(1) + '%';
            const effC   = effColor(effVal);
            const blankCell = `<td style="${tcS}">-</td>`;

            if (!cell || !hasWorkedHours) return [
                showTarget ? blankCell : '',
                showWip    ? blankCell : '',
                showOutput ? blankCell : '',
                showEff    ? `<td style="${tcS}font-weight:600;color:#6b7280;">-</td>` : '',
            ].join('');

            const wip      = Math.max(0, (cell.wip ?? 0) - (cell.output ?? 0));
            const wipColor = wip > 0 ? '#dc2626' : '#16a34a';

            return [
                showTarget ? `<td style="${tcS}${tS}">${cell.wip ?? '-'}${tagBadge}</td>` : '',
                showWip    ? `<td style="${tcS}${tS}font-weight:600;color:${wipColor};">${wip}</td>` : '',
                showOutput ? `<td style="${tcS}${tS}">${cell.output ?? 0}</td>` : '',
                showEff    ? `<td style="${tcS}${tS}font-weight:600;color:${effC};">${effTxt}</td>` : '',
            ].join('');
        }).join('');

        const totalEffVal = Number.isFinite(Number(row.overall_eff)) ? Number(row.overall_eff) : 0;
        const totalEffTxt = totalEffVal.toFixed(1) + '%';
        const totalEffC   = effColor(totalEffVal);

        return `<tr>
            <td style="${tcS}font-weight:600;">${idx + 1}</td>
            <td style="${tdS}font-weight:600;">${row.emp_name || '-'}</td>
            <td style="${tcS}">${row.emp_code || '-'}</td>
            ${dateCells}
            ${showOutput ? `<td style="${tcS}font-weight:700;">${row.total_output}</td>` : ''}
            ${showEff    ? `<td style="${tcS}font-weight:700;color:${totalEffC};">${totalEffTxt}</td>` : ''}
        </tr>`;
    }).join('');

    return `
    <div id="wie-print-area">
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
                    ${showEff    ? `<th style="${thSS}">EFF%</th>`            : ''}
                </tr>
            </thead>
            <tbody>${dataRows}</tbody>
        </table>
        </div>
    </div>`;
}

function printWorkerIndividualEff() {
    const area = document.getElementById('wie-print-area');
    if (!area) { alert('No report loaded.'); return; }
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.onload = () => {
        const doc = iframe.contentDocument;
        // Clone and force-set borders directly on every cell as inline styles
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

function downloadWorkerIndividualEffExcel() {
    const area = document.getElementById('wie-print-area');
    if (!area) { alert('No report loaded.'); return; }
    const sel = document.getElementById('wie-line');
    const lineText = sel ? (sel.options[sel.selectedIndex]?.text || '') : '';
    const from = document.getElementById('wie-from')?.value || '';
    const to   = document.getElementById('wie-to')?.value   || '';
    const filename = `WorkerEfficiency_${lineText.replace(/[^a-zA-Z0-9]/g, '_')}_${from}_${to}.xls`;
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
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ============================================================================
// WIFI MANAGEMENT
// ============================================================================
async function wifiReadJsonResponse(response, fallbackMessage) {
    const text = await response.text();
    if (!text) return {};
    try {
        return JSON.parse(text);
    } catch (err) {
        const trimmed = text.trim();
        if (trimmed.startsWith('<')) {
            if (response.status === 401 || response.redirected) {
                throw new Error('Session expired. Reload the page and sign in again.');
            }
            throw new Error(`${fallbackMessage}. Server returned HTML instead of JSON.`);
        }
        throw new Error(trimmed.slice(0, 200) || fallbackMessage);
    }
}

async function loadWifiSection() {
    const content = document.getElementById('main-content');
    content.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';
    try {
        const res = await fetch(`${API_BASE}/admin/wifi/status`, {
            headers: { Accept: 'application/json' },
            credentials: 'same-origin',
            cache: 'no-store'
        });
        const data = await wifiReadJsonResponse(res, 'Failed to load WiFi status');
        if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
        const ips = (data.ips || []).join(', ') || 'Unknown';
        const ssid = data.current_ssid || 'Not connected';
        content.innerHTML = `
            <div class="page-header">
                <div>
                    <h1 class="page-title">WiFi Management</h1>
                    <p class="page-subtitle">Connect this device to a different WiFi network</p>
                </div>
            </div>
            <div style="max-width:600px;margin:0 auto;">
                <div class="card" style="margin-bottom:1.5rem;padding:1.25rem 1.5rem;">
                    <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.25rem;">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="var(--primary)" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0"/>
                        </svg>
                        <span style="font-weight:600;font-size:0.95rem;">Current Connection</span>
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-top:0.75rem;">
                        <div>
                            <div style="font-size:0.75rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;">Network (SSID)</div>
                            <div style="font-weight:600;margin-top:0.2rem;">${escHtml(ssid)}</div>
                        </div>
                        <div>
                            <div style="font-size:0.75rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;">IP Address</div>
                            <div style="font-weight:600;margin-top:0.2rem;">${escHtml(ips)}</div>
                        </div>
                    </div>
                </div>
                <div class="card" style="padding:1.25rem 1.5rem;">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;">
                        <span style="font-weight:600;font-size:0.95rem;">Available Networks</span>
                        <button class="btn btn-secondary btn-sm" id="wifi-scan-btn" onclick="scanWifiNetworks()">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" style="margin-right:4px">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                            </svg>
                            Scan
                        </button>
                    </div>
                    <div id="wifi-networks-list">
                        <div style="color:var(--text-muted);font-size:0.875rem;padding:1rem 0;text-align:center;">
                            Click Scan to search for networks
                        </div>
                    </div>
                </div>
                <div style="margin-top:1rem;padding:0.875rem 1rem;background:var(--bg-secondary);border-radius:8px;font-size:0.8rem;color:var(--text-muted);">
                    <strong>Note:</strong> When connecting to a new network, this device will get a new IP address and your current connection will drop.
                    You can always reconnect using <strong>https://worksync.local</strong>
                </div>
            </div>

            <!-- WiFi Password Modal -->
            <div id="wifi-connect-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;align-items:center;justify-content:center;">
                <div style="background:var(--bg-primary);border-radius:12px;padding:1.75rem;width:100%;max-width:400px;margin:1rem;">
                    <h3 style="margin:0 0 1.25rem;font-size:1.05rem;" id="wifi-modal-title">Connect to Network</h3>
                    <div style="margin-bottom:1rem;">
                        <label style="font-size:0.8rem;font-weight:600;color:var(--text-muted);display:block;margin-bottom:0.4rem;">PASSWORD</label>
                        <input type="password" id="wifi-password-input" class="form-control"
                            placeholder="Enter WiFi password"
                            onkeydown="if(event.key==='Enter') doWifiConnect()"
                            style="width:100%;" autocomplete="off"/>
                        <div id="wifi-connect-error" style="display:none;color:var(--danger);font-size:0.8rem;margin-top:0.5rem;"></div>
                    </div>
                    <div style="display:flex;gap:0.75rem;justify-content:flex-end;">
                        <button class="btn btn-secondary" onclick="closeWifiModal()">Cancel</button>
                        <button class="btn btn-primary" id="wifi-connect-btn" onclick="doWifiConnect()">Connect</button>
                    </div>
                </div>
            </div>`;
    } catch (err) {
        content.innerHTML = `<div class="page-header"><h1 class="page-title">WiFi Management</h1></div>
            <div class="empty-state"><p>Failed to load WiFi status: ${escHtml(err.message)}</p></div>`;
    }
}

async function scanWifiNetworks() {
    const btn = document.getElementById('wifi-scan-btn');
    const list = document.getElementById('wifi-networks-list');
    if (!btn || !list) return;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;margin-right:6px;display:inline-block;"></span>Scanning...';
    list.innerHTML = '<div style="color:var(--text-muted);font-size:0.875rem;padding:1.5rem 0;text-align:center;">Scanning for networks...</div>';
    try {
        const res = await fetch(`${API_BASE}/admin/wifi/networks`, {
            headers: { Accept: 'application/json' },
            credentials: 'same-origin',
            cache: 'no-store'
        });
        const data = await wifiReadJsonResponse(res, 'Scan failed');
        if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
        const networks = data.networks || [];
        if (networks.length === 0) {
            list.innerHTML = '<div style="color:var(--text-muted);font-size:0.875rem;padding:1rem 0;text-align:center;">No networks found</div>';
        } else {
            list.innerHTML = networks.map(n => {
                const bars = n.signal >= 75 ? 4 : n.signal >= 50 ? 3 : n.signal >= 25 ? 2 : 1;
                const locked = n.security && n.security !== 'Open';
                const isConnected = n.in_use;
                return `<div style="display:flex;align-items:center;gap:0.875rem;padding:0.75rem 0;border-bottom:1px solid var(--border-color);">
                    <div style="flex-shrink:0;">
                        ${_wifiSignalSvg(bars)}
                    </div>
                    <div style="flex:1;min-width:0;">
                        <div style="font-weight:600;font-size:0.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(n.ssid)}</div>
                        <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">
                            ${locked ? '<span>Secured</span>' : '<span>Open</span>'}
                            &nbsp;·&nbsp; ${n.signal}%
                        </div>
                    </div>
                    <div style="flex-shrink:0;">
                        ${isConnected
                            ? '<span style="font-size:0.75rem;font-weight:600;color:var(--success);padding:3px 8px;background:var(--success-bg,#dcfce7);border-radius:4px;">Connected</span>'
                            : `<button class="btn btn-primary btn-sm" data-ssid="${encodeURIComponent(n.ssid)}" data-bssid="${encodeURIComponent(n.bssid || '')}" onclick="openWifiConnectModal(decodeURIComponent(this.dataset.ssid), ${locked}, decodeURIComponent(this.dataset.bssid || ''))">Connect</button>`}
                    </div>
                </div>`;
            }).join('');
        }
    } catch (err) {
        list.innerHTML = `<div style="color:var(--danger);font-size:0.875rem;padding:1rem 0;text-align:center;">Scan failed: ${escHtml(err.message)}</div>`;
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" style="margin-right:4px"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>Scan`;
    }
}

function _wifiSignalSvg(bars) {
    const barStyles = [
        { h: 6,  y: 18, opacity: bars >= 1 ? 1 : 0.2 },
        { h: 10, y: 14, opacity: bars >= 2 ? 1 : 0.2 },
        { h: 14, y: 10, opacity: bars >= 3 ? 1 : 0.2 },
        { h: 18, y: 6,  opacity: bars >= 4 ? 1 : 0.2 },
    ];
    const rectsHtml = barStyles.map((b, i) =>
        `<rect x="${4 + i * 5}" y="${b.y}" width="3" height="${b.h}" rx="1" fill="var(--primary)" opacity="${b.opacity}"/>`
    ).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">${rectsHtml}</svg>`;
}

let _wifiConnectSsid = null;
let _wifiConnectBssid = null;
function openWifiConnectModal(ssid, needsPassword, bssid = '') {
    _wifiConnectSsid = ssid;
    _wifiConnectBssid = bssid || null;
    const modal = document.getElementById('wifi-connect-modal');
    const title = document.getElementById('wifi-modal-title');
    const input = document.getElementById('wifi-password-input');
    const err = document.getElementById('wifi-connect-error');
    if (!modal) return;
    title.textContent = `Connect to "${ssid}"`;
    if (input) { input.value = ''; input.style.display = needsPassword ? '' : 'none'; input.previousElementSibling.style.display = needsPassword ? '' : 'none'; }
    if (err) err.style.display = 'none';
    modal.style.display = 'flex';
    if (needsPassword && input) setTimeout(() => input.focus(), 50);
}

function closeWifiModal() {
    const modal = document.getElementById('wifi-connect-modal');
    if (modal) modal.style.display = 'none';
    _wifiConnectSsid = null;
    _wifiConnectBssid = null;
}

async function doWifiConnect() {
    const ssid = _wifiConnectSsid;
    if (!ssid) return;
    const input = document.getElementById('wifi-password-input');
    const errEl = document.getElementById('wifi-connect-error');
    const btn = document.getElementById('wifi-connect-btn');
    const password = input ? input.value : '';
    if (errEl) errEl.style.display = 'none';
    if (btn) { btn.disabled = true; btn.textContent = 'Connecting...'; }

    try {
        const res = await fetch(`${API_BASE}/admin/wifi/connect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ ssid, password, bssid: _wifiConnectBssid })
        });
        const data = await wifiReadJsonResponse(res, 'Connection failed');
        if (data.success) {
            closeWifiModal();
            const newIp = (data.ips || [])[0] || null;
            const newUrl = newIp ? `https://${newIp}` : null;
            const content = document.getElementById('main-content');
            if (content) {
                content.innerHTML = `
                    <div style="max-width:520px;margin:4rem auto;text-align:center;padding:0 1rem;">
                        <div style="width:64px;height:64px;border-radius:50%;background:var(--success-bg,#dcfce7);display:flex;align-items:center;justify-content:center;margin:0 auto 1.25rem;">
                            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="none" viewBox="0 0 24 24" stroke="var(--success)" stroke-width="2">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>
                            </svg>
                        </div>
                        <h2 style="margin:0 0 0.5rem;">Connected!</h2>
                        <p style="color:var(--text-muted);margin:0 0 1.5rem;">Successfully connected to <strong>${escHtml(ssid)}</strong></p>
                        ${newUrl ? `
                        <div style="background:var(--bg-secondary);border-radius:8px;padding:1rem;margin-bottom:1.25rem;">
                            <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:0.4rem;">New IP Address</div>
                            <div style="font-weight:700;font-size:1.1rem;">${escHtml((data.ips||[]).join(', '))}</div>
                        </div>
                        <a href="${escHtml(newUrl)}" class="btn btn-primary" style="display:inline-block;">
                            Open at ${escHtml(newUrl)}
                        </a>` : ''}
                        <div style="margin-top:1rem;">
                            <a href="https://worksync.local" class="btn btn-secondary" style="display:inline-block;">
                                Open https://worksync.local
                            </a>
                        </div>
                    </div>`;
            }
        } else {
            if (errEl) {
                errEl.textContent = data.error || 'Connection failed';
                errEl.style.display = 'block';
            }
        }
    } catch (err) {
        closeWifiModal();
        // Connection may have succeeded but response dropped due to IP change
        const content = document.getElementById('main-content');
        if (content) {
            content.innerHTML = `
                <div style="max-width:520px;margin:4rem auto;text-align:center;padding:0 1rem;">
                    <div style="width:64px;height:64px;border-radius:50%;background:#fef9c3;display:flex;align-items:center;justify-content:center;margin:0 auto 1.25rem;">
                        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="none" viewBox="0 0 24 24" stroke="#ca8a04" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01M12 3a9 9 0 100 18A9 9 0 0012 3z"/>
                        </svg>
                    </div>
                    <h2 style="margin:0 0 0.5rem;">Network Changed</h2>
                    <p style="color:var(--text-muted);margin:0 0 1.5rem;">
                        The connection to <strong>${escHtml(ssid)}</strong> may have succeeded, but the network change caused this page to lose connection.
                    </p>
                    <a href="https://worksync.local" class="btn btn-primary" style="display:inline-block;">
                        Reconnect at https://worksync.local
                    </a>
                    <p style="color:var(--text-muted);font-size:0.8rem;margin-top:1rem;">
                        Or check your router for the device's new IP address.
                    </p>
                </div>`;
        }
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Connect'; }
    }
}

// ============================================================================
// MATERIAL TRACKING
// ============================================================================
let _mtRefreshTimer = null;

async function loadMaterialTracking() {
    const content = document.getElementById('main-content');
    const today = new Date().toISOString().slice(0, 10);

    content.innerHTML = `
        <div class="page-header">
            <div>
                <h1 class="page-title">Material Tracking</h1>
                <p class="page-subtitle">Live feed, workstation output, and WIP per group</p>
            </div>
            <span class="status-badge" id="mt-last-updated"></span>
        </div>
        <div class="card" style="margin-bottom:16px;">
            <div class="card-body" style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;">
                <div>
                    <label class="form-label">Line</label>
                    <select id="mt-line" class="form-control" style="min-width:200px;">
                        <option value="">Select Line</option>
                    </select>
                </div>
                <div>
                    <label class="form-label">Date</label>
                    <input type="date" id="mt-date" class="form-control" value="${today}">
                </div>
                <button class="btn btn-primary" onclick="refreshMaterialTracking()">Load</button>
                <span id="mt-auto-badge" style="font-size:12px;color:var(--text-muted);align-self:center;display:none;">Auto-refreshing every 60s</span>
            </div>
        </div>
        <div id="mt-content"></div>
    `;

    // Load lines
    try {
        const res = await fetch(`${API_BASE}/lines`, { credentials: 'include' });
        const result = await res.json();
        const sel = document.getElementById('mt-line');
        (result.data || []).forEach(l => {
            const opt = document.createElement('option');
            opt.value = l.id;
            opt.textContent = `${l.line_name} (${l.line_code})`;
            sel.appendChild(opt);
        });
        sel.addEventListener('change', refreshMaterialTracking);
        document.getElementById('mt-date').addEventListener('change', refreshMaterialTracking);
    } catch (err) {
        document.getElementById('mt-content').innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    }
}

async function refreshMaterialTracking() {
    const lineId = document.getElementById('mt-line')?.value;
    const date   = document.getElementById('mt-date')?.value;
    const container = document.getElementById('mt-content');
    if (!container) return;
    if (!lineId || !date) { container.innerHTML = ''; return; }

    // Start auto-refresh timer (reset on each explicit call)
    if (_mtRefreshTimer) clearInterval(_mtRefreshTimer);
    document.getElementById('mt-auto-badge').style.display = 'inline';
    _mtRefreshTimer = setInterval(() => {
        if (currentSection !== 'material-tracking') {
            clearInterval(_mtRefreshTimer);
            _mtRefreshTimer = null;
            return;
        }
        refreshMaterialTracking();
    }, 60_000);

    try {
        const res = await fetch(`${API_BASE}/material-tracking?line_id=${lineId}&date=${date}`, { credentials: 'include' });
        const result = await res.json();
        if (!result.success) throw new Error(result.error || 'Failed to load');

        const { line, groups } = result.data;
        const updEl = document.getElementById('mt-last-updated');
        if (updEl) updEl.textContent = `Updated ${new Date().toLocaleTimeString()}`;

        if (!groups.length) {
            container.innerHTML = `<div class="alert alert-info">No workstation plan for this line on ${date}.</div>`;
            return;
        }

        // Collect all hour slots that appear across any workstation
        const allHours = [...new Set(
            groups.flatMap(g => g.workstations.flatMap(ws => Object.keys(ws.hourly).map(Number)))
        )].sort((a, b) => a - b);

        const fmtHour = h => `${String(h).padStart(2,'0')}:00`;

        container.innerHTML = `
            <div style="margin-bottom:8px;color:var(--text-muted);font-size:13px;">
                ${line.line_name} &mdash; ${line.product_name ?? 'No product'} &mdash; Target: <strong>${line.target_units ?? '—'}</strong> pcs
            </div>
            ${groups.map(g => _buildMtGroupCard(g, allHours, fmtHour)).join('')}
        `;
    } catch (err) {
        container.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    }
}

function _buildMtGroupCard(group, allHours, fmtHour) {
    const wipColor = group.wip > 0 ? '#d97706' : '#16a34a';
    const groupLabel = group.group_name ? `Group: ${group.group_name}` : group.group_identifier;

    const wsRows = group.workstations.map((ws, idx) => {
        const isLast = idx === group.workstations.length - 1;
        const hourCells = allHours.map(h => {
            const qty = ws.hourly[h] ?? null;
            return `<td style="text-align:center;padding:6px 10px;${isLast ? 'font-weight:600;' : ''}">${qty != null ? qty : '<span style="color:#d1d5db;">—</span>'}</td>`;
        }).join('');
        const empLabel = ws.emp_name ? `${ws.emp_code} — ${ws.emp_name}` : '<span style="color:#9ca3af;">Unassigned</span>';
        const lastBadge = isLast ? `<span style="background:#dbeafe;color:#1d4ed8;font-size:10px;padding:1px 5px;border-radius:8px;margin-left:4px;">LAST</span>` : '';
        return `
            <tr style="${isLast ? 'background:#f0fdf4;' : ''}">
                <td style="padding:6px 10px;white-space:nowrap;font-weight:${isLast ? '700' : '500'};">${ws.workstation_code}${lastBadge}</td>
                <td style="padding:6px 10px;font-size:12px;color:#6b7280;white-space:nowrap;">${empLabel}</td>
                <td style="padding:6px 10px;text-align:center;font-weight:600;">${ws.cumulative_output}</td>
                ${hourCells}
            </tr>
        `;
    }).join('');

    const hourHeaders = allHours.map(h =>
        `<th style="padding:6px 10px;text-align:center;font-weight:600;white-space:nowrap;">${fmtHour(h)}</th>`
    ).join('');

    return `
        <div class="card" style="margin-bottom:20px;">
            <div class="card-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
                <h3 class="card-title" style="margin:0;">${groupLabel}</h3>
                <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
                    <span style="background:#dcfce7;color:#16a34a;padding:4px 10px;border-radius:12px;font-size:12px;font-weight:700;">
                        Feed: ${group.feed} pcs
                    </span>
                    <span style="background:#dbeafe;color:#1d4ed8;padding:4px 10px;border-radius:12px;font-size:12px;font-weight:700;">
                        Output: ${group.group_output} pcs
                    </span>
                    <span style="background:#fff7ed;color:${wipColor};padding:4px 10px;border-radius:12px;font-size:12px;font-weight:700;">
                        WIP: ${group.wip} pcs
                    </span>
                </div>
            </div>
            <div class="card-body" style="padding:0;overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;font-size:13px;">
                    <thead>
                        <tr style="background:#f9fafb;border-bottom:2px solid #e5e7eb;">
                            <th style="padding:6px 10px;text-align:left;font-weight:600;">Workstation</th>
                            <th style="padding:6px 10px;text-align:left;font-weight:600;">Employee</th>
                            <th style="padding:6px 10px;text-align:center;font-weight:600;">Total</th>
                            ${hourHeaders}
                        </tr>
                    </thead>
                    <tbody>${wsRows}</tbody>
                </table>
            </div>
        </div>
    `;
}
