const resourceBaseUrl = window.location.origin;
const authBaseUrl = `${window.location.protocol}//${window.location.hostname}:4000`;
const storageKeys = {
  accessToken: 'jwt-demo-access-token',
};

const authView = document.querySelector('#authView');
const appView = document.querySelector('#appView');
const authForm = document.querySelector('#authForm');
const verificationForm = document.querySelector('#verificationForm');
const passwordResetForm = document.querySelector('#passwordResetForm');
const postForm = document.querySelector('#postForm');
const identifierInput = document.querySelector('#identifier');
const usernameInput = document.querySelector('#username');
const emailInput = document.querySelector('#email');
const passwordInput = document.querySelector('#password');
const verificationCodeInput = document.querySelector('#verificationCode');
const resetIdentifierInput = document.querySelector('#resetIdentifier');
const resetCodeInput = document.querySelector('#resetCode');
const newPasswordInput = document.querySelector('#newPassword');
const identifierField = document.querySelector('#identifierField');
const usernameField = document.querySelector('#usernameField');
const emailField = document.querySelector('#emailField');
const resetIdentifierField = document.querySelector('#resetIdentifierField');
const resetCodeField = document.querySelector('#resetCodeField');
const newPasswordField = document.querySelector('#newPasswordField');
const postTitleInput = document.querySelector('#postTitle');
const accessTokenInput = document.querySelector('#accessToken');
const refreshTokenInput = document.querySelector('#refreshToken');
const authState = document.querySelector('#authState');
const authMessage = document.querySelector('#authMessage');
const notice = document.querySelector('#notice');
const currentUser = document.querySelector('#currentUser');
const userMeta = document.querySelector('#userMeta');
const userAvatar = document.querySelector('#userAvatar');
const composerAvatar = document.querySelector('#composerAvatar');
const postsList = document.querySelector('#postsList');
const signInModeBtn = document.querySelector('#signInModeBtn');
const registerModeBtn = document.querySelector('#registerModeBtn');
const authSubmitBtn = document.querySelector('#authSubmitBtn');
const challengeIdValue = document.querySelector('#challengeIdValue');
const resetIdValue = document.querySelector('#resetIdValue');
const cancelVerificationBtn = document.querySelector('#cancelVerificationBtn');
const verifyLoginBtn = document.querySelector('#verifyLoginBtn');
const forgotPasswordBtn = document.querySelector('#forgotPasswordBtn');
const cancelPasswordResetBtn = document.querySelector('#cancelPasswordResetBtn');
const passwordResetSubmitBtn = document.querySelector('#passwordResetSubmitBtn');
const passwordResetTitle = document.querySelector('#passwordResetTitle');
const passwordResetCopy = document.querySelector('#passwordResetCopy');
const resetDebug = document.querySelector('#resetDebug');
const postsBtn = document.querySelector('#postsBtn');
const createPostBtn = document.querySelector('#createPostBtn');
const refreshBtn = document.querySelector('#refreshBtn');
const logoutBtn = document.querySelector('#logoutBtn');
const clearBtn = document.querySelector('#clearBtn');

let currentPosts = [];
let authMode = 'sign-in';
let pendingChallengeId = '';
let passwordResetStep = 'request';
let pendingResetId = '';

function getTokens() {
  return {
    accessToken: sessionStorage.getItem(storageKeys.accessToken) || '',
  };
}

function setTokens({ accessToken }) {
  if (accessToken !== undefined) {
    sessionStorage.setItem(storageKeys.accessToken, accessToken);
  }

  renderSession();
}

function clearTokens() {
  sessionStorage.removeItem(storageKeys.accessToken);
  currentPosts = [];
  renderSession();
}

function decodeToken(token) {
  if (!token) return null;

  try {
    const payload = token.split('.')[1];
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), '=');
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function getCurrentUser() {
  const { accessToken } = getTokens();
  return decodeToken(accessToken);
}

