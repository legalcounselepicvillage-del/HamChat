const socket = io();
const joinPanel = document.querySelector('#join-panel');
const chatPanel = document.querySelector('#chat-panel');
const joinForm = document.querySelector('#join-form');
const messageForm = document.querySelector('#message-form');
const joinError = document.querySelector('#join-error');
const messages = document.querySelector('#messages');
const connectionStatus = document.querySelector('#connection-status');
const messageInput = document.querySelector('#message-input');
let currentName = '';

socket.on('connect', () => {
  connectionStatus.textContent = 'متصل';
  connectionStatus.classList.add('online');
});
socket.on('disconnect', () => {
  connectionStatus.textContent = 'انقطع الاتصال';
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

joinForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const formData = new FormData(joinForm);
  socket.emit('chat:join', {
    name: formData.get('name'),
    room: formData.get('room')
  });
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
  document.querySelector('#name-input').value = currentName;
  document.querySelector('#room-input').focus();
});

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
