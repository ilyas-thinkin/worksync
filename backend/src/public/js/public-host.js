// Moves this browser from an old LAN address (https://worksync, worksync.local, the Pi's IP),
// which only has a self-signed certificate, to the public name that has a trusted one.
// Used by the server's moving page and by the line TV board (display.js).
//
// It checks first that this device can actually open the public name — its DNS might not
// resolve it — and reports false instead of sending the browser to a page that cannot load.

(function () {
    const PROBE_TIMEOUT_MS = 5000;

    async function canReach(host) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
        try {
            // An opaque response is enough: it only resolves once DNS, TLS and the server all answered.
            await fetch(`https://${host}/health`, { mode: 'no-cors', cache: 'no-store', signal: controller.signal });
            return true;
        } catch (_) {
            return false;
        } finally {
            clearTimeout(timer);
        }
    }

    function postForm(action, fields) {
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = action;
        form.style.display = 'none';
        Object.entries(fields).forEach(([name, value]) => {
            const input = document.createElement('input');
            input.type = 'hidden';
            input.name = name;
            input.value = value;
            form.appendChild(input);
        });
        document.body.appendChild(form);
        form.submit();
    }

    // token: a one-minute sign-in pass from the server, or null when this browser is not signed in.
    // next: the path to open on the public name, e.g. "/display?line=13".
    window.moveToPublicHost = async function moveToPublicHost({ host, token, next }) {
        if (!host || !(await canReach(host))) return false;
        if (token) {
            postForm(`https://${host}/auth/handoff`, { token, next });
        } else {
            window.location.replace(`https://${host}${next}`);
        }
        return true;
    };
})();
