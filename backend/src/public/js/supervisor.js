const API_BASE = '/api';

document.addEventListener('DOMContentLoaded', async () => {
    const ok = await requireAuth();
    if (!ok) return;
    setupNavigation();
    setupMobileSidebar();
    loadSection('scan');
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

const scanState = {
    lineId: '',
    process: null,
    assignedEmployee: null,
    processAssignedEmployee: null,
    employee: null,
    employeeQrRaw: null,
    processQrRaw: null,
    employeeDirectory: null,
    employeeAssignment: null,
    scanTarget: null,
    stage: 'idle'
};

const progressState = {
    lineId: '',
    process: null,
    employee: null,
    scanTarget: null
};

function setupNavigation() {
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const section = link.dataset.section;
            loadSection(section);

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

async function loadSection(section) {
    if (section === 'progress') {
        await loadProgressSection();
        return;
    }
    if (section === 'materials') {
        await loadMaterialsSection();
        return;
    }
    if (section === 'shift-summary') {
        await loadShiftSummarySection();
        return;
    }
    await loadScanSection();
}

async function loadScanSection() {
    const content = document.getElementById('supervisor-content');
    content.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';

    try {
        const response = await fetch(`${API_BASE}/supervisor/lines`);
        const result = await response.json();
        const lines = result.data || [];
        const date = new Date().toISOString().slice(0, 10);

        content.innerHTML = `
            <div class="page-header">
                <div>
                    <h1 class="page-title">Scan & Attendance</h1>
                    <p class="page-subtitle">Scan process and employee QR to mark attendance</p>
                </div>
                <span class="status-badge">Live • ${date}</span>
            </div>

            <div class="supervisor-panel">
                <div class="scan-box">
                    <h3>Line Selection</h3>
                    <div class="scan-inputs">
                        <label class="form-label">Line</label>
                        <select class="form-control" id="scan-line">
                            <option value="">Select Line</option>
                            ${lines.map(line => `
                                <option value="${line.id}">
                                    ${line.line_name} (${line.line_code})${line.product_code ? ` • ${line.product_code}` : ''}
                                </option>
                            `).join('')}
                        </select>
                        <div class="scan-hint" id="scan-line-hint">Select a line to start scanning.</div>
                    </div>
                </div>

                <div class="scan-box" id="scan-actions">
                    <h3>QR Scan</h3>
                    <div class="scan-inputs">
                        <div class="scan-action-buttons">
                            <button class="btn btn-primary btn-sm" id="scan-process-btn">Scan Process QR</button>
                            <button class="btn btn-secondary btn-sm" id="scan-employee-btn">Scan Employee QR</button>
                        </div>
                        <div class="camera-panel hidden" id="scan-camera-panel">
                            <div class="camera-header">
                                <span class="status-badge" id="camera-status">Camera Idle</span>
                                <div class="camera-actions">
                                    <button class="btn btn-secondary btn-sm" id="camera-start">Start Camera</button>
                                    <button class="btn btn-secondary btn-sm" id="camera-stop" disabled>Stop</button>
                                </div>
                            </div>
                            <video id="camera-preview" playsinline muted></video>
                        </div>
                        <div class="scan-callout" id="scan-status-text">Select a line to begin.</div>
                    </div>
                </div>

                <div class="scan-box" id="scan-summary">
                    <h3>Scan Details</h3>
                    <div class="scan-status">
                        <div class="scan-row">
                            <span class="scan-label">Work Process</span>
                            <span class="scan-value" id="scan-process-text">Not scanned</span>
                        </div>
                        <div class="scan-row">
                            <span class="scan-label">Assigned Employee</span>
                            <span class="scan-value" id="scan-assigned-text">Not assigned</span>
                        </div>
                        <div class="scan-row">
                            <span class="scan-label">Scanned Employee</span>
                            <span class="scan-value" id="scan-employee-text">Not scanned</span>
                        </div>
                        <div class="scan-hint" id="scan-hint">Scan a process or employee to continue.</div>
                        <div class="scan-actions-row">
                            <button class="btn btn-secondary btn-sm" id="scan-reset" type="button">Reset</button>
                            <button class="btn btn-primary btn-sm" id="scan-submit" type="button" disabled>Submit</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.getElementById('camera-start').addEventListener('click', startCameraScan);
        document.getElementById('camera-stop').addEventListener('click', stopCameraScan);
        document.getElementById('scan-line').addEventListener('change', handleLineChange);
        document.getElementById('scan-reset').addEventListener('click', resetProcessScan);
        document.getElementById('scan-process-btn').addEventListener('click', () => startScanTarget('process'));
        document.getElementById('scan-employee-btn').addEventListener('click', () => startScanTarget('employee'));
        document.getElementById('scan-submit').addEventListener('click', finalizeScan);
        scanState.lineId = '';
        resetProcessScan();
    } catch (err) {
        content.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    }
}

function handleLineChange() {
    const lineId = document.getElementById('scan-line').value;
    scanState.lineId = lineId;
    resetProcessScan();
    if (lineId) {
        preloadEmployees();
    }
}

function resetProcessScan() {
    scanState.process = null;
    scanState.assignedEmployee = null;
    scanState.processAssignedEmployee = null;
    scanState.employee = null;
    scanState.employeeQrRaw = null;
    scanState.processQrRaw = null;
    scanState.employeeAssignment = null;
    scanState.scanTarget = null;
    scanState.stage = 'idle';
    updateScanDisplay();
}

function updateScanDisplay() {
    const processText = document.getElementById('scan-process-text');
    const employeeText = document.getElementById('scan-employee-text');
    const assignedText = document.getElementById('scan-assigned-text');
    const hint = document.getElementById('scan-hint');
    const statusText = document.getElementById('scan-status-text');
    const summaryBox = document.getElementById('scan-summary');
    const actionsBox = document.getElementById('scan-actions');
    const cameraPanel = document.getElementById('scan-camera-panel');
    const submitBtn = document.getElementById('scan-submit');
    const lineHint = document.getElementById('scan-line-hint');

    if (scanState.process) {
        processText.textContent = `${scanState.process.operation_code} - ${scanState.process.operation_name} (ID ${scanState.process.id})`;
    } else {
        processText.textContent = 'Not scanned';
    }

    if (scanState.processAssignedEmployee) {
        assignedText.textContent = `${scanState.processAssignedEmployee.emp_code} - ${scanState.processAssignedEmployee.emp_name} (ID ${scanState.processAssignedEmployee.id})`;
    } else {
        assignedText.textContent = 'Not assigned';
    }

    if (scanState.employee) {
        employeeText.textContent = `${scanState.employee.emp_code} - ${scanState.employee.emp_name} (ID ${scanState.employee.id})`;
    } else {
        employeeText.textContent = 'Not scanned';
    }

    if (!scanState.lineId) {
        if (lineHint) lineHint.textContent = 'Select a line to start scanning.';
        hint.textContent = 'Select a line before scanning.';
        statusText.textContent = 'Waiting for line selection...';
        if (summaryBox) summaryBox.style.display = 'none';
        if (actionsBox) {
            actionsBox.classList.add('disabled');
            actionsBox.style.display = 'none';
        }
        if (cameraPanel) cameraPanel.classList.add('hidden');
        if (submitBtn) submitBtn.disabled = true;
        return;
    }

    if (lineHint) lineHint.textContent = 'Line selected. Start scanning.';
    if (summaryBox) summaryBox.style.display = 'block';
    if (actionsBox) {
        actionsBox.classList.remove('disabled');
        actionsBox.style.display = 'block';
    }

    if (!scanState.process && !scanState.employee) {
        hint.textContent = 'Scan a process or employee to begin.';
        statusText.textContent = 'Waiting for scan...';
    } else if (!scanState.process) {
        hint.textContent = 'Scan the work process QR next.';
        statusText.textContent = 'Waiting for process scan...';
    } else if (!scanState.employee) {
        hint.textContent = 'Scan the employee QR next.';
        statusText.textContent = 'Waiting for employee scan...';
    } else {
        hint.textContent = 'Both scanned. Submit to confirm assignment.';
        statusText.textContent = 'Ready to submit.';
    }

    if (submitBtn) {
        submitBtn.disabled = !(scanState.process && scanState.employee);
    }
}

async function preloadEmployees() {
    if (scanState.employeeDirectory) return;
    try {
        const response = await fetch(`${API_BASE}/employees`);
        const result = await response.json();
        if (!result.success) return;
        const byId = new Map();
        const byCode = new Map();
        result.data.forEach(emp => {
            byId.set(String(emp.id), emp);
            if (emp.emp_code) {
                byCode.set(String(emp.emp_code).trim(), emp);
            }
        });
        scanState.employeeDirectory = { byId, byCode, all: result.data };
    } catch (err) {
        // ignore preload errors
    }
}

function parseScanPayload(rawValue) {
    if (!rawValue) return null;
    try {
        const parsed = JSON.parse(rawValue);
        if (parsed && typeof parsed === 'object') return parsed;
    } catch (err) {
        // ignore
    }
    const raw = String(rawValue).trim();
    if (!raw) return null;
    const numeric = parseInt(raw, 10);
    if (Number.isFinite(numeric)) {
        return { id: numeric };
    }
    return { raw };
}

function startScanTarget(target) {
    if (!scanState.lineId) {
        showToast('Select a line first', 'error');
        return;
    }
    scanState.scanTarget = target;
    const statusText = document.getElementById('scan-status-text');
    if (statusText) {
        statusText.textContent = target === 'process'
            ? 'Scan the work process QR...'
            : 'Scan the employee QR...';
    }
    const cameraPanel = document.getElementById('scan-camera-panel');
    if (cameraPanel) cameraPanel.classList.remove('hidden');
    startCameraScan();
    updateScanDisplay();
}

let cameraStream = null;
let scanning = false;
let detector = null;
let lastScanAt = 0;

async function startCameraScan() {
    const status = document.getElementById('camera-status');
    const video = document.getElementById('camera-preview');
    try {
        if ('BarcodeDetector' in window) {
            detector = new BarcodeDetector({ formats: ['qr_code'] });
        } else if (window.jsQR) {
            detector = null;
        } else {
            showToast('Camera QR scan not supported on this device', 'error');
            return;
        }
        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' } },
            audio: false
        });
        video.srcObject = cameraStream;
        await video.play();
        scanning = true;
        status.textContent = 'Scanning...';
        document.getElementById('camera-start').disabled = true;
        document.getElementById('camera-stop').disabled = false;
        scanFrame();
    } catch (err) {
        showToast('Unable to access camera', 'error');
        status.textContent = 'Camera Error';
    }
}

function stopCameraScan() {
    scanning = false;
    const status = document.getElementById('camera-status');
    status.textContent = 'Camera Stopped';
    document.getElementById('camera-start').disabled = false;
    document.getElementById('camera-stop').disabled = true;
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }
}

async function scanFrame() {
    if (!scanning) return;
    const video = document.getElementById('camera-preview');
    try {
        if (detector) {
            const barcodes = await detector.detect(video);
            if (barcodes.length) {
                const now = Date.now();
                if (now - lastScanAt > 1200) {
                    lastScanAt = now;
                    handleQrValue(barcodes[0].rawValue);
                }
            }
        } else if (window.jsQR) {
            const canvas = document.createElement('canvas');
            const width = video.videoWidth;
            const height = video.videoHeight;
            if (width && height) {
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(video, 0, 0, width, height);
                const imageData = ctx.getImageData(0, 0, width, height);
                const code = window.jsQR(imageData.data, width, height);
                if (code && code.data) {
                    const now = Date.now();
                    if (now - lastScanAt > 1200) {
                        lastScanAt = now;
                        handleQrValue(code.data);
                    }
                }
            }
        }
    } catch (err) {
        // ignore scan errors
    }
    requestAnimationFrame(scanFrame);
}

function handleQrValue(rawValue) {
    const parsed = parseScanPayload(rawValue);
    const lineSelect = document.getElementById('scan-line');
    if (!scanState.lineId) {
        showToast('Select a line first', 'error');
        return;
    }

    if (parsed && parsed.type === 'line' && parsed.id) {
        lineSelect.value = parsed.id;
        scanState.lineId = parsed.id;
        resetProcessScan();
        showToast('Line QR captured', 'success');
        return;
    }

    const isProcessType = parsed && (parsed.type === 'process' || parsed.type === 'operation');
    const isEmployeeType = parsed && parsed.type === 'employee';

    if (scanState.scanTarget === 'process' || isProcessType) {
        resolveProcessScan(rawValue);
        return;
    }

    if (scanState.scanTarget === 'employee' || isEmployeeType) {
        resolveEmployeeScan(rawValue);
        return;
    }

    showToast('Choose scan type first', 'error');
}

async function resolveProcessScan(processQr) {
    if (!scanState.lineId) {
        showToast('Select a line first', 'error');
        return;
    }
    try {
        const response = await fetch(`${API_BASE}/supervisor/resolve-process`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ line_id: scanState.lineId, process_qr: processQr })
        });
        const result = await response.json();
        if (!result.success) {
            showToast(result.error, 'error');
            return;
        }
        scanState.process = result.data.process;
        scanState.processAssignedEmployee = result.data.employee || null;
        scanState.assignedEmployee = result.data.employee || null;
        scanState.processQrRaw = processQr;
        scanState.scanTarget = null;
        scanState.stage = 'process';
        updateScanDisplay();
        showToast('Process scanned', 'success');
        stopCameraScan();
        if (scanState.process && scanState.employee) {
            finalizeScan();
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function resolveEmployeeScan(employeeQr) {
    if (!scanState.lineId) {
        showToast('Select a line first', 'error');
        return;
    }
    if (!scanState.employeeDirectory) {
        await preloadEmployees();
    }
    const parsed = parseScanPayload(employeeQr);
    let employee = null;
    if (parsed?.id && scanState.employeeDirectory?.byId) {
        employee = scanState.employeeDirectory.byId.get(String(parsed.id));
    }
    if (!employee) {
        const code = parsed?.emp_code || parsed?.code || parsed?.raw;
        if (code && scanState.employeeDirectory?.byCode) {
            employee = scanState.employeeDirectory.byCode.get(String(code).trim());
        }
    }
    if (!employee) {
        showToast('Employee not found', 'error');
        return;
    }
    scanState.employee = employee;
    scanState.employeeQrRaw = employeeQr;
    scanState.employeeAssignment = {
        line_name: employee.line_name || null,
        process_id: employee.process_id || null,
        operation_code: employee.operation_code || null,
        operation_name: employee.operation_name || null,
        product_code: employee.product_code || null
    };
    scanState.scanTarget = null;
    scanState.stage = 'employee';
    updateScanDisplay();
    showToast('Employee scanned', 'success');
    stopCameraScan();
    if (scanState.process && scanState.employee) {
        finalizeScan();
    }
}

function buildAssignmentWarning() {
    const warnings = [];
    const scanned = scanState.employee;
    const processAssigned = scanState.processAssignedEmployee;
    const assignment = scanState.employeeAssignment;

    if (processAssigned && processAssigned.id !== scanned.id) {
        warnings.push(`Process is currently assigned to ${processAssigned.emp_code} - ${processAssigned.emp_name}.`);
    }

    if (assignment?.process_id && assignment.process_id !== scanState.process.id) {
        const opLabel = assignment.operation_code
            ? `${assignment.operation_code}${assignment.operation_name ? ` - ${assignment.operation_name}` : ''}`
            : 'another process';
        const lineLabel = assignment.line_name ? ` on ${assignment.line_name}` : '';
        warnings.push(`Employee is currently assigned to ${opLabel}${lineLabel}.`);
    }

    return warnings;
}

function showMaterialsModal({ requiresQuantity, onSubmit }) {
    const existing = document.getElementById('materials-modal');
    if (existing) existing.remove();
    const modal = document.createElement('div');
    modal.className = 'progress-modal-backdrop';
    modal.id = 'materials-modal';
    modal.innerHTML = `
        <div class="progress-modal">
            <div class="progress-modal-header">
                <h3>Confirm Assignment</h3>
                <button class="modal-close" type="button" id="materials-modal-close">
                    <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                    </svg>
                </button>
            </div>
            <div class="progress-modal-body">
                <div class="progress-modal-info">
                    <div>
                        <div class="scan-label">Process</div>
                        <div class="scan-value">${scanState.process.operation_code} - ${scanState.process.operation_name}</div>
                    </div>
                    <div>
                        <div class="scan-label">Employee</div>
                        <div class="scan-value">${scanState.employee.emp_code} - ${scanState.employee.emp_name}</div>
                    </div>
                </div>
                ${requiresQuantity ? `
                    <label class="form-label">Quantity Completed (before change)</label>
                    <input type="number" class="form-control" id="materials-quantity" min="0" value="0">
                ` : ''}
                <label class="form-label">Initial Materials Provided</label>
                <input type="number" class="form-control" id="materials-input" min="0" value="0">
                <label class="form-label">Materials Already at Process (Unworked)</label>
                <input type="number" class="form-control" id="materials-existing" min="0" value="0">
            </div>
            <div class="progress-modal-footer">
                <button class="btn btn-secondary" type="button" id="materials-modal-cancel">Cancel</button>
                <button class="btn btn-primary" type="button" id="materials-modal-save">Submit</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    setTimeout(() => modal.classList.add('active'), 10);

    document.getElementById('materials-modal-save').addEventListener('click', async () => {
        const materials = document.getElementById('materials-input').value;
        const existing = document.getElementById('materials-existing').value;
        const quantity = requiresQuantity ? document.getElementById('materials-quantity').value : null;
        await onSubmit(materials, existing, quantity);
        closeMaterialsModal();
    });
    document.getElementById('materials-modal-cancel').addEventListener('click', closeMaterialsModal);
    document.getElementById('materials-modal-close').addEventListener('click', closeMaterialsModal);
}

function closeMaterialsModal() {
    const modal = document.getElementById('materials-modal');
    if (!modal) return;
    modal.classList.remove('active');
    setTimeout(() => modal.remove(), 150);
}

async function finalizeScan() {
    if (!scanState.process || !scanState.employee) {
        showToast('Scan process and employee first', 'error');
        return;
    }

    const warnings = buildAssignmentWarning();
    let confirmChange = false;
    if (warnings.length) {
        const message = `${warnings.join('\n')}\n\nDo you want to assign this employee to the scanned process?`;
        const confirmed = window.confirm(message);
        if (!confirmed) return;
        confirmChange = true;
    }

    const requiresQuantity = Boolean(
        scanState.processAssignedEmployee &&
        scanState.processAssignedEmployee.id !== scanState.employee.id
    );

    showMaterialsModal({
        requiresQuantity,
        onSubmit: async (materials, existing, quantity) => {
            await submitEmployeeAssignment(
                scanState.employeeQrRaw,
                requiresQuantity ? quantity : null,
                confirmChange,
                materials,
                existing
            );
        }
    });
}

async function submitEmployeeAssignment(employeeQr, quantityCompleted, confirmChange = false, materialsAtLink = 0, existingMaterials = 0) {
    try {
        const response = await fetch(`${API_BASE}/supervisor/assign`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                line_id: scanState.lineId,
                process_id: scanState.process.id,
                employee_qr: employeeQr,
                quantity_completed: quantityCompleted,
                materials_at_link: materialsAtLink,
                existing_materials: existingMaterials,
                confirm_change: confirmChange
            })
        });
        const result = await response.json();
        if (!result.success) {
            if (result.error && result.error.includes('Confirm change')) {
                const confirmChange = window.confirm('This will change the current employee assignment. Continue?');
                if (!confirmChange) return;
                return submitEmployeeAssignment(employeeQr, quantityCompleted, true, materialsAtLink);
            }
            if (result.error && result.error.includes('Quantity completed')) {
                showMaterialsModal({
                    requiresQuantity: true,
                    onSubmit: async (materials, existing, quantity) => {
                        await submitEmployeeAssignment(employeeQr, quantity, true, materials, existing);
                    }
                });
                return;
            }
            showToast(result.error, 'error');
            return;
        }
        scanState.assignedEmployee = result.data.employee;
        scanState.processAssignedEmployee = result.data.employee;
        scanState.employee = result.data.employee;
        scanState.employeeAssignment = {
            line_name: null,
            process_id: scanState.process?.id || null,
            operation_code: scanState.process?.operation_code || null,
            operation_name: scanState.process?.operation_name || null,
            product_code: null
        };
        scanState.stage = 'complete';
        updateScanDisplay();
        showToast('Employee linked and attendance marked', 'success');
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function showAssignmentChangeModal(employeeQr) {
    const existing = document.getElementById('assignment-modal');
    if (existing) existing.remove();
    const modal = document.createElement('div');
    modal.className = 'progress-modal-backdrop';
    modal.id = 'assignment-modal';
    modal.innerHTML = `
        <div class="progress-modal">
            <div class="progress-modal-header">
                <h3>Change Employee</h3>
                <button class="modal-close" type="button" id="assignment-modal-close">
                    <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                    </svg>
                </button>
            </div>
            <div class="progress-modal-body">
                <div class="progress-modal-info">
                    <div>
                        <div class="scan-label">Process</div>
                        <div class="scan-value">${scanState.process.operation_code} - ${scanState.process.operation_name}</div>
                    </div>
                    <div>
                        <div class="scan-label">Current Employee</div>
                        <div class="scan-value">${scanState.assignedEmployee ? `${scanState.assignedEmployee.emp_code} - ${scanState.assignedEmployee.emp_name}` : 'Unassigned'}</div>
                    </div>
                </div>
                <label class="form-label">Quantity Completed (before change)</label>
                <input type="number" class="form-control" id="assignment-quantity" min="0" value="0">
                <label class="form-label">Materials at Link</label>
                <input type="number" class="form-control" id="assignment-materials" min="0" value="0">
                <label class="form-label">Materials Already at Process (Unworked)</label>
                <input type="number" class="form-control" id="assignment-existing" min="0" value="0">
            </div>
            <div class="progress-modal-footer">
                <button class="btn btn-secondary" type="button" id="assignment-modal-cancel">Cancel</button>
                <button class="btn btn-primary" type="button" id="assignment-modal-save">Submit</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    setTimeout(() => modal.classList.add('active'), 10);
    document.getElementById('assignment-modal-save').addEventListener('click', async () => {
        const qty = document.getElementById('assignment-quantity').value;
        const materials = document.getElementById('assignment-materials').value;
        const existing = document.getElementById('assignment-existing').value;
        await submitEmployeeAssignment(employeeQr, qty, true, materials, existing);
        closeAssignmentModal();
    });
    document.getElementById('assignment-modal-cancel').addEventListener('click', closeAssignmentModal);
    document.getElementById('assignment-modal-close').addEventListener('click', closeAssignmentModal);
}

function closeAssignmentModal() {
    const modal = document.getElementById('assignment-modal');
    if (!modal) return;
    modal.classList.remove('active');
    setTimeout(() => modal.remove(), 150);
}

async function loadProgressSection() {
    const content = document.getElementById('supervisor-content');
    content.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';

    try {
        const response = await fetch(`${API_BASE}/supervisor/lines`);
        const result = await response.json();
        const lines = result.data || [];
        const date = new Date().toISOString().slice(0, 10);
        const hour = new Date().getHours();
        const hourStart = 8;
        const hourEnd = 19;
        const defaultHour = hour >= hourStart && hour <= hourEnd ? hour : hourStart;

        content.innerHTML = `
            <div class="page-header">
                <div>
                    <h1 class="page-title">Hourly Progress</h1>
                    <p class="page-subtitle">Log hourly output by process</p>
                </div>
                <div class="supervisor-controls">
                    <div>
                        <label class="form-label">Line</label>
                        <select class="form-control" id="progress-line">
                            <option value="">Select Line</option>
                            ${lines.map(line => `
                                <option value="${line.id}">
                                    ${line.line_name} (${line.line_code})
                                </option>
                            `).join('')}
                        </select>
                    </div>
                    <div>
                        <label class="form-label">Date</label>
                        <input type="date" class="form-control" id="progress-date" value="${date}">
                    </div>
                    <div>
                        <label class="form-label">Hour</label>
                        <select class="form-control" id="progress-hour">
                            ${Array.from({ length: hourEnd - hourStart + 1 }).map((_, i) => {
                                const value = hourStart + i;
                                return `<option value="${value}" ${value === defaultHour ? 'selected' : ''}>${String(value).padStart(2, '0')}:00</option>`;
                            }).join('')}
                        </select>
                    </div>
                    <div>
                        <label class="form-label">&nbsp;</label>
                        <button class="btn btn-danger" id="close-shift-btn">Close Shift</button>
                    </div>
                </div>
            </div>

            <div class="card">
                <div class="card-header">
                    <h3 class="card-title">Process Output</h3>
                </div>
                <div class="card-body">
                    <div id="progress-list" class="progress-grid">
                        <div class="alert alert-info">Select a line, then scan a process or employee QR.</div>
                    </div>
                </div>
            </div>
        `;

        document.getElementById('progress-line').addEventListener('change', () => {
            progressState.lineId = document.getElementById('progress-line').value;
            resetProgressProcess();
            loadProgressLog();
            loadLineMetrics();
            loadProductionStats();
        });
        document.getElementById('progress-date').addEventListener('change', () => {
            resetProgressProcess();
        });
        document.getElementById('close-shift-btn').addEventListener('click', closeShift);
        progressState.lineId = '';
        resetProgressProcess();
    } catch (err) {
        content.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    }
}

function resetProgressProcess() {
    progressState.process = null;
    progressState.employee = null;
    progressState.scanTarget = null;
    const list = document.getElementById('progress-list');
    if (list) {
        list.innerHTML = progressState.lineId
            ? `<div class="progress-scan-shell">
                    <div class="scan-status">
                        <div class="scan-row">
                            <span class="scan-label">Work Process</span>
                            <span class="scan-value" id="progress-process-text">Not scanned</span>
                        </div>
                        <div class="scan-row">
                            <span class="scan-label">Employee</span>
                            <span class="scan-value" id="progress-employee-text">Not scanned</span>
                        </div>
                        <div class="scan-row">
                            <span class="scan-label">Target</span>
                            <span class="scan-value" id="progress-target-text">-</span>
                        </div>
                        <div class="scan-hint" id="progress-hint">Scan process or employee QR to begin.</div>
                    </div>
                    <div class="scan-action-buttons progress-scan-actions">
                        <button class="btn btn-primary btn-sm" id="progress-scan-process">Scan Process QR</button>
                        <button class="btn btn-secondary btn-sm" id="progress-scan-employee">Scan Employee QR</button>
                    </div>
                    <div class="camera-panel hidden" id="progress-camera-panel">
                        <div class="camera-header">
                            <span class="status-badge" id="progress-camera-status">Camera Idle</span>
                            <div class="camera-actions">
                                <button class="btn btn-secondary btn-sm" id="progress-camera-start">Start Camera</button>
                                <button class="btn btn-secondary btn-sm" id="progress-camera-stop" disabled>Stop</button>
                            </div>
                        </div>
                        <video id="progress-camera-preview" playsinline muted></video>
                    </div>
               </div>`
            : '<div class="alert alert-info">Select a line to start scanning.</div>';
    }
    if (progressState.lineId) {
        document.getElementById('progress-camera-start').addEventListener('click', startProgressCameraScan);
        document.getElementById('progress-camera-stop').addEventListener('click', stopProgressCameraScan);
        document.getElementById('progress-scan-process').addEventListener('click', () => startProgressScanTarget('process'));
        document.getElementById('progress-scan-employee').addEventListener('click', () => startProgressScanTarget('employee'));
    }
}

async function saveProgress() {
    const lineId = document.getElementById('progress-line').value;
    const date = document.getElementById('progress-date').value;
    const hour = document.getElementById('progress-hour').value;
    const qty = document.getElementById('progress-quantity').value;
    const forwarded = document.getElementById('progress-forwarded')?.value || 0;
    const remaining = document.getElementById('progress-remaining')?.value || 0;
    if (!lineId || !date) {
        showToast('Line and date are required', 'error');
        return;
    }
    if (!progressState.process) {
        showToast('Scan a work process or employee first', 'error');
        return;
    }
    const completed = parseInt(qty || 0, 10);
    const forwardedNum = parseInt(forwarded || 0, 10);
    const remainingNum = parseInt(remaining || 0, 10);
    if (completed !== forwardedNum + remainingNum) {
        showToast('Completed must equal Forwarded + Remaining', 'error');
        return;
    }
    try {
        const response = await fetch(`${API_BASE}/supervisor/progress`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                line_id: lineId,
                process_id: progressState.process.id,
                work_date: date,
                hour_slot: hour,
                quantity: completed,
                forwarded_quantity: forwardedNum,
                remaining_quantity: remainingNum
            })
        });
        const result = await response.json();
        if (!result.success) {
            showToast(result.error, 'error');
            return;
        }
        showToast('Saved', 'success');
        resetProgressProcess();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

let progressCameraStream = null;
let progressScanning = false;
let progressDetector = null;
let progressLastScanAt = 0;

async function startProgressCameraScan() {
    const status = document.getElementById('progress-camera-status');
    const video = document.getElementById('progress-camera-preview');
    try {
        if ('BarcodeDetector' in window) {
            progressDetector = new BarcodeDetector({ formats: ['qr_code'] });
        } else if (window.jsQR) {
            progressDetector = null;
        } else {
            showToast('Camera QR scan not supported on this device', 'error');
            return;
        }
        progressCameraStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' } },
            audio: false
        });
        video.srcObject = progressCameraStream;
        await video.play();
        progressScanning = true;
        status.textContent = 'Scanning...';
        document.getElementById('progress-camera-start').disabled = true;
        document.getElementById('progress-camera-stop').disabled = false;
        scanProgressFrame();
    } catch (err) {
        showToast('Unable to access camera', 'error');
        status.textContent = 'Camera Error';
    }
}

function stopProgressCameraScan() {
    progressScanning = false;
    const status = document.getElementById('progress-camera-status');
    status.textContent = 'Camera Stopped';
    document.getElementById('progress-camera-start').disabled = false;
    document.getElementById('progress-camera-stop').disabled = true;
    if (progressCameraStream) {
        progressCameraStream.getTracks().forEach(track => track.stop());
        progressCameraStream = null;
    }
}

async function scanProgressFrame() {
    if (!progressScanning) return;
    const video = document.getElementById('progress-camera-preview');
    try {
        if (progressDetector) {
            const barcodes = await progressDetector.detect(video);
            if (barcodes.length) {
                const now = Date.now();
                if (now - progressLastScanAt > 1200) {
                    progressLastScanAt = now;
                    handleProgressQrValue(barcodes[0].rawValue);
                }
            }
        } else if (window.jsQR) {
            const canvas = document.createElement('canvas');
            const width = video.videoWidth;
            const height = video.videoHeight;
            if (width && height) {
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(video, 0, 0, width, height);
                const imageData = ctx.getImageData(0, 0, width, height);
                const code = window.jsQR(imageData.data, width, height);
                if (code && code.data) {
                    const now = Date.now();
                    if (now - progressLastScanAt > 1200) {
                        progressLastScanAt = now;
                        handleProgressQrValue(code.data);
                    }
                }
            }
        }
    } catch (err) {
        // ignore scan errors
    }
    requestAnimationFrame(scanProgressFrame);
}

async function handleProgressQrValue(rawValue) {
    if (!progressState.lineId) {
        showToast('Select a line first', 'error');
        return;
    }
    const parsed = parseScanPayload(rawValue);
    const isProcessType = parsed && (parsed.type === 'process' || parsed.type === 'operation');
    const isEmployeeType = parsed && parsed.type === 'employee';
    if (progressState.scanTarget === 'employee' || isEmployeeType) {
        await resolveProgressEmployee(rawValue);
        return;
    }
    if (progressState.scanTarget === 'process' || isProcessType) {
        await resolveProgressProcess(rawValue);
        return;
    }
    showToast('Choose scan type first', 'error');
}

function startProgressScanTarget(target) {
    if (!progressState.lineId) {
        showToast('Select a line first', 'error');
        return;
    }
    progressState.scanTarget = target;
    const cameraPanel = document.getElementById('progress-camera-panel');
    if (cameraPanel) cameraPanel.classList.remove('hidden');
    const hint = document.getElementById('progress-hint');
    if (hint) {
        hint.textContent = target === 'process'
            ? 'Scan the work process QR.'
            : 'Scan the employee QR.';
    }
    startProgressCameraScan();
}

async function resolveProgressProcess(processQr) {
    try {
        const date = document.getElementById('progress-date').value;
        const response = await fetch(`${API_BASE}/supervisor/resolve-process`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ line_id: progressState.lineId, process_qr: processQr, work_date: date })
        });
        const result = await response.json();
        if (!result.success) {
            showToast(result.error, 'error');
            return;
        }
        progressState.process = result.data.process;
        progressState.employee = result.data.employee || null;
        updateProgressScanDisplay();
        stopProgressCameraScan();
        showToast('Process scanned', 'success');
        showProgressEntryModal();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function resolveProgressEmployee(employeeQr) {
    try {
        const date = document.getElementById('progress-date').value;
        const response = await fetch(`${API_BASE}/supervisor/resolve-employee`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ line_id: progressState.lineId, employee_qr: employeeQr, work_date: date })
        });
        const result = await response.json();
        if (!result.success) {
            showToast(result.error, 'error');
            return;
        }
        progressState.process = result.data.process;
        progressState.employee = result.data.employee;
        updateProgressScanDisplay();
        stopProgressCameraScan();
        showToast('Employee scanned', 'success');
        showProgressEntryModal();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function updateProgressScanDisplay() {
    const processText = document.getElementById('progress-process-text');
    const employeeText = document.getElementById('progress-employee-text');
    const targetText = document.getElementById('progress-target-text');
    if (processText) {
        processText.textContent = progressState.process
            ? `${progressState.process.operation_code} - ${progressState.process.operation_name}`
            : 'Not scanned';
    }
    if (employeeText) {
        employeeText.textContent = progressState.employee
            ? `${progressState.employee.emp_code} - ${progressState.employee.emp_name}`
            : 'Not scanned';
    }
    if (targetText) {
        targetText.textContent = progressState.process
            ? String(progressState.process.target_units || 0)
            : '-';
    }
}

function showProgressEntryModal() {
    const existing = document.getElementById('progress-modal');
    if (existing) existing.remove();
    const targetUnits = progressState.process?.target_units || 0;
    const modal = document.createElement('div');
    modal.className = 'progress-modal-backdrop';
    modal.id = 'progress-modal';
    modal.innerHTML = `
        <div class="progress-modal">
            <div class="progress-modal-header">
                <h3>Hourly Output</h3>
                <button class="modal-close" type="button" id="progress-modal-close">
                    <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                    </svg>
                </button>
            </div>
            <div class="progress-modal-body">
                <div class="progress-modal-info">
                    <div>
                        <div class="scan-label">Process</div>
                        <div class="scan-value">${progressState.process.operation_code} - ${progressState.process.operation_name}</div>
                    </div>
                    <div>
                        <div class="scan-label">Employee</div>
                        <div class="scan-value">${progressState.employee ? `${progressState.employee.emp_code} - ${progressState.employee.emp_name}` : 'Not assigned'}</div>
                    </div>
                    <div>
                        <div class="scan-label">Target</div>
                        <div class="scan-value">${targetUnits}</div>
                    </div>
                </div>
                <label class="form-label">Total Completed Units</label>
                <input type="number" class="form-control" id="progress-quantity" min="0" value="0">
                <label class="form-label">Units Forwarded</label>
                <input type="number" class="form-control" id="progress-forwarded" min="0" value="0">
                <label class="form-label">Completed Units remaining with u / Units to be forwared</label>
                <input type="number" class="form-control" id="progress-remaining" min="0" value="0">
            </div>
            <div class="progress-modal-footer">
                <button class="btn btn-secondary" type="button" id="progress-modal-cancel">Cancel</button>
                <button class="btn btn-primary" type="button" id="progress-modal-save">Submit</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    setTimeout(() => modal.classList.add('active'), 10);
    document.getElementById('progress-modal-save').addEventListener('click', async () => {
        await saveProgress();
        closeProgressModal();
    });
    document.getElementById('progress-modal-cancel').addEventListener('click', closeProgressModal);
    document.getElementById('progress-modal-close').addEventListener('click', closeProgressModal);
}

function closeProgressModal() {
    const modal = document.getElementById('progress-modal');
    if (!modal) return;
    modal.classList.remove('active');
    setTimeout(() => modal.remove(), 150);
}

async function loadProgressLog() {
    const lineId = document.getElementById('progress-line').value;
    const date = document.getElementById('progress-date').value;
    const log = document.getElementById('progress-log');
    if (!lineId) {
        log.innerHTML = '<div class="alert alert-info">Select a line to view hourly progress.</div>';
        return;
    }
    try {
        const response = await fetch(`${API_BASE}/supervisor/progress?line_id=${lineId}&work_date=${date}`);
        const result = await response.json();
        const rows = result.data || [];
        if (!rows.length) {
            log.innerHTML = '<div class="alert alert-warning">No progress logged yet.</div>';
            return;
        }
        log.innerHTML = rows.map(row => `
            <div class="progress-log-row">
                <div class="progress-log-hour">${String(row.hour_slot).padStart(2, '0')}:00</div>
                <div class="progress-log-work">${row.operation_code} - ${row.operation_name}</div>
                <div class="progress-log-qty">${row.quantity}</div>
            </div>
        `).join('');
    } catch (err) {
        log.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    }
}

async function loadLineMetrics() {
    const lineId = document.getElementById('progress-line').value;
    const date = document.getElementById('progress-date').value;
    if (!lineId) {
        const forwarded = document.getElementById('metrics-forwarded');
        const wip = document.getElementById('metrics-wip');
        const materials = document.getElementById('metrics-materials');
        const qaOutput = document.getElementById('metrics-qa');
        if (forwarded) forwarded.value = 0;
        if (wip) wip.value = 0;
        if (materials) materials.value = 0;
        if (qaOutput) qaOutput.value = 0;
        return;
    }
    try {
        const response = await fetch(`${API_BASE}/line-metrics?line_id=${lineId}&date=${date}`);
        const result = await response.json();
        if (result.success && result.data) {
            document.getElementById('metrics-forwarded').value = result.data.forwarded_quantity || 0;
            document.getElementById('metrics-wip').value = result.data.remaining_wip || 0;
            document.getElementById('metrics-materials').value = result.data.materials_issued || 0;
            document.getElementById('metrics-qa').value = result.data.qa_output || 0;
        } else {
            document.getElementById('metrics-forwarded').value = 0;
            document.getElementById('metrics-wip').value = 0;
            document.getElementById('metrics-materials').value = 0;
            document.getElementById('metrics-qa').value = 0;
        }
    } catch (err) {
        showToast('Failed to load metrics', 'error');
    }
}

async function saveLineMetrics() {
    const lineId = document.getElementById('progress-line').value;
    const date = document.getElementById('progress-date').value;
    if (!lineId) {
        showToast('Select a line first', 'error');
        return;
    }
    const forwarded = document.getElementById('metrics-forwarded').value;
    const wip = document.getElementById('metrics-wip').value;
    const materials = document.getElementById('metrics-materials').value;
    const qaOutput = document.getElementById('metrics-qa').value;
    try {
        const response = await fetch(`${API_BASE}/line-metrics`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                line_id: lineId,
                work_date: date,
                forwarded_quantity: forwarded,
                remaining_wip: wip,
                materials_issued: materials,
                qa_output: qaOutput
            })
        });
        const result = await response.json();
        if (!result.success) {
            showToast(result.error, 'error');
            return;
        }
        showToast('Metrics saved', 'success');
        loadProductionStats();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function closeShift() {
    const lineId = document.getElementById('progress-line').value;
    const date = document.getElementById('progress-date').value;
    if (!lineId) {
        showToast('Select a line first', 'error');
        return;
    }
    await submitCloseShift(lineId, date);
}

async function submitCloseShift(lineId, date) {
    const confirmClose = window.confirm('Close shift for this line? This will lock entries.');
    if (!confirmClose) return false;
    try {
        const response = await fetch(`${API_BASE}/supervisor/close-shift`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ line_id: lineId, work_date: date })
        });
        const result = await response.json();
        if (!result.success) {
            showToast(result.error, 'error');
            return false;
        }
        showToast('Shift closed', 'success');
        return true;
    } catch (err) {
        showToast(err.message, 'error');
        return false;
    }
}