function initials(name = 'User') {
  return name.trim().slice(0, 1).toUpperCase() || 'U';
}

function showAuthMessage(message, isError = false) {
  authMessage.textContent = message;
  authMessage.classList.toggle('error', isError);
}

function showNotice(message, isError = false) {
  notice.textContent = message;
  notice.classList.toggle('error', isError);
}

function setAuthMode(mode) {
  authMode = mode;
  const signingIn = mode === 'sign-in';

  pendingChallengeId = '';
  pendingResetId = '';
  challengeIdValue.textContent = '';
  resetIdValue.textContent = '';
  verificationCodeInput.value = '';
  resetCodeInput.value = '';
  newPasswordInput.value = '';
  passwordResetStep = 'request';
  verificationForm.hidden = true;
  passwordResetForm.hidden = true;
  authForm.hidden = false;
  document.querySelector('.auth-mode').hidden = false;
  identifierField.hidden = !signingIn;
  usernameField.hidden = signingIn;
  emailField.hidden = signingIn;
  identifierInput.required = signingIn;
  usernameInput.required = !signingIn;
  emailInput.required = !signingIn;
  passwordInput.autocomplete = signingIn ? 'current-password' : 'new-password';
  forgotPasswordBtn.hidden = !signingIn;
  signInModeBtn.classList.toggle('active', signingIn);
  registerModeBtn.classList.toggle('active', !signingIn);
  signInModeBtn.setAttribute('aria-selected', String(signingIn));
  registerModeBtn.setAttribute('aria-selected', String(!signingIn));
  authSubmitBtn.textContent = signingIn ? 'Sign in' : 'Create account';
  authMessage.textContent = signingIn
    ? 'Sign in with either your username or email address.'
    : 'Choose a username and provide a unique email address.';
  authMessage.classList.remove('error');
}

function showVerificationStep(challengeId, message) {
  pendingChallengeId = challengeId;
  challengeIdValue.textContent = challengeId;
  authForm.hidden = true;
  verificationForm.hidden = false;
  document.querySelector('.auth-mode').hidden = true;
  showAuthMessage(`${message}. Enter the 6-digit code to finish signing in.`);
  verificationCodeInput.focus();
}

function showPasswordResetStep(step, message = '') {
  passwordResetStep = step;
  const requesting = step === 'request';

  authForm.hidden = true;
  verificationForm.hidden = true;
  passwordResetForm.hidden = false;
  document.querySelector('.auth-mode').hidden = true;

  resetIdentifierField.hidden = !requesting;
  resetCodeField.hidden = requesting;
  newPasswordField.hidden = requesting;
  resetIdentifierInput.required = requesting;
  resetCodeInput.required = !requesting;
  newPasswordInput.required = !requesting;
  resetDebug.hidden = requesting || !pendingResetId;

  passwordResetTitle.textContent = requesting ? 'Request a reset code' : 'Enter your reset code';
  passwordResetCopy.textContent = requesting
    ? 'Enter your username or email address. The reset code is sent to the account email.'
    : 'Use the 6-digit code from your email or auth server console, then choose a new password.';
  passwordResetSubmitBtn.textContent = requesting ? 'Send code' : 'Reset password';

  showAuthMessage(message || 'Request a password reset code.');
  (requesting ? resetIdentifierInput : resetCodeInput).focus();
}

function formatDate(value) {
  if (!value) return 'Just now';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  const data = text ? JSON.parse(text) : `${response.status} ${response.statusText}`;

  if (!response.ok) {
    throw new Error(typeof data === 'string' ? data : data.message || response.statusText);
  }

  return data;
}

function authedHeaders(extra = {}) {
  const { accessToken } = getTokens();
  return {
    Authorization: `Bearer ${accessToken}`,
    ...extra,
  };
}

