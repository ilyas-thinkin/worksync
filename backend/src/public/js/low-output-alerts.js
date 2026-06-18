// Low Output Alerts — behaviour only.
// HTML elements (#loa-fab, #loa-backdrop, #loa-modal-body, etc.) are static in ie.html.

(function () {
    var alertData = [];
    var activeTab = 'summary';

    function escHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function updateBadge() {
        var fab   = document.getElementById('loa-fab');
        var badge = document.getElementById('loa-badge');
        if (!fab || !badge) return;
        var count = alertData.length;
        if (count > 0) {
            badge.textContent = count > 99 ? '99+' : count;
            badge.style.display = 'flex';
            fab.style.background = '#B91C1C';
            fab.style.boxShadow = '0 4px 18px rgba(185,28,28,.5)';
            fab.style.animation = 'loaPulse 2s ease-in-out infinite';
        } else {
            badge.textContent = '';
            badge.style.display = 'none';
            fab.style.background = '#B45309';
            fab.style.boxShadow = '0 4px 18px rgba(180,83,9,.5)';
            fab.style.animation = '';
        }
    }

    function openModal() {
        var bd = document.getElementById('loa-backdrop');
        if (bd) bd.classList.add('active');
        renderModal();
        fetchAlerts().then(renderModal);
    }

    function closeModal() {
        var bd = document.getElementById('loa-backdrop');
        if (bd) bd.classList.remove('active');
    }

    function renderModal() {
        var body = document.getElementById('loa-modal-body');
        if (!body) return;
        if (alertData.length === 0) {
            body.innerHTML =
                '<div class="loa-empty">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="52" height="52" aria-hidden="true">' +
                '<path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>' +
                '<p>All on track</p>' +
                '<span>No workstations with 3+ consecutive hours below target</span>' +
                '</div>';
            return;
        }
        body.innerHTML = activeTab === 'summary' ? renderSummaryTab() : renderDetailsTab();
    }

    function renderSummaryTab() {
        var rows = alertData.map(function(a) {
            var cumulativeTarget  = a.hourly_target * a.all_hours.length;
            var cumulativeAchieved = a.all_hours.reduce(function(sum, h) { return sum + h.quantity; }, 0);
            var achievedClass = cumulativeAchieved < cumulativeTarget ? 'loa-summary-achieved-low' : 'loa-summary-achieved-ok';
            return '<tr>' +
                '<td>' + escHtml(a.emp_code) + ' — ' + escHtml(a.emp_name) + '</td>' +
                '<td>' + escHtml(a.line_code) + ' / WS ' + escHtml(a.workstation_code) + '</td>' +
                '<td>' + cumulativeTarget + '</td>' +
                '<td class="' + achievedClass + '">' + cumulativeAchieved + '</td>' +
                '</tr>';
        }).join('');
        return '<p class="loa-subtitle">' + alertData.length +
            ' employee' + (alertData.length !== 1 ? 's' : '') +
            ' with 3+ consecutive hours below target</p>' +
            '<div class="loa-table-wrap"><table class="loa-summary-table">' +
            '<thead><tr><th>Employee</th><th>Workstation</th><th>Cumulative Target</th><th>Output Achieved</th></tr></thead>' +
            '<tbody>' + rows + '</tbody></table></div>';
    }

    function renderDetailsTab() {
        var cards = alertData.map(function(a) {
            var rows = a.all_hours.map(function(h) {
                var low = h.quantity < a.hourly_target;
                return '<tr class="' + (low ? 'loa-row-low' : 'loa-row-ok') + '">' +
                    '<td>' + String(h.hour).padStart(2,'0') + ':00</td>' +
                    '<td class="loa-qty">' + h.quantity + '</td>' +
                    '<td>' + a.hourly_target + '</td>' +
                    '<td class="loa-reason">' + escHtml(h.reason || '—') + '</td></tr>';
            }).join('');
            return '<div class="loa-card">' +
                '<div class="loa-card-header">' +
                  '<div class="loa-emp-info">' +
                    '<span class="loa-emp-code">' + escHtml(a.emp_code) + '</span>' +
                    '<span class="loa-emp-name">' + escHtml(a.emp_name) + '</span>' +
                  '</div>' +
                  '<span class="loa-streak-badge">' + a.consecutive_low_count + 'h low streak</span>' +
                '</div>' +
                '<div class="loa-card-meta">' +
                  '<span class="loa-meta-item">' + escHtml(a.line_code) + ' — ' + escHtml(a.line_name) + '</span>' +
                  '<span class="loa-meta-item">WS ' + escHtml(a.workstation_code) + '</span>' +
                  (a.operations ? '<span class="loa-meta-item loa-meta-ops">' + escHtml(a.operations) + '</span>' : '') +
                '</div>' +
                '<div class="loa-table-wrap"><table class="loa-table">' +
                  '<thead><tr><th>Hour</th><th>Output</th><th>Target</th><th>Reason</th></tr></thead>' +
                  '<tbody>' + rows + '</tbody>' +
                '</table></div></div>';
        }).join('');
        return '<p class="loa-subtitle">' + alertData.length +
            ' employee' + (alertData.length !== 1 ? 's' : '') +
            ' with 3+ consecutive hours below target</p>' +
            '<div class="loa-list">' + cards + '</div>';
    }

    function fetchAlerts() {
        var today = new Date().toISOString().slice(0, 10);
        return fetch('/api/alerts/low-output?date=' + today)
            .then(function(r) { return r.json(); })
            .then(function(result) {
                if (result.success) { alertData = result.data || []; updateBadge(); }
            })
            .catch(function() {});
    }

    function init() {
        var fab   = document.getElementById('loa-fab');
        var closeBtn = document.getElementById('loa-modal-close');
        var backdrop = document.getElementById('loa-backdrop');
        var tabs = document.getElementById('loa-tabs');

        if (!fab) return;   // not on this page

        fab.addEventListener('click', openModal);
        if (closeBtn) closeBtn.addEventListener('click', closeModal);
        if (backdrop) backdrop.addEventListener('click', function(e) {
            if (e.target === backdrop) closeModal();
        });
        if (tabs) tabs.addEventListener('click', function(e) {
            var btn = e.target.closest('.loa-tab');
            if (!btn) return;
            activeTab = btn.getAttribute('data-tab');
            tabs.querySelectorAll('.loa-tab').forEach(function(t) {
                t.classList.toggle('active', t === btn);
            });
            renderModal();
        });
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') closeModal();
        });

        fetchAlerts();
        setInterval(fetchAlerts, 5 * 60 * 1000);

        if (typeof SSEManager !== 'undefined') {
            SSEManager.on('data_change', fetchAlerts);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