async function loadProductionStats() {
    const lineId = document.getElementById('progress-line')?.value;
    const date = document.getElementById('progress-date')?.value;

    const targetEl = document.getElementById('stat-target');
    const outputEl = document.getElementById('stat-output');
    const taktEl = document.getElementById('stat-takt');
    const efficiencyEl = document.getElementById('stat-efficiency');
    const completionEl = document.getElementById('stat-completion');

    if (!lineId) {
        if (targetEl) targetEl.textContent = '-';
        if (outputEl) outputEl.textContent = '-';
        if (taktEl) taktEl.textContent = '-';
        if (efficiencyEl) efficiencyEl.textContent = '-';
        if (completionEl) completionEl.textContent = '-';
        return;
    }

    try {
        const url = date
            ? `${API_BASE}/lines/${lineId}/metrics?date=${date}`
            : `${API_BASE}/lines/${lineId}/metrics`;
        const response = await fetch(url);
        const result = await response.json();

        if (result.success && result.data) {
            const data = result.data;
            if (targetEl) targetEl.textContent = data.target || 0;
            if (outputEl) outputEl.textContent = data.actual_output || 0;
            if (taktEl) taktEl.textContent = data.takt_time_display || '-';
            if (efficiencyEl) efficiencyEl.textContent = `${Number(data.efficiency_percent || 0).toFixed(2)}%`;
            if (completionEl) completionEl.textContent = `${Number(data.completion_percent || 0).toFixed(1)}%`;
        } else {
            if (targetEl) targetEl.textContent = '-';
            if (outputEl) outputEl.textContent = '-';
            if (taktEl) taktEl.textContent = '-';
            if (efficiencyEl) efficiencyEl.textContent = '-';
            if (completionEl) completionEl.textContent = '-';
        }
    } catch (err) {
        console.warn('Failed to load production stats:', err);
    }
}