function renderSession() {
  const tokens = getTokens();
  const user = getCurrentUser();
  const signedIn = Boolean(tokens.accessToken && user);

  authView.hidden = signedIn;
  appView.hidden = !signedIn;
  accessTokenInput.value = tokens.accessToken;
  refreshTokenInput.value = signedIn ? 'Stored in HttpOnly cookie' : '';
  authState.textContent = signedIn ? 'Signed in' : 'Signed out';
  authState.classList.toggle('signed-in', signedIn);

  if (!signedIn) {
    postsList.innerHTML = '';
    return;
  }

  const name = user.name || 'User';
  currentUser.textContent = name;
  userMeta.textContent = `User ID ${user.id}`;
  userAvatar.textContent = initials(name);
  composerAvatar.textContent = initials(name);
}

async function restoreSession() {
  try {
    const data = await requestJson(`${authBaseUrl}/token`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-CSRF-Protection': '1' },
    });

    setTokens({ accessToken: data.accessToken });
    await loadPosts();
  } catch {
    clearTokens();
    showAuthMessage('Sign in to continue.');
  }
}

function renderPosts(posts) {
  const user = getCurrentUser();
  const name = user?.name || 'User';
  currentPosts = posts;

  if (!posts.length) {
    postsList.innerHTML = '<div class="empty-state">No posts yet. Write your first post above.</div>';
    return;
  }

  postsList.innerHTML = posts.map((post) => `
    <article class="post-card" data-post-id="${post.id}">
      <div class="post-meta">
        <div class="avatar">${initials(name)}</div>
        <div>
          <div class="post-author">${escapeHtml(name)}</div>
          <div class="post-time">${formatDate(post.created_at)}</div>
        </div>
      </div>
      <p class="post-content">${escapeHtml(post.title)}</p>
      <div class="post-footer">
        <span class="post-id">Post #${post.id}</span>
        <button class="icon-button delete-post-button" type="button" data-post-id="${post.id}" title="Delete post">Delete</button>
      </div>
    </article>
  `).join('');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function loadPosts(message = '') {
  try {
    showNotice(message || 'Loading posts...');
    const posts = await requestJson(`${resourceBaseUrl}/posts`, {
      headers: authedHeaders(),
    });
    renderPosts(posts);
    showNotice(posts.length ? `${posts.length} post${posts.length === 1 ? '' : 's'} loaded.` : 'Your feed is empty.');
  } catch (error) {
    showNotice(error.message, true);
  }
}

authForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (authMode === 'sign-in') {
    showAuthMessage('Signing in...');

    try {
      const data = await requestJson(`${authBaseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: identifierInput.value.trim(),
          password: passwordInput.value,
        }),
      });

      showVerificationStep(data.challengeId, data.message || 'Verification code sent');
    } catch (error) {
      showAuthMessage(error.message, true);
    }

    return;
  }

  showAuthMessage('Creating account...');

  try {
    const data = await requestJson(`${authBaseUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: usernameInput.value.trim(),
        email: emailInput.value.trim(),
        password: passwordInput.value,
      }),
    });

    identifierInput.value = data.user.email;
    setAuthMode('sign-in');
    showAuthMessage(`${data.user.username} created. Sign in with ${data.user.email}.`);
  } catch (error) {
    showAuthMessage(error.message, true);
  }
});

verificationForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!pendingChallengeId) {
    showAuthMessage('Start the sign-in process again.', true);
    setAuthMode('sign-in');
    return;
  }

  verifyLoginBtn.disabled = true;
  showAuthMessage('Verifying code...');

  try {
    const data = await requestJson(`${authBaseUrl}/login/verify`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeId: pendingChallengeId,
        verificationCode: verificationCodeInput.value.trim(),
      }),
    });

    pendingChallengeId = '';
    setTokens(data);
    showNotice('Verification complete. Loading your posts...');
    await loadPosts();
  } catch (error) {
    showAuthMessage(error.message, true);
  } finally {
    verifyLoginBtn.disabled = false;
  }
});

cancelVerificationBtn.addEventListener('click', () => {
  setAuthMode('sign-in');
});

