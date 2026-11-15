const express = require('express');
const http = require('node:http');
const path = require('node:path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const MAX_NAME_LENGTH = 24;
const MAX_ROOM_LENGTH = 32;
const MAX_MESSAGE_LENGTH = 1000;

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

io.on('connection', (socket) => {
  socket.on('chat:join', (payload = {}) => {
    const name = cleanText(payload.name, MAX_NAME_LENGTH);
    const room = cleanText(payload.room, MAX_ROOM_LENGTH).toLowerCase();
    if (!name || !room || !/^[\p{L}\p{N}_-]+$/u.test(room)) {
      socket.emit('chat:error', 'أدخل اسماً وغرفة صالحة. استخدم أحرفاً أو أرقاماً أو _ أو -.');
      return;
    }

    if (socket.data.room) socket.leave(socket.data.room);
    socket.data.name = name;
    socket.data.room = room;
    socket.join(room);
    socket.emit('chat:joined', { name, room });
    socket.to(room).emit('chat:notice', `${name} انضم إلى الغرفة`);
  });

  socket.on('chat:message', (payload = {}) => {
    const room = socket.data.room;
    const name = socket.data.name;
    const text = cleanText(payload.text, MAX_MESSAGE_LENGTH);
    if (!room || !name || !text) return;

    io.to(room).emit('chat:message', {
      id: socket.id,
      name,
      text,
      sentAt: new Date().toISOString()
    });
  });

  socket.on('disconnect', () => {
    if (socket.data.room && socket.data.name) {
      socket.to(socket.data.room).emit('chat:notice', `${socket.data.name} غادر الغرفة`);
    }
  });
});

server.listen(PORT, () => {
  console.log(`HamChat is running at http://localhost:${PORT}`);
});