function setupRealtime() {
    const handleDataChange = (payload) => {
        if (!payload) return;
        if (payload.entity === 'attendance') {
            const active = document.querySelector('.nav-link.active')?.dataset.section;
            if (active === 'scan') {
                // no reload, just keep UI live
            }
        }
        if (payload.entity === 'progress') {
            // no-op for now
        }
        if (payload.entity === 'materials') {
            const active = document.querySelector('.nav-link.active')?.dataset.section;
            if (active === 'materials') {
                loadMaterialData();
            }
        }
    };

    // Use SSE Manager if available
    if (typeof SSEManager !== 'undefined') {
        SSEManager.init('/events');
        SSEManager.on('data_change', handleDataChange);
    } else {
        // Fallback to direct EventSource
        const source = new EventSource('/events');
        source.addEventListener('data_change', (event) => {
            let payload = {};
            try {
                payload = JSON.parse(event.data || '{}');
            } catch (err) {
                return;
            }
            handleDataChange(payload);
        });
        source.onerror = () => {
            source.close();
            setTimeout(setupRealtime, 3000);
        };
    }
}

// ============================================================================
// MATERIAL TRACKING SECTION
// ============================================================================

const materialState = {
    lineId: '',
    processes: []
};

async function loadMaterialsSection() {
    const content = document.getElementById('supervisor-content');
    content.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';

    try {
        const response = await fetch(`${API_BASE}/supervisor/lines`);
        const result = await response.json();
        const lines = result.data || [];
        const date = new Date().toISOString().slice(0, 10);

        content.innerHTML = `
            <div class="page-header">
                <div>
                    <h1 class="page-title">Material Tracking</h1>
                    <p class="page-subtitle">Auto-synced from process progress</p>
                </div>
                <div class="supervisor-controls">
                    <div>
                        <label class="form-label">Line</label>
                        <select class="form-control" id="material-line">
                            <option value="">Select Line</option>
                            ${lines.map(line => `
                                <option value="${line.id}">
                                    ${line.line_name} (${line.line_code})
                                </option>
                            `).join('')}
                        </select>
                    </div>
                    <div>
                        <label class="form-label">Date</label>
                        <input type="date" class="form-control" id="material-date" value="${date}">
                    </div>
                    <div class="summary-controls-action">
                        <button class="btn btn-secondary" id="material-add">Add Materials</button>
                        <button class="btn btn-primary" id="material-load">Refresh</button>
                    </div>
                </div>
            </div>

            <div class="card">
                <div class="card-header">
                    <h3 class="card-title">Process Materials Snapshot</h3>
                </div>
                <div class="card-body">
                    <div id="wip-list" class="wip-list">
                        <div class="alert alert-info">Select a line to view material flow.</div>
                    </div>
                </div>
            </div>

            <div class="card">
                <div class="card-header">
                    <h3 class="card-title">Material Events</h3>
                </div>
                <div class="card-body">
                    <div id="transaction-list" class="transaction-list">
                        <div class="alert alert-info">Select a line to view material events.</div>
                    </div>
                </div>
            </div>
        `;

        document.getElementById('material-line').addEventListener('change', async () => {
            materialState.lineId = document.getElementById('material-line').value;
            await loadMaterialProcesses();
            await loadMaterialData();
        });
        document.getElementById('material-date').addEventListener('change', loadMaterialData);
        document.getElementById('material-load').addEventListener('click', loadMaterialData);
        document.getElementById('material-add').addEventListener('click', openMaterialAddModal);

        materialState.lineId = '';
    } catch (err) {
        content.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    }
}

