let currentRole = null;

function openLogin(role) {
    currentRole = role;
    document.getElementById('login-title').textContent = `${role.toUpperCase()} Login`;
    document.getElementById('login-password').value = '';
    document.getElementById('login-error').style.display = 'none';
    const modal = document.getElementById('login-modal');
    modal.classList.add('active');
    setTimeout(() => document.getElementById('login-password').focus(), 50);
}

function closeLogin() {
    const modal = document.getElementById('login-modal');
    modal.classList.remove('active');
}

async function submitLogin() {
    const password = document.getElementById('login-password').value;
    try {
        const response = await fetch('/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: currentRole, password })
        });
        const result = await response.json();
        if (!result.success) {
            document.getElementById('login-error').textContent = result.error || 'Invalid password';
            document.getElementById('login-error').style.display = 'block';
            return;
        }
        window.location.href = result.redirect;
    } catch (err) {
        document.getElementById('login-error').textContent = 'Login failed';
        document.getElementById('login-error').style.display = 'block';
    }
}

window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeLogin();
    if (event.key === 'Enter' && document.getElementById('login-modal').classList.contains('active')) {
        submitLogin();
    }
});
