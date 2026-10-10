(() => {
  const form = document.getElementById('auth-form');
  const errorNode = document.getElementById('auth-error');
  const registerFields = document.getElementById('register-fields');
  const submit = document.getElementById('auth-submit');
  const switchButton = document.getElementById('auth-switch');
  const authScreen = document.getElementById('auth-screen');
  let registering = false;
  let adminExists = true;
  let authStatusLoaded = false;
  let selectedAvatar = null;
  let removeAvatar = false;
  let profile = null;

  const t = key => (typeof lang !== 'undefined' ? lang.t(key) : key);
  const applyAuthTranslations = () => document.querySelectorAll('#auth-screen [data-lang], #admin-profile-modal [data-lang], #admin-logout-button[data-lang], #collapsed-admin-logout-button[data-lang]').forEach(element => { element.textContent = t(element.dataset.lang); });
  const initials = user => `${user?.firstName?.trim()?.[0] || ''}${user?.lastName?.trim()?.[0] || ''}`.toUpperCase() || 'A';
  const colorFor = user => {
    const text = `${user?.firstName || ''}${user?.lastName || ''}`;
    let hash = 0;
    for (const char of text) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
    return `hsl(${Math.abs(hash) % 360} 58% 44%)`;
  };
  const paintAvatar = (element, user) => {
    if (!element || !user) return;
    element.textContent = user.avatar ? '' : initials(user);
    element.style.background = user.avatar ? `center / cover no-repeat url("${user.avatar}")` : colorFor(user);
    element.setAttribute('aria-label', `${user.firstName} ${user.lastName}`);
  };
  const showError = message => { errorNode.textContent = message || ''; };

  function setMode(isRegistering) {
    registering = Boolean(isRegistering && !adminExists);
    switchButton.hidden = !authStatusLoaded || adminExists;
    applyAuthTranslations();
    registerFields.hidden = !registering;
    registerFields.querySelectorAll('input').forEach(input => { input.required = registering; });
    form.elements.password.autocomplete = registering ? 'new-password' : 'current-password';
    document.querySelector('[data-lang="authTitle"]').textContent = t(registering ? 'authRegister' : 'authTitle');
    const descriptionKey = registering ? 'authSwitchRegister' : (authStatusLoaded && adminExists ? 'authRegistrationClosed' : 'authDescription');
    document.getElementById('auth-description').textContent = t(descriptionKey);
    submit.textContent = t(registering ? 'authRegister' : 'authLogin');
    switchButton.textContent = t(adminExists ? 'authRegistrationClosed' : (registering ? 'authSwitchLogin' : 'authSwitchRegister'));
    showError('');
  }

  async function request(url, options = {}) {
    const response = await fetch(url, { credentials: 'same-origin', ...options });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
    return result;
  }

  function openProfile() {
    applyAuthTranslations();
    const modal = document.getElementById('admin-profile-modal');
    document.getElementById('profile-first-name').value = profile.firstName || '';
    document.getElementById('profile-last-name').value = profile.lastName || '';
    document.getElementById('profile-birth-date').value = profile.birthDate || '';
    document.getElementById('profile-email').value = profile.email || '';
    selectedAvatar = null;
    removeAvatar = false;
    document.getElementById('profile-avatar-file').value = '';
    paintAvatar(document.getElementById('profile-avatar-preview'), profile);
    modal.classList.add('active');
  }

  function updateHeader() {
    document.getElementById('admin-profile-name').textContent = `${profile.firstName} ${profile.lastName}`;
    paintAvatar(document.getElementById('admin-avatar'), profile);
    const collapsedAvatar = document.getElementById('collapsed-admin-avatar');
    paintAvatar(collapsedAvatar, profile);
    const collapsedProfileButton = document.getElementById('collapsed-admin-profile-button');
    if (collapsedProfileButton) collapsedProfileButton.title = `${profile.firstName} ${profile.lastName}`;
  }

  async function bootApplication() {
    document.body.classList.add('authenticated');
    authScreen.hidden = true;
    updateHeader();
    const socketScript = document.createElement('script');
    socketScript.src = '/socket.io/socket.io.js';
    socketScript.onload = () => {
      const appScript = document.createElement('script');
      appScript.src = 'app.js';
      document.body.appendChild(appScript);
    };
    document.body.appendChild(socketScript);
  }

  switchButton.addEventListener('click', () => setMode(!registering));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    submit.disabled = true;
    showError('');
    const data = Object.fromEntries(new FormData(form).entries());
    try {
      const result = await request(registering ? '/api/auth/register' : '/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
      });
      profile = result.profile;
      adminExists = true;
      await bootApplication();
    } catch (error) { showError(error.message); }
    finally { submit.disabled = false; }
  });
  document.getElementById('admin-profile-button').addEventListener('click', openProfile);
  document.getElementById('collapsed-admin-profile-button').addEventListener('click', openProfile);
  document.getElementById('admin-logout-button').addEventListener('click', async () => {
    await request('/api/auth/logout', { method: 'POST' }).catch(() => {});
    window.location.reload();
  });
  document.getElementById('collapsed-admin-logout-button').addEventListener('click', () => document.getElementById('admin-logout-button').click());
  document.getElementById('profile-avatar-file').addEventListener('change', event => {
    selectedAvatar = event.target.files?.[0] || null;
    removeAvatar = false;
    if (selectedAvatar) paintAvatar(document.getElementById('profile-avatar-preview'), { ...profile, avatar: URL.createObjectURL(selectedAvatar) });
  });
  document.getElementById('remove-profile-avatar').addEventListener('click', () => {
    selectedAvatar = null;
    removeAvatar = true;
    paintAvatar(document.getElementById('profile-avatar-preview'), { ...profile, avatar: '' });
  });
  document.getElementById('admin-profile-form').addEventListener('submit', async event => {
    event.preventDefault();
    const data = new FormData();
    data.set('firstName', document.getElementById('profile-first-name').value);
    data.set('lastName', document.getElementById('profile-last-name').value);
    data.set('birthDate', document.getElementById('profile-birth-date').value);
    data.set('email', document.getElementById('profile-email').value);
    data.set('removeAvatar', String(removeAvatar));
    if (selectedAvatar) data.set('avatar', selectedAvatar);
    try {
      const result = await request('/api/auth/profile', { method: 'PUT', body: data });
      profile = result.profile;
      updateHeader();
      document.getElementById('admin-profile-modal').classList.remove('active');
      window.showToast?.(t('authSaved'), 'success');
    } catch (error) { window.showToast?.(error.message, 'error'); }
  });
  document.getElementById('admin-password-form').addEventListener('submit', async event => {
    event.preventDefault();
    try {
      await request('/api/auth/password', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword: document.getElementById('current-admin-password').value, newPassword: document.getElementById('new-admin-password').value }) });
      event.target.reset();
      window.showToast?.(t('authSaved'), 'success');
    } catch (error) { window.showToast?.(error.message, 'error'); }
  });
  document.getElementById('delete-admin-account-button').addEventListener('click', async event => {
    if (!window.confirm(t('confirmDeleteAdminAccount'))) return;
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await request('/api/auth/account', { method: 'DELETE' });
      window.location.reload();
    } catch (error) {
      window.showToast?.(error.message, 'error');
      button.disabled = false;
    }
  });
  document.querySelectorAll('#admin-profile-modal .close-modal').forEach(button => button.addEventListener('click', () => document.getElementById('admin-profile-modal').classList.remove('active')));

  setMode(false);
  request('/api/auth/status').then(status => {
    if (status.authenticated) {
      authStatusLoaded = true;
      profile = status.profile;
      bootApplication();
    } else {
      authStatusLoaded = true;
      adminExists = Boolean(status.adminExists);
      setMode(!status.adminExists);
      authScreen.hidden = false;
    }
  }).catch(error => { adminExists = true; setMode(false); showError(error.message); authScreen.hidden = false; });
})();
