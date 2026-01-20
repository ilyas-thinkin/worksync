const API_BASE = '/api';

document.addEventListener('DOMContentLoaded', async () => {
    const ok = await requireAuth();
    if (!ok) return;
    setupMobileSidebar();
    loadManagementDashboard();
});

async function requireAuth() {
    try {
        const response = await fetch('/auth/session');
        if (!response.ok) {
            window.location.href = '/';
            return false;
        }
        const result = await response.json();
        if (!result.success || result.role !== 'management') {
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
                <button class="btn btn-secondary" id="mgmt-download">Download Excel</button>
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
                </div>
                <div class="table-container" style="margin-top: 16px;">
                    <table>
                        <thead>
                            <tr>
                                <th>Employee</th>
                                <th>Operation</th>
                                <th>Output</th>
                                <th>Efficiency</th>
                            </tr>
                        </thead>
                        <tbody id="mgmt-employees"></tbody>
                    </table>
                </div>
            </div>
        </div>
    `;

    document.getElementById('mgmt-date').addEventListener('change', refreshManagementData);
    document.getElementById('mgmt-download').addEventListener('click', downloadReport);
    await loadLineOptions();
    refreshManagementData();
}

function downloadReport() {
    const date = document.getElementById('mgmt-date').value;
    window.location.href = `${API_BASE}/reports/daily?date=${date}`;
}

async function loadLineOptions() {
    const select = document.getElementById('mgmt-line-select');
    if (!select) return;
    const response = await fetch(`${API_BASE}/lines`);
    const result = await response.json();
    if (!result.success) return;
    select.innerHTML = result.data
        .filter(line => line.is_active)
        .map(line => `<option value="${line.id}">${line.line_name}</option>`)
        .join('');
    select.addEventListener('change', refreshEmployeeEfficiency);
}

async function refreshManagementData() {
    await Promise.all([
        loadLineMetrics(),
        refreshEmployeeEfficiency()
    ]);
}

async function loadLineMetrics() {
    const date = document.getElementById('mgmt-date').value;
    const stats = document.getElementById('mgmt-stats');
    const body = document.getElementById('mgmt-lines');
    const response = await fetch(`${API_BASE}/lines-metrics?date=${date}`);
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
            <td>${row.product_code || '-'} ${row.product_name || ''}</td>
            <td>${row.target}</td>
            <td>${row.actual_output}</td>
            <td>${row.efficiency_percent}%</td>
            <td>${row.completion_percent}%</td>
        </tr>
    `).join('');
}

async function refreshEmployeeEfficiency() {
    const lineId = document.getElementById('mgmt-line-select').value;
    const date = document.getElementById('mgmt-date').value;
    const tbody = document.getElementById('mgmt-employees');
    if (!lineId) {
        tbody.innerHTML = '<tr><td colspan="4">Select a line</td></tr>';
        return;
    }
    const response = await fetch(`${API_BASE}/supervisor/shift-summary?line_id=${lineId}&date=${date}`);
    const result = await response.json();
    if (!result.success) {
        tbody.innerHTML = `<tr><td colspan="4">${result.error || 'No data'}</td></tr>`;
        return;
    }
    const employees = result.data.employees || [];
    if (!employees.length) {
        tbody.innerHTML = '<tr><td colspan="4">No employee data</td></tr>';
        return;
    }
    tbody.innerHTML = employees.map(emp => `
        <tr>
            <td><strong>${emp.emp_code}</strong><div style="color: var(--secondary); font-size: 12px;">${emp.emp_name}</div></td>
            <td>${emp.operation_code} - ${emp.operation_name}</td>
            <td>${emp.total_output}</td>
            <td>${emp.efficiency_percent || 0}%</td>
        </tr>
    `).join('');
}