async function loadMaterialProcesses() {
    if (!materialState.lineId) {
        materialState.processes = [];
        return;
    }
    const date = document.getElementById('material-date').value;
    try {
        const response = await fetch(`${API_BASE}/supervisor/materials/processes/${materialState.lineId}?date=${date}`);
        const result = await response.json();
        materialState.processes = result.data || [];

        const options = materialState.processes.map(p =>
            `<option value="${p.id}">${p.sequence_number}. ${p.operation_code} - ${p.operation_name}</option>`
        ).join('');

        document.getElementById('material-from-process').innerHTML = `<option value="">Select Process</option>${options}`;
        document.getElementById('material-to-process').innerHTML = `<option value="">Select Process</option>${options}`;
    } catch (err) {
        showToast('Failed to load processes', 'error');
    }
}

async function loadMaterialData() {
    const lineId = document.getElementById('material-line')?.value;
    const date = document.getElementById('material-date')?.value;

    if (!lineId) {
        document.getElementById('wip-list').innerHTML = '<div class="alert alert-info">Select a line to view material flow.</div>';
        document.getElementById('transaction-list').innerHTML = '<div class="alert alert-info">Select a line to view transactions.</div>';
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/supervisor/materials?line_id=${lineId}&date=${date}`);
        const result = await response.json();

        if (result.success && result.data) {
            const { transactions, wip_by_process } = result.data;
            const rows = wip_by_process || [];
            const latestByProcess = new Map();

            (transactions || []).forEach((transaction) => {
                const processIds = [];
                if (transaction.from_process_id) processIds.push(String(transaction.from_process_id));
                if (transaction.to_process_id) processIds.push(String(transaction.to_process_id));
                processIds.forEach((processId) => {
                    if (!latestByProcess.has(processId)) {
                        latestByProcess.set(processId, transaction);
                    }
                });
            });

            if (rows.length) {
                document.getElementById('wip-list').innerHTML = `
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Process</th>
                                <th>Materials Received</th>
                                <th>Units Forwarded</th>
                                <th>WIP materials - Remaining</th>
                                <th>Latest Update</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows.map(w => `
                                <tr>
                                    <td>${w.sequence_number}. ${w.operation_code} - ${w.operation_name}</td>
                                    <td>${w.materials_in || 0}</td>
                                    <td>${w.materials_out || 0}</td>
                                    <td><strong>${w.wip_quantity || 0}</strong></td>
                                    <td>${formatMaterialUpdate(latestByProcess.get(String(w.process_id)))}</td>
                                    <td>
                                        <button class="btn btn-secondary btn-sm material-details-btn"
                                            data-process-id="${w.process_id}"
                                            data-process-label="${w.sequence_number}. ${w.operation_code} - ${w.operation_name}">
                                            Details
                                        </button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                `;
                document.querySelectorAll('.material-details-btn').forEach((button) => {
                    button.addEventListener('click', (event) => {
                        const { processId, processLabel } = event.currentTarget.dataset;
                        openMaterialDetailsModal({
                            lineId,
                            date,
                            processId,
                            processLabel
                        });
                    });
                });
            } else {
                document.getElementById('wip-list').innerHTML = '<div class="alert alert-warning">No material data recorded yet.</div>';
            }

            if (transactions.length) {
                document.getElementById('transaction-list').innerHTML = `
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Time</th>
                                <th>Type</th>
                                <th>Qty</th>
                                <th>From</th>
                                <th>To</th>
                                <th>Notes</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${transactions.map(t => `
                                <tr>
                                    <td>${new Date(t.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</td>
                                    <td><span class="badge badge-${getTransactionBadgeClass(t.transaction_type)}">${t.transaction_type}</span></td>
                                    <td>${t.quantity}</td>
                                    <td>${t.from_operation ? `${t.from_sequence}. ${t.from_operation}` : '-'}</td>
                                    <td>${t.to_operation ? `${t.to_sequence}. ${t.to_operation}` : '-'}</td>
                                    <td>${t.notes || '-'}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                `;
            } else {
                document.getElementById('transaction-list').innerHTML = '<div class="alert alert-warning">No material events recorded yet.</div>';
            }
        }
    } catch (err) {
        showToast('Failed to load material data', 'error');
    }
}

function formatMaterialUpdate(update) {
    if (!update) return '-';
    const timeLabel = new Date(update.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    return `${timeLabel} · ${update.transaction_type} ${update.quantity}`;
}

function openMaterialDetailsModal({ lineId, date, processId, processLabel }) {
    const existing = document.getElementById('material-details-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.className = 'progress-modal-backdrop';
    modal.id = 'material-details-modal';
    modal.innerHTML = `
        <div class="progress-modal">
            <div class="progress-modal-header">
                <h3>Material Log</h3>
                <button class="modal-close" type="button" id="material-details-close">
                    <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                    </svg>
                </button>
            </div>
            <div class="progress-modal-body">
                <div class="material-log-title">${processLabel}</div>
                <div id="material-details-body">
                    <div class="alert alert-info">Loading log...</div>
                </div>
            </div>
            <div class="progress-modal-footer">
                <button class="btn btn-secondary" type="button" id="material-details-dismiss">Close</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    setTimeout(() => modal.classList.add('active'), 10);

    const close = () => {
        modal.classList.remove('active');
        setTimeout(() => modal.remove(), 150);
    };
    document.getElementById('material-details-close').addEventListener('click', close);
    document.getElementById('material-details-dismiss').addEventListener('click', close);

    fetch(`${API_BASE}/supervisor/materials/log?line_id=${lineId}&date=${date}&process_id=${processId}`)
        .then((response) => response.json())
        .then((result) => {
            if (!result.success) {
                document.getElementById('material-details-body').innerHTML = `<div class="alert alert-danger">${result.error || 'Unable to load log'}</div>`;
                return;
            }
            const logs = result.data || [];
            if (!logs.length) {
                document.getElementById('material-details-body').innerHTML = '<div class="alert alert-warning">No material events recorded for this process.</div>';
                return;
            }
            document.getElementById('material-details-body').innerHTML = `
                <div class="material-log-table">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Time</th>
                                <th>Type</th>
                                <th>Qty</th>
                                <th>From</th>
                                <th>To</th>
                                <th>Notes</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${logs.map(log => `
                                <tr>
                                    <td>${new Date(log.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</td>
                                    <td><span class="badge badge-${getTransactionBadgeClass(log.transaction_type)}">${log.transaction_type}</span></td>
                                    <td>${log.quantity}</td>
                                    <td>${log.from_operation ? `${log.from_sequence}. ${log.from_operation}` : '-'}</td>
                                    <td>${log.to_operation ? `${log.to_sequence}. ${log.to_operation}` : '-'}</td>
                                    <td>${log.notes || '-'}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        })
        .catch(() => {
            document.getElementById('material-details-body').innerHTML = '<div class="alert alert-danger">Unable to load log.</div>';
        });
}

function openMaterialAddModal() {
    const lineId = document.getElementById('material-line')?.value;
    const date = document.getElementById('material-date')?.value;
    if (!lineId || !date) {
        showToast('Select a line and date first', 'error');
        return;
    }
    if (!materialState.processes.length) {
        showToast('No process flow found for this line', 'error');
        return;
    }
    const existing = document.getElementById('material-add-modal');
    if (existing) existing.remove();
    const modal = document.createElement('div');
    modal.className = 'progress-modal-backdrop';
    modal.id = 'material-add-modal';
    modal.innerHTML = `
        <div class="progress-modal">
            <div class="progress-modal-header">
                <h3>Add Materials</h3>
                <button class="modal-close" type="button" id="material-add-close">
                    <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                    </svg>
                </button>
            </div>
            <div class="progress-modal-body">
                <label class="form-label">Process</label>
                <select class="form-control" id="material-add-process">
                    ${materialState.processes.map(p => `
                        <option value="${p.id}">${p.sequence_number}. ${p.operation_code} - ${p.operation_name}</option>
                    `).join('')}
                </select>
                <label class="form-label">Quantity</label>
                <input type="number" class="form-control" id="material-add-qty" min="1" value="1">
            </div>
            <div class="progress-modal-footer">
                <button class="btn btn-secondary" type="button" id="material-add-cancel">Cancel</button>
                <button class="btn btn-primary" type="button" id="material-add-save">Add</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    setTimeout(() => modal.classList.add('active'), 10);

    const close = () => {
        modal.classList.remove('active');
        setTimeout(() => modal.remove(), 150);
    };
    document.getElementById('material-add-close').addEventListener('click', close);
    document.getElementById('material-add-cancel').addEventListener('click', close);
    document.getElementById('material-add-save').addEventListener('click', async () => {
        const processId = document.getElementById('material-add-process').value;
        const qty = document.getElementById('material-add-qty').value;
        if (!processId || !qty || Number(qty) <= 0) {
            showToast('Enter a valid quantity', 'error');
            return;
        }
        try {
            const response = await fetch(`${API_BASE}/supervisor/materials`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    line_id: lineId,
                    work_date: date,
                    transaction_type: 'issued',
                    quantity: parseInt(qty, 10),
                    to_process_id: processId,
                    notes: 'Manual material add'
                })
            });
            const result = await response.json();
            if (!result.success) {
                showToast(result.error, 'error');
                return;
            }
            showToast('Materials added', 'success');
            close();
            loadMaterialData();
        } catch (err) {
            showToast(err.message, 'error');
        }
    });
}

function getTransactionBadgeClass(type) {
    switch (type) {
        case 'issued': return 'blue';
        case 'used': return 'orange';
        case 'returned': return 'green';
        case 'forwarded': return 'purple';
        default: return 'secondary';
    }
}

async function submitMaterialTransaction() {
    const lineId = document.getElementById('material-line').value;
    const date = document.getElementById('material-date').value;
    const type = document.getElementById('material-type').value;
    const quantity = document.getElementById('material-quantity').value;
    const fromProcess = document.getElementById('material-from-process').value;
    const toProcess = document.getElementById('material-to-process').value;
    const notes = document.getElementById('material-notes').value;

    if (!lineId) {
        showToast('Select a line first', 'error');
        return;
    }
    if (!quantity || quantity < 1) {
        showToast('Quantity must be at least 1', 'error');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/supervisor/materials`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                line_id: lineId,
                work_date: date,
                transaction_type: type,
                quantity: parseInt(quantity),
                from_process_id: fromProcess || null,
                to_process_id: toProcess || null,
                notes: notes || null
            })
        });
        const result = await response.json();
        if (!result.success) {
            showToast(result.error, 'error');
            return;
        }
        showToast('Transaction recorded', 'success');
        document.getElementById('material-quantity').value = '1';
        document.getElementById('material-notes').value = '';
        await loadMaterialData();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ============================================================================
// SHIFT SUMMARY SECTION
// ============================================================================

async function loadShiftSummarySection() {
    const content = document.getElementById('supervisor-content');
    content.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';

    try {
        const response = await fetch(`${API_BASE}/supervisor/lines`);
        const result = await response.json();
        const lines = result.data || [];
        const date = new Date().toISOString().slice(0, 10);

        content.innerHTML = `
            <div class="page-header">
                <div>
                    <h1 class="page-title">End-of-Shift Summary</h1>
                    <p class="page-subtitle">Daily production summary and metrics</p>
                </div>
                <div class="supervisor-controls">
                    <div>
                        <label class="form-label">Line</label>
                        <select class="form-control" id="summary-line">
                            <option value="">Select Line</option>
                            ${lines.map(line => `
                                <option value="${line.id}">
                                    ${line.line_name} (${line.line_code})
                                </option>
                            `).join('')}
                        </select>
                    </div>
                    <div>
                        <label class="form-label">Date</label>
                        <input type="date" class="form-control" id="summary-date" value="${date}">
                    </div>
                    <div class="summary-controls-action">
                        <button class="btn btn-primary" id="summary-load">Load Summary</button>
                    </div>
                </div>
            </div>

            <div id="summary-content">
                <div class="alert alert-info">Select a line and date, then click "Load Summary" to view the shift report.</div>
            </div>
        `;

        document.getElementById('summary-load').addEventListener('click', loadShiftSummaryData);
    } catch (err) {
        content.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    }
}

async function loadShiftSummaryData() {
    const lineId = document.getElementById('summary-line').value;
    const date = document.getElementById('summary-date').value;
    const container = document.getElementById('summary-content');

    if (!lineId) {
        showToast('Select a line first', 'error');
        return;
    }

    container.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';

    try {
        const response = await fetch(`${API_BASE}/supervisor/shift-summary?line_id=${lineId}&date=${date}`);
        const result = await response.json();

        if (!result.success) {
            container.innerHTML = `<div class="alert alert-danger">${result.error}</div>`;
            return;
        }

        const data = result.data;
        const { line, metrics, hourly_output, process_output, employees, materials, shift } = data;

        container.innerHTML = `
            <div class="summary-header">
                <div class="summary-line-info">
                    <h2>${line.line_name}</h2>
                    <p>${line.product_code} - ${line.product_name}</p>
                    <p class="summary-date">${new Date(date).toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
                </div>
                <div style="display:flex; gap:12px; align-items:center; margin-top:8px;">
                    <span class="badge ${shift?.is_closed ? 'badge-green' : 'badge-orange'}">
                        ${shift?.is_closed ? 'Shift Closed' : 'Shift Open'}
                    </span>
                    ${shift?.is_closed
                        ? `<span style="color: var(--secondary); font-size: 12px;">${shift?.closed_at ? new Date(shift.closed_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : ''}</span>`
                        : `<button class="btn btn-danger btn-sm" id="summary-close-shift">Close Shift</button>`
                    }
                </div>
            </div>

            <div class="stats-grid" style="grid-template-columns: repeat(6, 1fr);">
                <div class="stat-card">
                    <div class="stat-info">
                        <h3>${metrics.target}</h3>
                        <p>Target</p>
                    </div>
                </div>
                <div class="stat-card ${metrics.completion_percent >= 100 ? 'stat-success' : ''}">
                    <div class="stat-info">
                        <h3>${metrics.total_output}</h3>
                        <p>Actual Output</p>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-info">
                        <h3>${metrics.qa_output || 0}</h3>
                        <p>QA Output</p>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-info">
                        <h3>${metrics.takt_time_display}</h3>
                        <p>Takt Time</p>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-info">
                        <h3>${metrics.efficiency_percent.toFixed(2)}%</h3>
                        <p>Efficiency</p>
                    </div>
                </div>
                <div class="stat-card ${metrics.completion_percent >= 100 ? 'stat-success' : metrics.completion_percent >= 80 ? 'stat-warning' : 'stat-danger'}">
                    <div class="stat-info">
                        <h3>${metrics.completion_percent.toFixed(1)}%</h3>
                        <p>Completion</p>
                    </div>
                </div>
            </div>

            <div class="summary-grid">
                <div class="card">
                    <div class="card-header">
                        <h3 class="card-title">Hourly Output</h3>
                    </div>
                    <div class="card-body">
                        ${hourly_output.length ? `
                            <div class="hourly-chart">
                                ${hourly_output.map(h => `
                                    <div class="hourly-bar-container">
                                        <div class="hourly-bar" style="height: ${Math.min((h.total_quantity / (metrics.target / 9)) * 100, 100)}%">
                                            <span class="hourly-value">${h.total_quantity}</span>
                                        </div>
                                        <span class="hourly-label">${String(h.hour_slot).padStart(2, '0')}:00</span>
                                    </div>
                                `).join('')}
                            </div>
                        ` : '<div class="alert alert-warning">No hourly data recorded.</div>'}
                    </div>
                </div>

                <div class="card">
                    <div class="card-header">
                        <h3 class="card-title">Materials Summary</h3>
                    </div>
                    <div class="card-body">
                        <div class="material-summary-grid">
                            <div class="material-summary-item">
                                <span class="label">Opening Stock</span>
                                <span class="value">${materials.opening_stock || 0}</span>
                            </div>
                            <div class="material-summary-item">
                                <span class="label">Total Issued</span>
                                <span class="value">${materials.total_issued || 0}</span>
                            </div>
                            <div class="material-summary-item">
                                <span class="label">Total Used</span>
                                <span class="value">${materials.total_used || 0}</span>
                            </div>
                            <div class="material-summary-item">
                                <span class="label">Returned</span>
                                <span class="value">${materials.total_returned || 0}</span>
                            </div>
                            <div class="material-summary-item">
                                <span class="label">Forwarded</span>
                                <span class="value">${materials.forwarded_to_next || 0}</span>
                            </div>
                            <div class="material-summary-item">
                                <span class="label">Remaining WIP</span>
                                <span class="value">${materials.remaining_wip || 0}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="card">
                <div class="card-header">
                    <h3 class="card-title">Employee Output</h3>
                    <span class="badge badge-blue">${employees.length} workers</span>
                </div>
                <div class="card-body">
                    ${employees.length ? `
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th>Code</th>
                                    <th>Name</th>
                                    <th>Operation</th>
                                    <th>In</th>
                                    <th>Out</th>
                                    <th>Status</th>
                                    <th>Output</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${employees.map(e => `
                                    <tr>
                                        <td>${e.emp_code}</td>
                                        <td>${e.emp_name}</td>
                                        <td>${e.sequence_number}. ${e.operation_code}</td>
                                        <td>${e.in_time || '-'}</td>
                                        <td>${e.out_time || '-'}</td>
                                        <td><span class="badge badge-${e.status === 'present' ? 'green' : e.status === 'absent' ? 'red' : 'secondary'}">${e.status || 'N/A'}</span></td>
                                        <td><strong>${e.total_output || 0}</strong></td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    ` : '<div class="alert alert-warning">No employees assigned to this line.</div>'}
                </div>
            </div>

            <div class="card">
                <div class="card-header">
                    <h3 class="card-title">Output by Process</h3>
                </div>
                <div class="card-body">
                    ${process_output.length ? `
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>Operation</th>
                                    <th>Total Output</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${process_output.map(p => `
                                    <tr>
                                        <td>${p.sequence_number}</td>
                                        <td>${p.operation_code} - ${p.operation_name}</td>
                                        <td><strong>${p.total_quantity || 0}</strong></td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    ` : '<div class="alert alert-warning">No process output data.</div>'}
                </div>
            </div>

            <div class="summary-footer">
                <p>Report generated: ${new Date().toLocaleString('en-IN')}</p>
                <p>Working Hours: ${metrics.working_hours}h | Manpower: ${metrics.manpower} | SAH: ${metrics.total_sah.toFixed(4)}</p>
            </div>
        `;

        if (!shift?.is_closed) {
            const closeBtn = document.getElementById('summary-close-shift');
            if (closeBtn) {
                closeBtn.addEventListener('click', async () => {
                    const closed = await submitCloseShift(lineId, date);
                    if (closed) {
                        await loadShiftSummaryData();
                    }
                });
            }
        }
    } catch (err) {
        container.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
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
    }, 2500);
}
