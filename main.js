const blankStarter = {
  basics: { name: '', headline: '', email: '', phone: '', location: '', website: '', dob: '' },
  summary: '',
  skills: 'Communication, Leadership, Teamwork, Engineering, Problem solving, Time management',
  experience: [{ title: '', company: '', location: '', dates: '', achievements: '' }],
  education: [{ degree: '', school: '', location: '', dates: '' }],
  toggles: { summary: true, certifications: false, awards: false, publications: false, memberships: false, positions: false, references: false },
  certifications: [],
  awards: [],
  publications: [],
  memberships: [],
  positions: [],
  references: []
};

const starter = JSON.parse(JSON.stringify(blankStarter));
let data = JSON.parse(localStorage.getItem('northstar-cv')) || JSON.parse(JSON.stringify(blankStarter));
const apiUrl = 'api.php';
const cvIdKey = 'northstar-cv-id';
const userKey = 'northstar-user';
const userIdKey = 'northstar-user-id';

let currentUser = JSON.parse(localStorage.getItem(userKey) || 'null');
let cvId = currentUser?.id || localStorage.getItem(cvIdKey) || crypto.randomUUID();
let pendingResetData = null;
let serverSaveTimer;

if (currentUser?.id) localStorage.setItem(cvIdKey, currentUser.id);

const clone = value => JSON.parse(JSON.stringify(value));

function normalizeData() {
  data.toggles = { ...starter.toggles, ...(data.toggles || {}) };
  data.experience = (data.experience || []).map(entry => ({
    title: '', company: '', location: '', dates: '', achievements: '',
    ...entry,
    achievements: entry.achievements || entry.description || ''
  }));
  data.education = (data.education || []).map(entry => ({ degree: '', school: '', location: '', dates: '', ...entry }));
  Object.keys(config).filter(type => !['experience', 'education'].includes(type)).forEach(type => {
    data[type] = data[type] || [];
  });
}

function get(path) {
  return path.split('.').reduce((obj, key) => obj?.[key], data);
}

function set(path, value) {
  const keys = path.split('.');
  let target = data;
  keys.slice(0, -1).forEach(key => {
    target = target[key];
  });
  target[keys.at(-1)] = value;
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));
}

function updateAccountStatus() {
  const status = document.querySelector('#accountStatus');
  if (!status) return;

  if (currentUser) {
    status.textContent = `Signed in as ${currentUser.name}`;
  } else {
    status.textContent = 'Not signed in — create or access your workspace';
  }
}

async function parseJsonResponse(response) {
  const text = await response.text();
  if (!text) {
    throw new Error('The server returned an empty response.');
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    const isPhpSource = text.includes('<?php') || text.includes('<html') || text.includes('<!doctype html>');
    throw new Error(
      isPhpSource
        ? 'This app must be opened from a local PHP server, for example http://localhost/cv%20generator/login.html.'
        : 'The server returned an invalid response.'
    );
  }
}

