const socket = io({ autoConnect: false });
const authPanel = document.querySelector('#auth-panel');
const joinPanel = document.querySelector('#join-panel');
const chatPanel = document.querySelector('#chat-panel');
const loginForm = document.querySelector('#login-form');
const registerForm = document.querySelector('#register-form');
const joinForm = document.querySelector('#join-form');
const messageForm = document.querySelector('#message-form');
const authError = document.querySelector('#auth-error');
const joinError = document.querySelector('#join-error');
const messages = document.querySelector('#messages');
const connectionStatus = document.querySelector('#connection-status');
const messageInput = document.querySelector('#message-input');
const logoutButton = document.querySelector('#logout-button');
let currentName = '';

socket.on('connect', () => {
  connectionStatus.textContent = 'متصل';
  connectionStatus.classList.add('online');
});
socket.on('disconnect', () => {
  connectionStatus.textContent = 'غير متصل';
  connectionStatus.classList.remove('online');
});
socket.on('connect_error', () => {
  connectionStatus.textContent = 'سجل الدخول للمتابعة';
  connectionStatus.classList.remove('online');
});
socket.on('chat:error', (message) => {
  joinError.textContent = message;
});
socket.on('chat:joined', ({ name, room }) => {
  currentName = name;
  joinError.textContent = '';
  document.querySelector('#room-name').textContent = room;
  messages.replaceChildren();
  joinPanel.classList.add('hidden');
  chatPanel.classList.remove('hidden');
  messageInput.focus();
});
socket.on('chat:notice', (text) => addNotice(text));
socket.on('chat:message', (message) => addMessage(message));

document.querySelector('#login-tab').addEventListener('click', () => showAuthForm('login'));
document.querySelector('#register-tab').addEventListener('click', () => showAuthForm('register'));

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await authenticate('/api/login', new FormData(loginForm));
});
registerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await authenticate('/api/register', new FormData(registerForm));
});

async function authenticate(endpoint, formData) {
  authError.textContent = '';
  const submitButton = (endpoint === '/api/login' ? loginForm : registerForm).querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(formData))
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'تعذر تسجيل الدخول.');
    enterApp(data.user);
  } catch (error) {
    authError.textContent = error.message || 'تعذر الاتصال بالخادم.';
  } finally {
    submitButton.disabled = false;
  }
}

function enterApp(user) {
  currentName = user.username;
  document.querySelector('#welcome-name').textContent = user.username;
  authPanel.classList.add('hidden');
  chatPanel.classList.add('hidden');
  joinPanel.classList.remove('hidden');
  logoutButton.classList.remove('hidden');
  socket.connect();
}

async function restoreSession() {
  try {
    const response = await fetch('/api/me');
    if (response.ok) enterApp((await response.json()).user);
  } catch (_error) {
    authError.textContent = 'تعذر الاتصال بالخادم. أعد تحميل الصفحة للمحاولة مجدداً.';
  }
}

joinForm.addEventListener('submit', (event) => {
  event.preventDefault();
  joinError.textContent = '';
  socket.emit('chat:join', { room: new FormData(joinForm).get('room') });
});

messageForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;
  socket.emit('chat:message', { text });
  messageInput.value = '';
  messageInput.focus();
});

document.querySelector('#change-room').addEventListener('click', () => {
  chatPanel.classList.add('hidden');
  joinPanel.classList.remove('hidden');
  document.querySelector('#room-input').focus();
});

logoutButton.addEventListener('click', async () => {
  logoutButton.disabled = true;
  try {
    await fetch('/api/logout', { method: 'POST' });
  } finally {
    socket.disconnect();
    chatPanel.classList.add('hidden');
    joinPanel.classList.add('hidden');
    authPanel.classList.remove('hidden');
    logoutButton.classList.add('hidden');
    loginForm.reset();
    registerForm.reset();
    authError.textContent = '';
    showAuthForm('login');
    logoutButton.disabled = false;
  }
});

function showAuthForm(mode) {
  const loggingIn = mode === 'login';
  loginForm.classList.toggle('hidden', !loggingIn);
  registerForm.classList.toggle('hidden', loggingIn);
  document.querySelector('#login-tab').classList.toggle('active', loggingIn);
  document.querySelector('#register-tab').classList.toggle('active', !loggingIn);
  document.querySelector('#login-tab').setAttribute('aria-selected', String(loggingIn));
  document.querySelector('#register-tab').setAttribute('aria-selected', String(!loggingIn));
  authError.textContent = '';
}

function addMessage(message) {
  const item = document.createElement('li');
  item.className = `message${message.name === currentName ? ' mine' : ''}`;
  const header = document.createElement('div');
  header.className = 'message-meta';
  const author = document.createElement('strong');
  author.textContent = message.name;
  const time = document.createElement('time');
  time.dateTime = message.sentAt;
  time.textContent = new Intl.DateTimeFormat('ar', { hour: '2-digit', minute: '2-digit' }).format(new Date(message.sentAt));
  const body = document.createElement('p');
  body.textContent = message.text;
  header.append(author, time);
  item.append(header, body);
  messages.append(item);
  messages.scrollTop = messages.scrollHeight;
}

function addNotice(text) {
  const item = document.createElement('li');
  item.className = 'notice';
  item.textContent = text;
  messages.append(item);
  messages.scrollTop = messages.scrollHeight;
}

restoreSession();
