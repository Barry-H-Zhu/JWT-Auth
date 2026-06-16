const authBaseUrl = 'http://localhost:4000';
const resourceBaseUrl = 'http://localhost:3000';
const storageKeys = {
  accessToken: 'jwt-demo-access-token',
  refreshToken: 'jwt-demo-refresh-token',
};

const loginForm = document.querySelector('#loginForm');
const usernameInput = document.querySelector('#username');
const passwordInput = document.querySelector('#password');
const accessTokenInput = document.querySelector('#accessToken');
const refreshTokenInput = document.querySelector('#refreshToken');
const postTitleInput = document.querySelector('#postTitle');
const postIdInput = document.querySelector('#postId');
const output = document.querySelector('#output');
const lastRequest = document.querySelector('#lastRequest');
const loginState = document.querySelector('#loginState');
const registerBtn = document.querySelector('#registerBtn');
const postsBtn = document.querySelector('#postsBtn');
const createPostBtn = document.querySelector('#createPostBtn');
const deletePostBtn = document.querySelector('#deletePostBtn');
const refreshBtn = document.querySelector('#refreshBtn');
const logoutBtn = document.querySelector('#logoutBtn');
const clearBtn = document.querySelector('#clearBtn');

function getTokens() {
  return {
    accessToken: localStorage.getItem(storageKeys.accessToken) || '',
    refreshToken: localStorage.getItem(storageKeys.refreshToken) || '',
  };
}

function setTokens({ accessToken, refreshToken }) {
  if (accessToken !== undefined) {
    localStorage.setItem(storageKeys.accessToken, accessToken);
  }

  if (refreshToken !== undefined) {
    localStorage.setItem(storageKeys.refreshToken, refreshToken);
  }

  renderTokens();
}

function clearTokens() {
  localStorage.removeItem(storageKeys.accessToken);
  localStorage.removeItem(storageKeys.refreshToken);
  renderTokens();
}

function renderTokens() {
  const tokens = getTokens();
  accessTokenInput.value = tokens.accessToken;
  refreshTokenInput.value = tokens.refreshToken;

  const signedIn = Boolean(tokens.accessToken && tokens.refreshToken);
  loginState.textContent = signedIn ? 'Token saved' : 'Signed out';
  loginState.classList.toggle('signed-in', signedIn);
}

function showResult(label, data, status) {
  lastRequest.textContent = status ? `${label} / ${status}` : label;
  output.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
}

async function requestJson(label, url, options = {}) {
  try {
    const response = await fetch(url, options);
    const text = await response.text();
    const data = text ? JSON.parse(text) : `${response.status} ${response.statusText}`;

    showResult(label, data, `${response.status} ${response.statusText}`);

    if (!response.ok) {
      throw new Error(typeof data === 'string' ? data : data.message || response.statusText);
    }

    return data;
  } catch (error) {
    showResult(label, { error: error.message }, 'Request failed');
    throw error;
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const data = await requestJson('POST /login', `${authBaseUrl}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: usernameInput.value.trim(),
      password: passwordInput.value,
    }),
  });

  setTokens({
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
  });
});

registerBtn.addEventListener('click', async () => {
  await requestJson('POST /register', `${authBaseUrl}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: usernameInput.value.trim(),
      password: passwordInput.value,
    }),
  });
});

postsBtn.addEventListener('click', async () => {
  const { accessToken } = getTokens();

  await requestJson('GET /posts', `${resourceBaseUrl}/posts`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
});

createPostBtn.addEventListener('click', async () => {
  const { accessToken } = getTokens();

  const data = await requestJson('POST /posts', `${resourceBaseUrl}/posts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: postTitleInput.value.trim(),
    }),
  });

  if (data.id !== undefined) {
    postIdInput.value = data.id;
  }
});

deletePostBtn.addEventListener('click', async () => {
  const { accessToken } = getTokens();
  const postId = postIdInput.value.trim();

  await requestJson('DELETE /posts/:id', `${resourceBaseUrl}/posts/${postId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
});

refreshBtn.addEventListener('click', async () => {
  const { refreshToken } = getTokens();

  const data = await requestJson('POST /token', `${authBaseUrl}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: refreshToken }),
  });

  setTokens({ accessToken: data.accessToken });
});

logoutBtn.addEventListener('click', async () => {
  const { refreshToken } = getTokens();

  await requestJson('DELETE /logout', `${authBaseUrl}/logout`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: refreshToken }),
  });

  clearTokens();
});

clearBtn.addEventListener('click', () => {
  clearTokens();
  showResult('Clear tokens', 'Local tokens cleared.');
});

renderTokens();