function save() {
  localStorage.setItem('northstar-cv', JSON.stringify(data));

  if (!currentUser?.id) {
    const savedState = document.querySelector('#savedState');
    if (savedState) savedState.textContent = 'Create an account to save securely';
    return;
  }

  const savedState = document.querySelector('#savedState');
  if (savedState) savedState.textContent = 'Saving...';

  clearTimeout(serverSaveTimer);
  serverSaveTimer = setTimeout(async () => {
    try {
      const response = await fetch(`${apiUrl}?id=${encodeURIComponent(cvId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: data.basics.name ? `${data.basics.name} CV` : 'My CV',
          cv_data: data,
          user_id: currentUser.id
        })
      });

      if (!response.ok) throw new Error('Save failed');
      if (savedState) savedState.textContent = 'Saved to database';
    } catch (error) {
      if (savedState) savedState.textContent = 'Saved locally';
    }
  }, 350);
}

async function loadFromDatabase() {
  if (!currentUser?.id) return;

  try {
    const response = await fetch(`${apiUrl}?id=${encodeURIComponent(currentUser.id)}`);
    if (!response.ok) return;

    const result = await response.json();
    if (result.cv?.cv_data) {
      data = result.cv.cv_data;
      normalizeData();
      localStorage.setItem('northstar-cv', JSON.stringify(data));
      renderFields();
      hydrateInputs();
      renderPreview();
    }
  } catch (error) {
    // Local storage remains the offline fallback.
  }
}

const config = {
  experience: {
    label: 'Role',
    fields: [['title', 'Position held'], ['company', 'Company name'], ['location', 'Location'], ['dates', 'Employment dates'], ['achievements', 'Achievements']]
  },
  education: {
    label: 'Education',
    fields: [['degree', 'Degree or diploma'], ['school', 'Institution'], ['location', 'Location'], ['dates', 'Graduation or expected date']]
  },
  certifications: { label: 'Certification', fields: [['name', 'Certification or license'], ['issuer', 'Issuer'], ['date', 'Date obtained']] },
  awards: { label: 'Award', fields: [['name', 'Award or honor'], ['organization', 'Organization'], ['date', 'Date awarded']] },
  publications: { label: 'Publication', fields: [['name', 'Title or presentation'], ['publisher', 'Publisher or event'], ['date', 'Publication or date']] },
  memberships: { label: 'Membership', fields: [['name', 'Professional body'], ['level', 'Membership level'], ['date', 'Date joined or expiry']] },
  positions: { label: 'Position', fields: [['name', 'Position title'], ['organization', 'Organization'], ['dates', 'Dates']] },
  references: { label: 'Reference', fields: [['name', 'Referee name'], ['role', 'Role or title'], ['organization', 'Organization'], ['contact', 'Phone or email']] }
};

normalizeData();

function entryFields(type) {
  const { label, fields } = config[type];
  return (data[type] || []).map((entry, index) => `
    <div class="repeat-item">
      <div class="repeat-top">
        <span class="repeat-label">${label} ${index + 1}</span>
        <button class="remove-button" type="button" data-remove="${type}" data-index="${index}">Remove</button>
      </div>
      <div class="repeat-grid">
        ${fields.map(([key, text]) => `
          <label class="field ${key === 'achievements' || (type === 'experience' && key === 'title') ? 'field-wide' : ''}">
            ${text}
            ${key === 'achievements'
              ? `<textarea data-path="${type}.${index}.${key}" rows="4" placeholder="One achievement per line, starting with an action verb">${escapeHtml(entry[key])}</textarea>`
              : `<input data-path="${type}.${index}.${key}" value="${escapeHtml(entry[key])}" placeholder="${text}">`}
          </label>
        `).join('')}
      </div>
    </div>
  `).join('');
}

function renderFields() {
  document.querySelector('#experienceFields').innerHTML = entryFields('experience');
  document.querySelector('#educationFields').innerHTML = entryFields('education');
  document.querySelector('#referencesFields').innerHTML = `
    <div class="optional-fields">
      <div class="section-heading">
        <strong>${config.references.label}s</strong>
        <button class="add-button" type="button" data-add="references">+ Add</button>
      </div>
      ${entryFields('references')}
    </div>
  `;
  document.querySelector('#optionalFields').innerHTML = Object.keys(config)
    .filter(type => !['experience', 'education', 'references'].includes(type) && data.toggles[type])
    .map(type => `
      <div class="optional-fields">
        <div class="section-heading">
          <strong>${config[type].label}s</strong>
          <button class="add-button" type="button" data-add="${type}">+ Add</button>
        </div>
        ${entryFields(type)}
      </div>
    `).join('');

  document.querySelectorAll('[data-toggle]').forEach(input => {
    input.checked = Boolean(data.toggles[input.dataset.toggle]);
  });
}

function hydrateInputs() {
  document.querySelectorAll('[data-path]').forEach(input => {
    const value = get(input.dataset.path);
    if (value !== undefined && input.value !== value) input.value = value;
  });
}

function section(title, content) {
  return content ? `<section class="cv-section"><h4>${title}</h4>${content}</section>` : '';
}

function renderPreview() {
  const b = data.basics;
  const contacts = [b.phone, b.email, b.dob, b.location, b.website].filter(Boolean).map(escapeHtml);

  const optionalMeta = (type, entry) => {
    if (type === 'positions') {
      return [entry.organization, entry.dates].filter(Boolean).join(' · ');
    }

    if (type === 'references') {
      return [entry.role, entry.organization, entry.contact].filter(Boolean).join(' · ');
    }

    return entry.detail || '';
  };

  const summaryText = (data.summary || '').trim();
  const allSkills = (data.skills || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const personalAttributes = allSkills.slice(0, Math.min(5, allSkills.length));
  const technicalSkills = allSkills.slice(Math.min(5, allSkills.length));

  const experience = data.experience.filter(e => e.title || e.company).map(e => `
    <article class="cv-entry">
      <div class="entry-head">
        <strong>${escapeHtml(e.title)}</strong>
        <span class="entry-date">${escapeHtml(e.dates)}</span>
      </div>
      <div class="entry-sub">${escapeHtml([e.company, e.location].filter(Boolean).join(' · '))}</div>
      <ul class="entry-description">${escapeHtml(e.achievements || '').split('\n').filter(Boolean).map(item => `<li>${item}</li>`).join('')}</ul>
    </article>
  `).join('');

  const education = data.education.filter(e => e.degree || e.school).map(e => `
    <article class="cv-entry">
      <div class="entry-head">
        <strong>${escapeHtml(e.degree || e.school)}</strong>
        <span class="entry-date">${escapeHtml(e.dates)}</span>
      </div>
      <div class="entry-sub">${escapeHtml([e.school, e.location].filter(Boolean).join(' · '))}</div>
    </article>
  `).join('');

  const optional = Object.keys(config)
    .filter(type => !['experience', 'education', 'references'].includes(type) && data.toggles[type])
    .map(type => section(config[type].label + 's', (data[type] || []).filter(e => e.name || e.detail || e.organization || e.dates || e.role || e.contact).map(e => `
      <article class="cv-entry">
        <div class="entry-head"><strong>${escapeHtml(e.name)}</strong></div>
        <div class="entry-sub">${escapeHtml(optionalMeta(type, e))}</div>
      </article>
    `).join('')))
    .join('');

  const references = (data.references || []).filter(e => e.name || e.detail || e.role || e.organization || e.contact).map(e => `
    <article class="cv-entry">
      <div class="entry-head"><strong>${escapeHtml(e.name || 'Reference')}</strong></div>
      <div class="entry-sub">${escapeHtml(optionalMeta('references', e) || e.detail || '')}</div>
    </article>
  `).join('') || '';

  document.querySelector('#cvPreview').innerHTML = `
    <header class="cv-head">
      <h2 class="cv-title">CURRICULUM VITAE</h2>
      <h3 class="cv-name">${escapeHtml(b.name) || 'YOUR NAME'}</h3>
      <div class="contact-line">${contacts.length ? contacts.map(c => `<span>${c}</span>`).join('') : 'Add your contact details in the editor'}</div>
    </header>

    ${summaryText ? section('PROFESSIONAL SUMMARY', `<p class="cv-summary"><strong>Career Objective</strong><br>${escapeHtml(summaryText)}</p>`) : ''}

    ${personalAttributes.length ? section('KEY PERSONAL ATTRIBUTES', `
      <ul class="entry-description">${personalAttributes.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
    `) : ''}

    ${education ? section('EDUCATION', education) : ''}
    ${experience ? section('WORK EXPERIENCE', experience) : ''}
    ${technicalSkills.length ? section('TECHNICAL SKILLS', `
      <ul class="entry-description">${technicalSkills.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
    `) : ''}
    ${optional}
    ${references ? section('REFERENCES', references) : ''}
  `;
}

function updateProgress() {
  const checks = [
    data.basics.name,
    data.basics.headline,
    data.basics.email,
    data.basics.location,
    data.summary,
    data.experience[0]?.title,
    data.education[0]?.degree,
    data.skills
  ];
  const percent = Math.round(checks.filter(Boolean).length / checks.length * 100);
  const progressText = document.querySelector('#progressText');
  const progressBar = document.querySelector('#progressBar');
  if (progressText) progressText.textContent = `${percent}%`;
  if (progressBar) progressBar.style.width = `${percent}%`;
}

function updateIdentifierField(select, input) {
  if (!select || !input) return;
  const isPhone = select.value === 'phone';
  input.placeholder = isPhone ? '+1 555 000 0000' : 'you@example.com';
  input.autocomplete = isPhone ? 'tel' : 'email';
  input.type = isPhone ? 'tel' : 'email';
}

async function handleSignup(event) {
  event.preventDefault();
  const formData = new FormData(event.target);
  const payload = {
    name: String(formData.get('name') || '').trim(),
    identifierType: String(formData.get('identifierType') || 'email'),
    identifier: String(formData.get('identifier') || '').trim(),
    password: String(formData.get('password') || ''),
    confirmPassword: String(formData.get('confirmPassword') || '')
  };

  if (!payload.name || !payload.identifier || payload.password.length < 6) {
    alert('Please enter your name, a valid email or phone number, and a password with at least 6 characters.');
    return;
  }

  if (payload.password !== payload.confirmPassword) {
    alert('Passwords do not match.');
    return;
  }

  try {
    const response = await fetch(`${apiUrl}?action=register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await parseJsonResponse(response);
    if (!response.ok || !result.success) {
      throw new Error(result.error || 'Unable to create account.');
    }

    currentUser = result.user;
    localStorage.setItem(userKey, JSON.stringify(currentUser));
    localStorage.setItem(userIdKey, currentUser.id);
    cvId = currentUser.id;
    localStorage.setItem(cvIdKey, currentUser.id);

    if (!document.querySelector('#cvPreview')) {
      window.location.replace('index.html');
      return;
    }

    updateAccountStatus();
    await loadFromDatabase();
    const savedState = document.querySelector('#savedState');
    if (savedState) savedState.textContent = 'Account ready';
  } catch (error) {
    alert(error.message || 'Unable to create account.');
  }
}

async function handleLogin(event) {
  event.preventDefault();

  const formData = new FormData(event.target);
  const payload = {
    identifier: String(formData.get('loginIdentifier') || '').trim(),
    password: String(formData.get('loginPassword') || '')
  };

  if (!payload.identifier || !payload.password) {
    alert('Please enter your email or phone number and password.');
    return;
  }

  try {
    const response = await fetch('login.php', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await parseJsonResponse(response);
    if (!response.ok || !result.success) {
      throw new Error(result.error || 'Login failed');
    }

    currentUser = result.user;
    localStorage.setItem(userKey, JSON.stringify(currentUser));
    localStorage.setItem(userIdKey, currentUser.id);
    cvId = currentUser.id;
    localStorage.setItem(cvIdKey, currentUser.id);

    if (!document.querySelector('#cvPreview')) {
      window.location.replace('index.html');
      return;
    }

    updateAccountStatus();
    await loadFromDatabase();
    event.target.reset();

    const savedState = document.querySelector('#savedState');
    if (savedState) savedState.textContent = 'Signed in';
  } catch (error) {
    alert(error.message || 'Unable to sign in.');
  }
}

async function handleResetRequest(event) {
  event.preventDefault();
  const formData = new FormData(event.target);
  const payload = {
    identifierType: String(formData.get('resetIdentifierType') || 'email'),
    identifier: String(formData.get('resetIdentifier') || '').trim()
  };

  try {
    const response = await fetch(`${apiUrl}?action=send-reset-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await parseJsonResponse(response);
    if (!response.ok || !result.success) throw new Error(result.error || 'Unable to request a reset code.');

    pendingResetData = payload;
    document.querySelector('#resetPasswordForm').hidden = false;
    document.querySelector('#resetRequestForm').hidden = true;
    document.querySelector('#resetSection p').textContent = `If an account matches ${payload.identifier}, a reset code has been sent.`;
    document.querySelector('[name="resetOtp"]')?.focus();
  } catch (error) {
    alert(error.message || 'Unable to request a reset code.');
  }
}

async function handlePasswordReset(event) {
  event.preventDefault();
  const formData = new FormData(event.target);
  const payload = {
    ...pendingResetData,
    otp: String(formData.get('resetOtp') || '').trim(),
    password: String(formData.get('resetPassword') || ''),
    confirmPassword: String(formData.get('confirmResetPassword') || '')
  };

  if (!pendingResetData) {
    alert('Please request a reset code first.');
    return;
  }

  if (payload.password !== payload.confirmPassword) {
    alert('Passwords do not match.');
    return;
  }

  try {
    const response = await fetch(`${apiUrl}?action=reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await parseJsonResponse(response);
    if (!response.ok || !result.success) throw new Error(result.error || 'Unable to reset your password.');

    currentUser = result.user;
    localStorage.setItem(userKey, JSON.stringify(currentUser));
    localStorage.setItem(userIdKey, currentUser.id);
    localStorage.setItem(cvIdKey, currentUser.id);
    pendingResetData = null;
    window.location.replace('index.html');
  } catch (error) {
    alert(error.message || 'Unable to reset your password.');
  }
}

async function handleLogout() {
  try {
    await fetch('logout.php', {
      method: 'POST',
      credentials: 'same-origin'
    });
  } catch (error) {
    // Clear the local session even when the network is unavailable.
  }

  currentUser = null;
  localStorage.removeItem(userKey);
  localStorage.removeItem(userIdKey);
  localStorage.removeItem('northstar-cv');

  if (document.querySelector('#cvPreview')) {
    window.location.replace('login.html');
    return;
  }

  const savedState = document.querySelector('#savedState');
  if (savedState) savedState.textContent = 'Logged out';

  data = clone(blankStarter);
  if (!document.querySelector('#cvPreview')) return;
  renderFields();
  hydrateInputs();
  renderPreview();
  updateAccountStatus();
}

function bind() {
  document.addEventListener('input', event => {
    if (event.target.dataset.path) {
      set(event.target.dataset.path, event.target.value);
      save();
      renderPreview();
      updateProgress();
    }
  });

  document.addEventListener('change', event => {
    if (event.target.dataset.toggle) {
      data.toggles[event.target.dataset.toggle] = event.target.checked;
      save();
      renderFields();
      hydrateInputs();
      renderPreview();
      updateProgress();
    }
  });

  document.addEventListener('click', event => {
    const add = event.target.dataset.add;
    if (add) {
      const blank = Object.fromEntries(config[add].fields.map(([key]) => [key, '']));
      data[add].push(blank);
      save();
      renderFields();
      hydrateInputs();
      renderPreview();
      updateProgress();
    }

    const remove = event.target.dataset.remove;
    if (remove) {
      data[remove].splice(Number(event.target.dataset.index), 1);
      if (!data[remove].length && ['experience', 'education'].includes(remove)) {
        data[remove].push(Object.fromEntries(config[remove].fields.map(([key]) => [key, ''])));
      }
      save();
      renderFields();
      hydrateInputs();
      renderPreview();
      updateProgress();
    }
  });

  document.querySelector('#printButton')?.addEventListener('click', () => window.print());

  document.querySelector('#resetButton')?.addEventListener('click', () => {
    if (confirm('Clear everything and reset the CV?')) {
      data = clone(blankStarter);
      localStorage.removeItem('northstar-cv');

      if (currentUser?.id) {
        fetch(`${apiUrl}?id=${encodeURIComponent(currentUser.id)}`, { method: 'DELETE' }).catch(() => {});
      }

      const savedState = document.querySelector('#savedState');
      if (savedState) savedState.textContent = 'Cleared';

      renderFields();
      hydrateInputs();
      renderPreview();
      updateProgress();
    }
  });

  document.querySelector('#signupForm')?.addEventListener('submit', handleSignup);
  document.querySelector('#loginForm')?.addEventListener('submit', handleLogin);
  document.querySelector('#logoutButton')?.addEventListener('click', handleLogout);
}

if (document.querySelector('#cvPreview')) {
  renderFields();
  hydrateInputs();
  renderPreview();
  updateAccountStatus();
  updateProgress();
  bind();
  loadFromDatabase();
} else {
  document.querySelector('#loginForm')?.addEventListener('submit', handleLogin);
  document.querySelector('#signupForm')?.addEventListener('submit', handleSignup);

  document.querySelectorAll('[data-auth-mode]').forEach(button => {
    button.addEventListener('click', () => {
      const mode = button.dataset.authMode;
      const loginForm = document.querySelector('#loginForm');
      const signupForm = document.querySelector('#signupForm');
      const accountTitle = document.querySelector('#accountTitle');
      const accountStatus = document.querySelector('#accountStatus');

      document.querySelectorAll('[data-auth-mode]').forEach(item => {
        const active = item === button;
        item.classList.toggle('is-active', active);
        item.setAttribute('aria-selected', String(active));
      });

      loginForm.hidden = mode !== 'login';
      signupForm.hidden = mode !== 'signup';
      accountTitle.textContent = mode === 'login' ? 'Welcome back' : 'Create your account';
      accountStatus.textContent = mode === 'login'
        ? 'Login to enter your CV workspace.'
        : 'Verify your email or phone to keep your CV secure.';
    });
  });

  document.querySelector('#forgotPasswordButton')?.addEventListener('click', () => {
    document.querySelector('#loginForm').hidden = true;
    document.querySelector('#resetSection').hidden = false;
    document.querySelector('.auth-mode-switch')?.setAttribute('hidden', 'hidden');
    document.querySelector('#accountTitle').textContent = 'Reset password';
    document.querySelector('#accountStatus').textContent = 'Recover access using your verified email or phone.';
  });
  document.querySelector('#cancelResetButton')?.addEventListener('click', () => {
    document.querySelector('#resetSection').hidden = true;
    document.querySelector('#resetRequestForm').hidden = false;
    document.querySelector('#resetPasswordForm').hidden = true;
    document.querySelector('#loginForm').hidden = false;
    document.querySelector('.auth-mode-switch')?.removeAttribute('hidden');
    document.querySelector('#accountTitle').textContent = 'Welcome back';
    document.querySelector('#accountStatus').textContent = 'Login to enter your CV workspace.';
  });
  document.querySelector('#resetRequestForm')?.addEventListener('submit', handleResetRequest);
  document.querySelector('#resetPasswordForm')?.addEventListener('submit', handlePasswordReset);

  const registerType = document.querySelector('[name="identifierType"]');
  const registerIdentifier = document.querySelector('#registerIdentifier');
  registerType?.addEventListener('change', () => updateIdentifierField(registerType, registerIdentifier));
  updateIdentifierField(registerType, registerIdentifier);

  const resetType = document.querySelector('[name="resetIdentifierType"]');
  const resetIdentifier = document.querySelector('#resetIdentifier');
  resetType?.addEventListener('change', () => updateIdentifierField(resetType, resetIdentifier));
  updateIdentifierField(resetType, resetIdentifier);
}
