// WorkSync Admin Panel - JavaScript
const API_BASE = '/api';

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
                        <p>Products</p>
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
                        Add Product
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
                                        <th>Product</th>
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
                                    <th>Product</th>
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
                                                <button class="btn btn-secondary btn-sm" onclick="viewLineDetails(${line.id})">Details</button>
                                                <button class="btn btn-primary btn-sm" onclick="viewWorkstationQRs(${line.id}, '${line.line_code}')">WS QR Codes</button>
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

function adminLoadHourOptions() {
    const select = document.getElementById('admin-mgmt-hour-select');
    if (!select) return;
    const hourStart = 8;
    const hourEnd = 19;
    const now = new Date();
    const defaultHour = Math.min(Math.max(now.getHours(), hourStart), hourEnd);
    select.innerHTML = Array.from({ length: hourEnd - hourStart + 1 }).map((_, i) => {
        const value = hourStart + i;
        return `<option value="${value}" ${value === defaultHour ? 'selected' : ''}>${String(value).padStart(2, '0')}:00</option>`;
    }).join('');
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
                        <label class="form-label">Product</label>
                        <select class="form-control" name="current_product_id">
                            <option value="">-- No Product --</option>
                            ${products.map(p => `<option value="${p.id}" ${String(p.id) === String(currentProductId) ? 'selected' : ''}>${p.product_code} - ${p.product_name} (${p.buyer_name || 'No buyer'})</option>`).join('')}
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
                        <p>${line.changeover ? 'Primary Product' : 'Current Product'}</p>
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
                                        ${line.changeover ? '<th>Product</th>' : ''}
                                        <th>Seq</th>
                                        <th>Operation</th>
                                        <th>Product</th>
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

    // Focus search input when opening
    if (dropdown.classList.contains('open')) {
        const search = dropdown.querySelector('.dropdown-search');
        if (search) {
            setTimeout(() => search.focus(), 100);
        }
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

// ============================================================================
// EMPLOYEES
// ============================================================================
let allEmployees = [];
let allLines = [];

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
            ${showActions ? `
                <button class="btn btn-primary" onclick="showEmployeeModal()">
                    <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/>
                    </svg>
                    Add Employee
                </button>
            ` : ''}
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
                    <div style="width: 1px;"></div>
                </div>

                <div class="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>S.No</th>
                                <th>Code</th>
                                <th>Name</th>
                                <th>Designation</th>
                                <th>MP</th>
                                <th>Current Work</th>
                                <th>QR Code</th>
                                <th>Status</th>
                                ${showActions ? '<th>Actions</th>' : ''}
                            </tr>
                        </thead>
                        <tbody id="employees-table-body">
                            ${employees.map((emp, index) => `
                                <tr>
                                    <td>${index + 1}</td>
                                    <td><strong>${emp.emp_code}</strong></td>
                                    <td>${emp.emp_name}</td>
                                    <td>${emp.designation || '-'}</td>
                                    <td>${Number(emp.manpower_factor || 1).toFixed(2)}</td>
                                    <td>${formatEmployeeWork(emp) || '-'}</td>
                                    <td>${emp.qr_code_path ? '<span class="badge badge-success">Yes</span>' : '<span class="badge badge-warning">No</span>'}</td>
                                    <td><span class="badge ${emp.is_active ? 'badge-success' : 'badge-danger'}">${emp.is_active ? 'Active' : 'Inactive'}</span></td>
                                    ${showActions ? `
                                        <td>
                                            <div class="action-btns">
                                                <button class="btn btn-secondary btn-sm" onclick='showEmployeeWorkModal(${JSON.stringify(emp)})'>Assign Work</button>
                                                <button class="btn btn-secondary btn-sm" ${emp.qr_code_path ? '' : 'disabled'} onclick='showEmployeeQrModal(${JSON.stringify(emp)})'>Show QR</button>
                                                <button class="btn btn-secondary btn-sm" onclick='showEmployeeModal(${JSON.stringify(emp)})'>Edit</button>
                                                <button class="btn btn-danger btn-sm" onclick="deleteEmployee(${emp.id})">Delete</button>
                                            </div>
                                        </td>
                                    ` : ''}
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>

                <div class="mt-4" style="color: var(--secondary); font-size: 14px;">
                    Showing ${employees.length} of ${allEmployees.length} employees
                </div>
            </div>
        </div>
    `;
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
    tbody.innerHTML = employees.map((emp, index) => `
        <tr>
            <td>${index + 1}</td>
            <td><strong>${emp.emp_code}</strong></td>
            <td>${emp.emp_name}</td>
            <td>${emp.designation || '-'}</td>
            <td>${Number(emp.manpower_factor || 1).toFixed(2)}</td>
            <td>${formatEmployeeWork(emp) || '-'}</td>
            <td>${emp.qr_code_path ? '<span class="badge badge-success">Yes</span>' : '<span class="badge badge-warning">No</span>'}</td>
            <td><span class="badge ${emp.is_active ? 'badge-success' : 'badge-danger'}">${emp.is_active ? 'Active' : 'Inactive'}</span></td>
            ${showActions ? `
                <td>
                    <div class="action-btns">
                        <button class="btn btn-secondary btn-sm" onclick='showEmployeeWorkModal(${JSON.stringify(emp)})'>Assign Work</button>
                        <button class="btn btn-secondary btn-sm" ${emp.qr_code_path ? '' : 'disabled'} onclick='showEmployeeQrModal(${JSON.stringify(emp)})'>Show QR</button>
                        <button class="btn btn-secondary btn-sm" onclick='showEmployeeModal(${JSON.stringify(emp)})'>Edit</button>
                        <button class="btn btn-danger btn-sm" onclick="deleteEmployee(${emp.id})">Delete</button>
                    </div>
                </td>
            ` : ''}
        </tr>
    `).join('');
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
                    <h1 class="page-title">Products</h1>
                    <p class="page-subtitle">Manage products and their process flows. Line assignment is handled in Line Product Setup.</p>
                </div>
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                    <button class="btn btn-primary" onclick="showProductModal()">
                        <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/>
                        </svg>
                        Add Product
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
                                    <th>Style No</th>
                                    <th>Description</th>
                                    <th>Target</th>
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
                                        <td colspan="11" class="text-center" style="padding: 40px;">
                                            No products found. Click "Add Product" to create one.
                                        </td>
                                    </tr>
                                ` : products.map(prod => `
                                    <tr>
                                        <td>${prod.buyer_name || '-'}</td>
                                        <td><strong>${prod.product_code}</strong></td>
                                        <td>${prod.product_name}</td>
                                        <td>${prod.target_qty || 0}</td>
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
                                        <td>
                                            <div class="action-btns">
                                                <button class="btn btn-secondary btn-sm" onclick="viewProductProcess(${prod.id})">Process Flow</button>
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
                        <label class="form-label">Target Qty</label>
                        <input type="number" class="form-control" name="target_qty" value="${prod?.target_qty || 0}" min="0">
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
                                    <th>Product</th>
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
                        <label class="form-label">Operation Code *</label>
                        <input type="text" class="form-control" name="operation_code" value="${op?.operation_code || ''}" required placeholder="e.g., OP_072">
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
                        <label class="form-label">Product *</label>
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
    const today = new Date().toISOString().slice(0, 10);
    content.innerHTML = `
        <div class="ie-section">
            <div class="page-header">
                <div>
                    <h1 class="page-title">Line Product Setup</h1>
                    <p class="page-subtitle">Set the main product and changeover product for each line.</p>
                </div>
                <div class="ie-actions">
                    <div class="ie-date">
                        <label for="plan-date">Date</label>
                        <input type="date" id="plan-date" value="${today}">
                    </div>
                    <button onclick="openDailyPlanPrintModal()" style="padding:8px 16px;background:#1e40af;color:#fff;border:none;border-radius:6px;font-weight:600;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:6px;">
                        &#9113; Print / Export
                    </button>
                    <button onclick="openPlanUploadModal()" style="padding:8px 16px;background:#1d6f42;color:#fff;border:none;border-radius:6px;font-weight:600;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:6px;">
                        &#8679; Upload Plan
                    </button>
                </div>
            </div>
            <div class="alert alert-info" style="margin-bottom:16px;">
                Primary product = outgoing product. Incoming product = next product (during changeover).
                Use "Changeover Up To" to select the process sequence already switched to the incoming product.
            </div>
            <div class="card">
                <div class="card-header">
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
    document.getElementById('plan-date').addEventListener('change', loadDailyPlanData);
    loadDailyPlanData();
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
            <a href="/api/lines/plan-upload-template" download
               style="display:inline-flex;align-items:center;gap:6px;padding:8px 16px;background:#f0fdf4;color:#1d6f42;border:1px solid #bbf7d0;border-radius:6px;font-size:13px;font-weight:600;text-decoration:none;margin-bottom:20px;">
                &#8595; Download Template
            </a>
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

async function submitPlanUpload() {
    const fileInput = document.getElementById('plan-upload-file');
    const resultDiv = document.getElementById('plan-upload-result');
    const btn = document.getElementById('plan-upload-btn');

    if (!fileInput?.files?.[0]) {
        resultDiv.innerHTML = '<div style="color:#dc2626;font-size:13px;">Please select an Excel file first.</div>';
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Uploading\u2026';
    resultDiv.innerHTML = '<div style="color:#6b7280;font-size:13px;">Processing\u2026</div>';

    const fd = new FormData();
    fd.append('file', fileInput.files[0]);

    try {
        const r = await fetch('/api/lines/plan-upload-excel', { method: 'POST', body: fd });
        const data = await r.json();

        if (!data.success) {
            resultDiv.innerHTML = `<div style="background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;border-radius:6px;padding:10px 12px;font-size:13px;">\u26a0\ufe0f ${data.error}</div>`;
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
        btn.disabled = false;
        btn.textContent = 'Upload';

        // Reload the daily plan if the uploaded date matches the current view
        const planDateEl = document.getElementById('plan-date');
        if (planDateEl && planDateEl.value === s.date) loadDailyPlanData();

    } catch (err) {
        resultDiv.innerHTML = `<div style="background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;border-radius:6px;padding:10px 12px;font-size:13px;">\u26a0\ufe0f ${err.message}</div>`;
        btn.disabled = false;
        btn.textContent = 'Upload';
    }
}

async function loadDailyPlanData() {
    const date = document.getElementById('plan-date').value;
    const container = document.getElementById('daily-plan-table');
    container.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';
    try {
        const response = await fetch(`/api/daily-plans?date=${date}`);
        const result = await response.json();
        if (!result.success) {
            container.innerHTML = `<div class="alert alert-danger">${result.error}</div>`;
            return;
        }
        const { plans, lines, products, changeover_enabled } = result.data;
        window.dailyPlanProducts = products;
        window.changeoverEnabled = changeover_enabled !== false;
        const planMap = new Map(plans.map(plan => [String(plan.line_id), plan]));
        container.innerHTML = `
            <table>
                <thead>
                    <tr>
                        <th>Line</th>
                        <th>Product (Primary)</th>
                        <th>Target</th>
                        <th>Incoming Product</th>
                        <th>Incoming Target</th>
                        <th>Changeover Progress</th>
                        <th>Overtime</th>
                        <th>Status</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody>
                    ${lines.map(line => {
                        const plan = planMap.get(String(line.id));
                        const locked = plan?.is_locked;
                        const selectedProduct = plan?.product_id || line.current_product_id || '';
                        const selectedTarget = plan?.target_units ?? line.target_units ?? 0;
                        const selectedIncoming = plan?.incoming_product_id || '';
                        const selectedIncomingTarget = plan?.incoming_target_units || 0;
                        const selectedChangeover = plan?.changeover_sequence ?? 0;
                        const planExists = Boolean(plan?.id);
                        const hasChangeover = !!plan?.incoming_product_id;
                        const otMins = plan?.overtime_minutes || 0;
                        const otTarget = plan?.overtime_target || 0;
                        const hasOT = otMins > 0 || otTarget > 0;
                        const otLabel = hasOT
                            ? `+${otMins >= 60 ? Math.floor(otMins/60)+'h '+(otMins%60 ? (otMins%60)+'m' : '') : otMins+'m'} / +${otTarget} units`.trim()
                            : '—';
                        return `
                            <tr>
                                <td>
                                    <strong>${line.line_code}</strong>
                                    <div style="color: var(--secondary); font-size: 12px;">${line.line_name}</div>
                                    ${hasChangeover ? '<span style="background:#fef3c7;color:#92400e;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:600;">CHANGEOVER</span>' : ''}
                                </td>
                                <td>
                                    <select class="form-control" id="plan-product-${line.id}" ${locked ? 'disabled' : ''}>
                                        <option value="">Select product</option>
                                        ${products.map(product => `
                                            <option value="${product.id}" ${Number(selectedProduct) === product.id ? 'selected' : ''}>
                                                ${product.product_code} - ${product.product_name}
                                            </option>
                                        `).join('')}
                                    </select>
                                </td>
                                <td>
                                    <input type="number" class="form-control" id="plan-target-${line.id}" min="0" value="${selectedTarget}" style="width:90px" ${locked ? 'disabled' : ''}>
                                </td>
                                <td>
                                    <select class="form-control" id="plan-incoming-${line.id}" ${locked || changeover_enabled === false ? 'disabled' : ''}>
                                        <option value="">None (no changeover)</option>
                                        ${products.map(product => `
                                            <option value="${product.id}" ${Number(selectedIncoming) === product.id ? 'selected' : ''}>
                                                ${product.product_code} - ${product.product_name}
                                            </option>
                                        `).join('')}
                                    </select>
                                </td>
                                <td>
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
                                    <div style="font-size:13px;${hasOT ? 'color:#7c3aed;font-weight:600;' : 'color:#9ca3af;'}">${otLabel}</div>
                                    ${planExists && !locked ? `<button class="btn btn-sm" style="margin-top:4px;font-size:11px;padding:2px 8px;background:#ede9fe;color:#6d28d9;border:1px solid #c4b5fd;" onclick="openOvertimeModal(${line.id})">Set OT</button>` : ''}
                                    ${hasOT && planExists && !locked ? `<button class="btn btn-sm" style="margin-top:4px;margin-left:2px;font-size:11px;padding:2px 8px;background:#fee2e2;color:#b91c1c;border:1px solid #fca5a5;" onclick="clearOvertime(${line.id})">Clear</button>` : ''}
                                </td>
                                <td>
                                    <span class="status-badge" style="${locked ? 'background:#fee2e2;color:#b91c1c;' : 'background:#dcfce7;color:#15803d;'}">
                                        ${locked ? 'Locked' : 'Open'}
                                    </span>
                                </td>
                                <td>
                                    <div class="action-btns">
                                        <button class="btn btn-secondary btn-sm" onclick="saveDailyPlan(${line.id})" ${locked ? 'disabled' : ''}>Save</button>
                                        <button class="btn btn-primary btn-sm" onclick="toggleLineDetails(${line.id})" ${!selectedProduct ? 'disabled' : ''} title="View and assign processes to workstations">Details</button>
                                        <button class="btn btn-danger btn-sm" onclick="lockDailyPlan(${line.id})" ${!planExists || locked ? 'disabled' : ''}>Lock</button>
                                        <button class="btn btn-secondary btn-sm" onclick="unlockDailyPlan(${line.id})" ${!planExists || !locked ? 'disabled' : ''}>Unlock</button>
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

async function toggleLineDetails(lineId) {
    const date = document.getElementById('plan-date')?.value || new Date().toISOString().slice(0, 10);
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
        _ldData = { lineId, date, data: result.data };
        // Update header with line name from API
        const titleEl = overlay.querySelector('#ld-overlay-title');
        if (titleEl && result.data.line) {
            titleEl.textContent = (result.data.line.line_code || '') + (result.data.line.line_name ? ' \u2014 ' + result.data.line.line_name : '');
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

// Group processes by workstation code, computing SAM sum + workload per group
function _buildWsGroups(processes, taktSecs, useOT) {
    const groups = [];
    const indexMap = new Map();
    processes.forEach(p => {
        const ws = (p.workstation_code || '').trim();
        const key = ws || `__u_${p.id}`;
        if (!indexMap.has(key)) {
            indexMap.set(key, groups.length);
            groups.push({ ws, processes: [], sam: 0, employee_id: null, emp_name: '', emp_code: '', group_name: '', is_ot_skipped: false });
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
            if (empId) { g.employee_id = empId; g.emp_name = empName; g.emp_code = empCode; }
        }
        if (!g.group_name && (p.group_name || '').trim()) g.group_name = (p.group_name || '').trim();
        // is_ot_skipped is the same for every process in the same workstation
        if (p.is_ot_skipped) g.is_ot_skipped = true;
    });
    groups.forEach((g, i) => {
        g.workload_pct = (taktSecs > 0 && g.ws) ? (g.sam / taktSecs) * 100 : null;
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
function ldEmpPickerToggle(pickerEl, lineId) {
    const dropdown = pickerEl.querySelector('.ld-emp-dropdown');
    const isOpen = dropdown.style.display !== 'none';
    // Close all open pickers first
    document.querySelectorAll('.ld-emp-dropdown').forEach(d => { d.style.display = 'none'; });
    if (!isOpen) {
        dropdown.style.display = 'block';
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
    syncEmpDropdowns(lineId);
}

// Close any open picker when clicking outside
document.addEventListener('click', e => {
    if (!e.target.closest('.ld-emp-picker')) {
        document.querySelectorAll('.ld-emp-dropdown').forEach(d => { d.style.display = 'none'; });
    }
}, true);

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
        return `qrcodes/workstations/${lineCode}/ws_${lineCode}_${norm}.png`;
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
            const regEff   = (regTakt > 0 && g.ws) ? (g.sam / regTakt) * 100 : null;
            const otEff    = (hasOT && wsOtSecs > 0 && otTakt > 0 && g.ws) ? (g.sam / otTakt) * 100 : null;
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
            return `<tr style="background:${g.color};${rowOpacity}" data-process-id="${p.id}">
                <td style="text-align:center;font-weight:600;">${p.sequence_number}</td>
                <td><input type="text" class="form-control ld-group" style="font-size:0.82em;padding:3px 6px;width:64px;" value="${(p.group_name||'').trim()}" placeholder="G1" data-pid="${p.id}" onblur="recolorDetailRows(${lineId})"></td>
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
                <label style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px;">Product (Primary)</label>
                <select id="ld-product-${lineId}" class="form-control" style="font-size:0.88em;" ${lockedAttr}>
                    ${productOpts}
                </select>
            </div>
            <div style="min-width:90px;">
                <label style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px;">Target</label>
                <input type="number" id="ld-target-${lineId}" class="form-control" style="font-size:0.88em;width:90px;" value="${planPrimaryTarget}" min="0" ${lockedAttr}>
            </div>
            <div style="flex:1;min-width:200px;">
                <label style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px;">Changeover Product</label>
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
            <div style="margin-left:auto;">
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

    const error = _validateWsSequence(proposed);
    if (error) {
        // Revert the input — do NOT redraw the table
        input.value = prevWs;
        input.style.borderColor = '#ef4444';
        input.style.background = '#fee2e2';
        // Flash border red then restore after a moment
        setTimeout(() => {
            input.style.borderColor = '';
            input.style.background = '';
        }, 2500);
        _showWsSeqError(error);
        return;
    }

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
    // Collect group/ws per process from text inputs.
    // In OT mode write employee back to ot_employee_id so regular assignments are preserved.
    const pidState = new Map();
    tbody.querySelectorAll('tr[data-process-id]').forEach(row => {
        const pid = parseInt(row.dataset.processId, 10);
        const ws = row.querySelector('.ld-ws')?.value.trim() || '';
        const group = row.querySelector('.ld-group')?.value.trim() || '';
        const empVal = wsEmpMap.get(ws) || null;
        const state = { workstation_code: ws, group_name: group || null };
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
    // Build a set of process IDs that are out of sequence
    const badPids = new Set();
    let maxWsNum = 0;
    for (const p of processes) {
        const ws = (p.workstation_code || '').trim();
        if (!ws) continue;
        const wsNum = parseInt(ws.replace(/\D/g, '') || '0', 10);
        if (wsNum < maxWsNum) badPids.add(p.id);
        else maxWsNum = Math.max(maxWsNum, wsNum);
    }
    tbody.querySelectorAll('tr[data-process-id]').forEach(row => {
        const pid = parseInt(row.dataset.processId, 10);
        const wsInput = row.querySelector('.ld-ws');
        if (!wsInput) return;
        if (badPids.has(pid)) {
            wsInput.style.borderColor = '#ef4444';
            wsInput.style.background = '#fee2e2';
            wsInput.title = 'Workstation is out of sequence — must be ≥ the workstation of the preceding process.';
        } else {
            wsInput.style.borderColor = '';
            wsInput.style.background = '';
            wsInput.title = '';
        }
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
    let maxWsNum = 0;
    let maxWsCode = '';
    for (const p of processes) {
        const ws = (p.workstation_code || '').trim();
        if (!ws) continue; // unassigned — skip
        const wsNum = parseInt(ws.replace(/\D/g, '') || '0', 10);
        if (wsNum < maxWsNum) {
            return (
                `Workstation Assignment Conflict: Process (Seq ${p.sequence_number} — ` +
                `${p.operation_name || p.operation_code || 'Process #' + p.id}) cannot be assigned to ` +
                `Workstation "${ws}" because a preceding process is already assigned to Workstation "${maxWsCode}", ` +
                `which is further along the line. Workstation assignments must follow the process sequence order. ` +
                `Please revise the layout to maintain sequential flow.`
            );
        }
        if (wsNum > maxWsNum) {
            maxWsNum = wsNum;
            maxWsCode = ws;
        }
    }
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
    const rows = activeProcesses.map(p => ({
        process_id: p.id,
        group_name: p.group_name || null,
        workstation_code: p.workstation_code || '',
        employee_id: wsEmpMap.get(p.workstation_code) || null
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
    const targetUnits = document.getElementById(`plan-target-${lineId}`).value;
    const incomingProductId = document.getElementById(`plan-incoming-${lineId}`).value;
    const incomingTargetUnits = document.getElementById(`plan-incoming-target-${lineId}`).value;
    if (!productId) {
        showToast('Select a product for the line', 'error');
        return;
    }
    if (incomingProductId && incomingProductId === productId) {
        showToast('Incoming product must be different from primary product', 'error');
        return;
    }
    try {
        const changeoverEnabled = window.changeoverEnabled !== false;
        const response = await fetch('/api/daily-plans', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                line_id: lineId,
                product_id: productId,
                work_date: date,
                target_units: targetUnits,
                incoming_product_id: changeoverEnabled ? (incomingProductId || null) : null,
                incoming_target_units: changeoverEnabled ? (incomingTargetUnits || 0) : 0
            })
        });
        const result = await response.json();
        if (!result.success) {
            showToast(result.error, 'error');
            return;
        }
        showToast('Daily plan saved', 'success');
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

// ============================================================================
// Overtime Plan
// ============================================================================
function openOvertimeModal(lineId) {
    const existing = document.getElementById('ot-modal-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'ot-modal-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:2000;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
        <div style="background:#fff;border-radius:12px;padding:28px;width:380px;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
            <h3 style="margin:0 0 8px;font-size:17px;font-weight:700;color:#1e293b;">Set Overtime Plan</h3>
            <p style="margin:0 0 20px;font-size:13px;color:#64748b;">Enter the overtime duration and additional production target for this line.</p>
            <div style="margin-bottom:14px;">
                <label style="display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:4px;">OT Duration (minutes)</label>
                <input type="number" id="ot-minutes-input" min="0" max="480" value="60" class="form-control" style="width:100%;" placeholder="e.g. 60">
                <div style="font-size:11px;color:#9ca3af;margin-top:3px;">Typical: 30, 60, 90, 120 minutes</div>
            </div>
            <div style="margin-bottom:20px;">
                <label style="display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:4px;">Additional Target (units)</label>
                <input type="number" id="ot-target-input" min="0" value="0" class="form-control" style="width:100%;" placeholder="e.g. 50">
                <div style="font-size:11px;color:#9ca3af;margin-top:3px;">Extra units to produce during overtime</div>
            </div>
            <div style="display:flex;gap:8px;justify-content:flex-end;">
                <button class="btn btn-secondary" onclick="document.getElementById('ot-modal-overlay').remove()">Cancel</button>
                <button class="btn btn-primary" onclick="saveOvertime(${lineId})" style="background:#7c3aed;border-color:#7c3aed;">Save Overtime</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.getElementById('ot-minutes-input').focus();
}

async function saveOvertime(lineId) {
    const date = document.getElementById('plan-date').value;
    const mins = parseInt(document.getElementById('ot-minutes-input').value, 10);
    const target = parseInt(document.getElementById('ot-target-input').value, 10);
    if (isNaN(mins) || mins < 0) { showToast('Please enter a valid OT duration', 'error'); return; }
    if (isNaN(target) || target < 0) { showToast('Please enter a valid OT target', 'error'); return; }
    try {
        const res = await fetch('/api/daily-plans/overtime', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ line_id: lineId, work_date: date, overtime_minutes: mins, overtime_target: target })
        });
        const result = await res.json();
        if (!result.success) { showToast(result.error, 'error'); return; }
        document.getElementById('ot-modal-overlay')?.remove();
        showToast('Overtime plan saved', 'success');
        loadDailyPlanData();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function clearOvertime(lineId) {
    const date = document.getElementById('plan-date').value;
    try {
        const res = await fetch('/api/daily-plans/overtime', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ line_id: lineId, work_date: date, overtime_minutes: 0, overtime_target: 0 })
        });
        const result = await res.json();
        if (!result.success) { showToast(result.error, 'error'); return; }
        showToast('Overtime cleared', 'success');
        loadDailyPlanData();
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
    modal.innerHTML = `
        <div style="background:#fff;border-radius:12px;padding:22px 24px 18px;width:700px;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,0.22);">
            <h3 style="margin:0 0 14px;font-size:17px;font-weight:700;color:#111827;">Print / Export Daily Plan</h3>
            <div id="dp-print-lines-config" style="flex:1;overflow-y:auto;min-height:60px;">
                <div style="text-align:center;padding:24px;color:#6b7280;font-size:13px;">Loading plans\u2026</div>
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

    const date = document.getElementById('plan-date').value;
    try {
        const resp   = await fetch(`/api/daily-plans?date=${date}`);
        const result = await resp.json();
        if (!result.success) throw new Error(result.error);
        const { plans, lines } = result.data;
        const planMap     = new Map(plans.map(p => [String(p.line_id), p]));
        const activeLines = lines.filter(l => planMap.has(String(l.id)));

        // Initialise per-line config with defaults
        window._dpPrintConfig = {};
        activeLines.forEach(line => {
            const plan = planMap.get(String(line.id));
            window._dpPrintConfig[line.id] = {
                start:     '08:00',
                end:       '17:00',
                lunchMins: 60,
                otMins:    parseInt(plan.overtime_minutes  || 0, 10),
                otTarget:  parseInt(plan.overtime_target   || 0, 10),
                productId: plan.product_id,
                wsOt:      {},      // { [wsCode]: overrideMinutes }
                wsLoaded:  false,
            };
        });

        if (!activeLines.length) {
            document.getElementById('dp-print-lines-config').innerHTML =
                '<div style="color:#6b7280;font-size:13px;padding:8px 0;">No plans set for this date.</div>';
            return;
        }
        _renderDpPrintConfig(activeLines, planMap);
    } catch (err) {
        document.getElementById('dp-print-lines-config').innerHTML =
            `<div style="color:#dc2626;font-size:13px;">\u26a0 ${err.message}</div>`;
    }
}

function dpToggleSelectAll(checked) {
    document.querySelectorAll('[id^="dp-sel-"]:not(#dp-sel-all)').forEach(cb => { cb.checked = checked; });
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
    const date     = document.getElementById('plan-date').value;
    const statusEl = document.getElementById('dp-print-status');
    const config   = window._dpPrintConfig || {};
    if (!Object.keys(config).length) { statusEl.textContent = 'Open this modal from the daily plans page first.'; return; }
    // Only print selected (checked) lines
    const selectedIds = Object.keys(config).filter(id => {
        const cb = document.getElementById(`dp-sel-${id}`);
        return !cb || cb.checked;
    });
    if (!selectedIds.length) { statusEl.textContent = 'No lines selected. Tick at least one line.'; return; }
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
                const key = ws || `__u_${p.id}`;
                if (!wsIdxMap.has(key)) {
                    wsIdxMap.set(key, groups.length);
                    groups.push({ ws, processes: [], sam: 0, group_name: '', emp_name: '', emp_code: '' });
                }
                const g = groups[wsIdxMap.get(key)];
                g.processes.push(p);
                g.sam += parseFloat(p.operation_sah || 0) * 3600;
                if (!g.group_name && p.group_name) g.group_name = p.group_name;
                if (!g.emp_name && p.emp_name) { g.emp_name = p.emp_name; g.emp_code = p.emp_code || ''; }
            });
            groups.forEach(g => {
                g.reg_eff = regTakt > 0 ? (g.sam / regTakt) * 100 : null;
                // Per-workstation OT: use WS override if set, else line OT
                const wsOtMins = hasLineOT ? ((g.ws && cfg.wsOt[g.ws] != null) ? cfg.wsOt[g.ws] : cfg.otMins) : 0;
                const otSecs   = wsOtMins * 60;
                const otTakt   = (otSecs > 0 && otTarget > 0) ? otSecs / otTarget : 0;
                g.ot_eff    = (hasLineOT && wsOtMins > 0 && otTakt > 0) ? (g.sam / otTakt) * 100 : null;
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
    const date     = document.getElementById('plan-date').value;
    const statusEl = document.getElementById('dp-print-status');
    const config   = window._dpPrintConfig || {};
    if (!Object.keys(config).length) { statusEl.textContent = 'Open this modal from the daily plans page first.'; return; }
    // Only export selected (checked) lines
    const filteredConfig = {};
    Object.keys(config).forEach(id => {
        const cb = document.getElementById(`dp-sel-${id}`);
        if (!cb || cb.checked) filteredConfig[id] = config[id];
    });
    if (!Object.keys(filteredConfig).length) { statusEl.textContent = 'No lines selected. Tick at least one line.'; return; }
    statusEl.textContent = 'Generating Excel\u2026';
    try {
        const resp = await fetch('/api/daily-plans/export-excel', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ date, lineConfigs: filteredConfig }),
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
// OSM REPORT — Stagewise Hourly OSM Report
// ============================================================================
async function loadOsmReport() {
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
                <button class="btn btn-secondary" onclick="refreshOsmReport()">Refresh</button>
                <button class="btn btn-secondary" onclick="printOsmReport()">Print</button>
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
            sel.addEventListener('change', refreshOsmReport);
        }
    } catch (e) { /* ignore */ }

    document.getElementById('osm-date').addEventListener('change', refreshOsmReport);
}

async function refreshOsmReport() {
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
                        No workstation plan found for <strong>${data.line_name}</strong> on <strong>${date}</strong>.<br>
                        Upload a line plan or generate workstations first.
                    </div>
                </div>`;
            return;
        }

        container.innerHTML = _buildOsmTable(data);
    } catch (err) {
        container.innerHTML = `<div class="card"><div class="card-body" style="color:#dc2626;">Error: ${err.message}</div></div>`;
    }
}

function _buildOsmTable(data) {
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

    return `<div class="card" id="osm-print-area">
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
            <table style="border-collapse:collapse;white-space:nowrap;width:100%;" id="osm-table">
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

function printOsmReport() {
    const area = document.getElementById('osm-print-area');
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
