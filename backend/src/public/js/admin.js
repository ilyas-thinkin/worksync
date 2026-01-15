// WorkSync Admin Panel - JavaScript
const API_BASE = '/api';

// Current active section
let currentSection = 'dashboard';
let currentView = { type: 'section', section: 'dashboard' };
let realtimeRefreshTimer = null;
const isIeMode = typeof window !== 'undefined' && window.IS_IE;

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    loadSection('dashboard');
    setupNavigation();
    setupRealtime();
});

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
        });
    });
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
        `;
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
        const response = await fetch(`${API_BASE}/lines`);
        const result = await response.json();
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
                                    <th>Efficiency</th>
                                    <th>Status</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${lines.map(line => `
                                    <tr>
                                        <td>${line.id}</td>
                                        <td><strong>${line.line_code}</strong></td>
                                        <td>${line.line_name}</td>
                                        <td>${line.hall_location || '-'}</td>
                                        <td>${line.current_product_code ? `${line.current_product_code} - ${line.current_product_name || ''}` : '-'}</td>
                                        <td>${line.target_units || 0}</td>
                                        <td>${Number(line.efficiency || 0).toFixed(2)}</td>
                                        <td><span class="badge ${line.is_active ? 'badge-success' : 'badge-danger'}">${line.is_active ? 'Active' : 'Inactive'}</span></td>
                                        <td>
                                            <div class="action-btns">
                                                <button class="btn btn-secondary btn-sm" onclick="viewLineDetails(${line.id})">Details</button>
                                                <button class="btn btn-secondary btn-sm" onclick='showLineModal(${JSON.stringify(line)})'>Edit</button>
                                                <button class="btn btn-danger btn-sm" onclick="deleteLine(${line.id})">Delete</button>
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