forgotPasswordBtn.addEventListener('click', () => {
  resetIdentifierInput.value = identifierInput.value.trim();
  showPasswordResetStep('request');
});

passwordResetForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  passwordResetSubmitBtn.disabled = true;

  if (passwordResetStep === 'request') {
    showAuthMessage('Sending reset code...');

    try {
      const data = await requestJson(`${authBaseUrl}/password-reset/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: resetIdentifierInput.value.trim(),
        }),
      });

      pendingResetId = data.resetId || '';
      resetIdValue.textContent = pendingResetId || 'No reset id returned for this account.';
      showPasswordResetStep('confirm', `${data.message}. Enter the reset code to continue.`);
    } catch (error) {
      showAuthMessage(error.message, true);
    } finally {
      passwordResetSubmitBtn.disabled = false;
    }

    return;
  }

  if (!pendingResetId) {
    showAuthMessage('Start the password reset process again.', true);
    passwordResetSubmitBtn.disabled = false;
    showPasswordResetStep('request');
    return;
  }

  showAuthMessage('Resetting password...');

  try {
    const data = await requestJson(`${authBaseUrl}/password-reset/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resetId: pendingResetId,
        resetCode: resetCodeInput.value.trim(),
        newPassword: newPasswordInput.value,
      }),
    });

    identifierInput.value = resetIdentifierInput.value.trim();
    passwordInput.value = '';
    setAuthMode('sign-in');
    showAuthMessage(`${data.message}. Sign in with your new password.`);
    passwordInput.focus();
  } catch (error) {
    showAuthMessage(error.message, true);
  } finally {
    passwordResetSubmitBtn.disabled = false;
  }
});

cancelPasswordResetBtn.addEventListener('click', () => {
  setAuthMode('sign-in');
});

signInModeBtn.addEventListener('click', () => {
  setAuthMode('sign-in');
});

registerModeBtn.addEventListener('click', () => {
  setAuthMode('register');
});

postForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const title = postTitleInput.value.trim();

  if (!title) {
    showNotice('Post content is required.', true);
    return;
  }

  createPostBtn.disabled = true;
  showNotice('Publishing post...');

  try {
    await requestJson(`${resourceBaseUrl}/posts`, {
      method: 'POST',
      headers: authedHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ title }),
    });

    postTitleInput.value = '';
    await loadPosts('Post published.');
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    createPostBtn.disabled = false;
  }
});

postsBtn.addEventListener('click', () => {
  loadPosts('Refreshing feed...');
});

postsList.addEventListener('click', async (event) => {
  const button = event.target.closest('.delete-post-button');
  if (!button) return;

  const postId = button.dataset.postId;
  button.disabled = true;
  showNotice(`Deleting post #${postId}...`);

  try {
    await requestJson(`${resourceBaseUrl}/posts/${postId}`, {
      method: 'DELETE',
      headers: authedHeaders(),
    });

    renderPosts(currentPosts.filter((post) => String(post.id) !== String(postId)));
    showNotice(`Post #${postId} deleted.`);
  } catch (error) {
    button.disabled = false;
    showNotice(error.message, true);
  }
});

refreshBtn.addEventListener('click', async () => {
  showNotice('Refreshing access token...');

  try {
    const data = await requestJson(`${authBaseUrl}/token`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-CSRF-Protection': '1' },
    });

    setTokens({ accessToken: data.accessToken });
    showNotice('Access token refreshed.');
  } catch (error) {
    showNotice(error.message, true);
  }
});

logoutBtn.addEventListener('click', async () => {
  try {
    await requestJson(`${authBaseUrl}/logout`, {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'X-CSRF-Protection': '1' },
    });
  } catch {
    // Local cleanup should still happen if the refresh token is already invalid.
  }

  clearTokens();
  showAuthMessage('Signed out.');
});

clearBtn.addEventListener('click', () => {
  clearTokens();
  showAuthMessage('Access token cleared. Your refresh cookie is still active.');
});

setAuthMode('sign-in');
restoreSession();