function showLineModal(line = null) {
    const isEdit = line !== null;
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
                        <label class="form-label">Target (units)</label>
                        <input type="number" class="form-control" name="target_units" min="0" value="${line?.target_units || 0}">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Efficiency</label>
                        <input type="number" class="form-control" name="efficiency" min="0" step="0.01" value="${line?.efficiency || 0}">
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
    if (data.efficiency === '') data.efficiency = 0;

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

async function deleteLine(id) {
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

async function viewLineDetails(lineId) {
    currentView = { type: 'line', lineId };
    const content = document.getElementById('main-content');
    content.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';

    try {
        const [detailsResponse, assignmentsResponse] = await Promise.all([
            fetch(`${API_BASE}/lines/${lineId}/details`),
            fetch(`${API_BASE}/process-assignments`)
        ]);
        const result = await detailsResponse.json();
        if (!result.success) {
            content.innerHTML = `<div class="alert alert-danger">${result.error}</div>`;
            return;
        }
        let { line, processes, assignments, employees, allAssignments } = result.data;
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

            <div class="stats-grid" style="grid-template-columns: repeat(4, 1fr);">
                <div class="stat-card">
                    <div class="stat-info">
                        <h3>${line.product_code ? `${line.product_code}` : '-'}</h3>
                        <p>Current Product</p>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-info">
                        <h3>${line.target_units || 0}</h3>
                        <p>Target (units)</p>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-info">
                        <h3>${Number(line.efficiency || 0).toFixed(2)}</h3>
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
                                        <th>Seq</th>
                                        <th>Operation</th>
                                        <th>Category</th>
                                        <th>QR</th>
                                        <th>Cycle Time</th>
                                        <th>SAH</th>
                                        <th>Employee</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${processes.map(proc => {
                                        const assignment = assignmentMap.get(proc.id);
                                        return `
                                            <tr>
                                                <td><span class="process-step-num">${proc.sequence_number}</span></td>
                                                <td>${proc.operation_code} - ${proc.operation_name}</td>
                                                <td><span class="badge badge-info">${proc.operation_category}</span></td>
                                                <td>
                                                    <button class="btn btn-secondary btn-sm" ${proc.qr_code_path ? '' : 'disabled'} onclick='showOperationQrModal(${JSON.stringify(proc)})'>View</button>
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
                                    }).join('')}
                                </tbody>
                            </table>
                        </div>
                    `}
                </div>
            </div>
        `;
        recomputeEmployeeDropdownOptions();
    } catch (err) {
        content.innerHTML = `<div class="alert alert-danger">Error loading line details: ${err.message}</div>`;
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
    const dropdowns = Array.from(document.querySelectorAll('.employee-dropdown'));
    dropdowns.forEach(dd => {
        if (dd.dataset.processId !== String(processId)) {
            dd.classList.remove('open');
        }
    });
    const dropdown = document.querySelector(`.employee-dropdown[data-process-id="${processId}"]`);
    if (!dropdown) return;
    dropdown.classList.toggle('open');
    const search = dropdown.querySelector('.dropdown-search');
    if (search) {
        search.focus();
        search.select();
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
                                <th>Efficiency</th>
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
                                    <td>${Number(emp.efficiency || 0).toFixed(2)}</td>
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
            <td>${Number(emp.efficiency || 0).toFixed(2)}</td>
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

function getOperationQrUrl(qrPath) {
    return getEmployeeQrUrl(qrPath);
}

function showOperationQrModal(op) {
    if (!op || !op.qr_code_path) return;
    const qrUrl = getOperationQrUrl(op.qr_code_path);
    const title = op.operation_code ? `${op.operation_code}` : 'Operation';
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.id = 'operation-qr-modal';
    modal.innerHTML = `
        <div class="modal" style="max-width: 420px;">
            <div class="modal-header">
                <h3 class="modal-title">QR Code - ${title}</h3>
                <button class="modal-close" onclick="closeModal('operation-qr-modal')">
                    <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                    </svg>
                </button>
            </div>
            <div class="modal-body" style="text-align: center;">
                <img src="${qrUrl}" alt="QR Code for ${title}" style="max-width: 100%; height: auto;">
                <div style="margin-top: 12px; color: var(--secondary); font-size: 14px;">
                    ${op.operation_name || ''}
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="closeModal('operation-qr-modal')">Close</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    setTimeout(() => modal.classList.add('active'), 10);
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
                    <p class="page-subtitle">Manage products and their process flows</p>
                </div>
                <button class="btn btn-primary" onclick="showProductModal()">
                    <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/>
                    </svg>
                    Add Product
                </button>
            </div>

            <div class="card">
                <div class="card-body">
                    <div class="table-container">
                        <table>
                            <thead>
                                <tr>
                                    <th>Code</th>
                                    <th>Name</th>
                                    <th>Category</th>
                                    <th>Line</th>
                                    <th>Operations</th>
                                    <th>Total SAH</th>
                                    <th>Status</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${products.length === 0 ? `
                                    <tr>
                                        <td colspan="8" class="text-center" style="padding: 40px;">
                                            No products found. Click "Add Product" to create one.
                                        </td>
                                    </tr>
                                ` : products.map(prod => `
                                    <tr>
                                        <td><strong>${prod.product_code}</strong></td>
                                        <td>${prod.product_name}</td>
                                        <td>${prod.category || '-'}</td>
                                        <td>${prod.line_names || '-'}</td>
                                        <td><span class="badge badge-info">${prod.operations_count} ops</span></td>
                                        <td>${parseFloat(prod.total_sah || 0).toFixed(4)} hrs</td>
                                        <td><span class="badge ${prod.is_active ? 'badge-success' : 'badge-danger'}">${prod.is_active ? 'Active' : 'Inactive'}</span></td>
                                        <td>
                                            <div class="action-btns">
                                                <button class="btn btn-secondary btn-sm" onclick="viewProductProcess(${prod.id})">Process Flow</button>
                                                <button class="btn btn-secondary btn-sm" onclick='showProductModal(${JSON.stringify(prod)})'>Edit</button>
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

function showProductModal(prod = null) {
    const isEdit = prod !== null;
    const lines = allLines || [];
    const selectedLineIds = new Set(
        lines
            .filter(line => line.current_product_id == prod?.id)
            .map(line => String(line.id))
    );
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
                        <label class="form-label">Product Code *</label>
                        <input type="text" class="form-control" name="product_code" value="${prod?.product_code || ''}" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Product Name *</label>
                        <input type="text" class="form-control" name="product_name" value="${prod?.product_name || ''}" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Description</label>
                        <textarea class="form-control" name="product_description" rows="3">${prod?.product_description || ''}</textarea>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Category</label>
                        <input type="text" class="form-control" name="category" value="${prod?.category || ''}" placeholder="e.g., WALLET, BAG">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Production Lines</label>
                        <div class="checkbox-grid">
                            ${lines.map(l => `
                                <label class="checkbox-card">
                                    <input type="checkbox" name="line_ids" value="${l.id}" ${selectedLineIds.has(String(l.id)) ? 'checked' : ''}>
                                    <span class="checkbox-label">${l.line_name}</span>
                                </label>
                            `).join('')}
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
    const lineIds = Array.from(form.querySelectorAll('input[name="line_ids"]:checked'))
        .map(input => input.value)
        .filter(Boolean);
    data.line_ids = lineIds;

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

        const totalSah = processes.reduce((sum, p) => sum + parseFloat(p.operation_sah || 0), 0);
        const totalCycleTime = processes.reduce((sum, p) => sum + parseInt(p.cycle_time_seconds || 0), 0);

        content.innerHTML = `
            <div class="page-header">
                <div>
                    <h1 class="page-title">${product.product_code} - ${product.product_name}</h1>
                    <p class="page-subtitle">Process Flow Management</p>
                </div>
                <div class="flex gap-2">
                    <button class="btn btn-secondary" onclick="loadProducts()">
                        <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"/>
                        </svg>
                        Back to Products
                    </button>
                    <button class="btn btn-primary" onclick="showAddProcessModal(${productId})">
                        <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/>
                        </svg>
                        Add Operation
                    </button>
                </div>
            </div>

            <div class="stats-grid" style="grid-template-columns: repeat(3, 1fr);">
                <div class="stat-card">
                    <div class="stat-icon purple">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
                        </svg>
                    </div>
                    <div class="stat-info">
                        <h3>${processes.length}</h3>
                        <p>Total Operations</p>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon blue">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
                        </svg>
                    </div>
                    <div class="stat-info">
                        <h3>${totalCycleTime}s</h3>
                        <p>Total Cycle Time</p>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon green">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
                        </svg>
                    </div>
                    <div class="stat-info">
                        <h3>${totalSah.toFixed(4)}</h3>
                        <p>Total SAH (hrs)</p>
                    </div>
                </div>
            </div>

            <div class="card">
                <div class="card-header">
                    <h3 class="card-title">Process Flow</h3>
                </div>
                <div class="card-body">
                    ${processes.length === 0 ? `
                        <div class="empty-state">
                            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/>
                            </svg>
                            <h3>No operations defined</h3>
                            <p>Click "Add Operation" to define the process flow</p>
                        </div>
                    ` : `
                        <div class="table-container">
                            <table>
                            <thead>
                                <tr>
                                    <th>Seq</th>
                                    <th>Operation Code</th>
                                    <th>Operation Name</th>
                                    <th>Category</th>
                                    <th>QR</th>
                                    <th>Cycle Time</th>
                                    <th>SAH</th>
                                    <th>Manpower</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${processes.map(proc => `
                                    <tr>
                                        <td><span class="process-step-num">${proc.sequence_number}</span></td>
                                        <td><strong>${proc.operation_code}</strong></td>
                                        <td>${proc.operation_name}</td>
                                        <td><span class="badge badge-info">${proc.operation_category}</span></td>
                                        <td>
                                            <button class="btn btn-secondary btn-sm" ${proc.qr_code_path ? '' : 'disabled'} onclick='showOperationQrModal(${JSON.stringify(proc)})'>View</button>
                                        </td>
                                        <td>${proc.cycle_time_seconds || 0}s</td>
                                        <td>${parseFloat(proc.operation_sah || 0).toFixed(4)}</td>
                                        <td>${proc.manpower_required || 1}</td>
                                        <td>
                                            <div class="action-btns">
                                                <button class="btn btn-secondary btn-sm" onclick='editProcess(${JSON.stringify(proc)}, ${productId})'>Edit</button>
                                                <button class="btn btn-danger btn-sm" onclick="deleteProcess(${proc.id}, ${productId})">Remove</button>
                                            </div>
                                        </td>
                                    </tr>
                                `).join('')}
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

function scheduleRealtimeRefresh(payload) {
    if (realtimeRefreshTimer) {
        clearTimeout(realtimeRefreshTimer);
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
            return;
        }
        if (currentSection === 'attendance' && payload.entity === 'attendance') {
            loadAttendanceSection();
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
                        <label class="form-label">Cycle Time (seconds) *</label>
                        <input type="number" class="form-control" name="cycle_time_seconds" min="1" required onchange="calculateSAH()">
                    </div>
                    <div class="form-group">
                        <label class="form-label">SAH (calculated)</label>
                        <input type="number" class="form-control" name="operation_sah" step="0.0001" required readonly>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Manpower Required</label>
                        <input type="number" class="form-control" name="manpower_required" min="1" value="1">
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

function calculateSAH() {
    const cycleTime = document.querySelector('input[name="cycle_time_seconds"]').value;
    if (cycleTime) {
        const sah = (parseFloat(cycleTime) / 3600).toFixed(4);
        document.querySelector('input[name="operation_sah"]').value = sah;
    }
}

async function saveProcess() {
    const form = document.getElementById('process-form');
    const formData = new FormData(form);
    const data = Object.fromEntries(formData);

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
                        <label class="form-label">Cycle Time (seconds) *</label>
                        <input type="number" class="form-control" name="cycle_time_seconds" min="1" value="${proc.cycle_time_seconds || ''}" required onchange="calculateSAH()">
                    </div>
                    <div class="form-group">
                        <label class="form-label">SAH</label>
                        <input type="number" class="form-control" name="operation_sah" step="0.0001" value="${proc.operation_sah}" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Manpower Required</label>
                        <input type="number" class="form-control" name="manpower_required" min="1" value="${proc.manpower_required || 1}">
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
                            <option value="">All Categories</option>
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
                                    <th>QR</th>
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
            <td>
                <button class="btn btn-secondary btn-sm" ${op.qr_code_path ? '' : 'disabled'} onclick='showOperationQrModal(${JSON.stringify(op)})'>View</button>
            </td>
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
    loadAttendanceData();
}

const IE_DEFAULT_IN = '08:00';
const IE_DEFAULT_OUT = '17:00';

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
    const inTime = row.in_time || IE_DEFAULT_IN;
    const outTime = row.out_time || IE_DEFAULT_OUT;
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
