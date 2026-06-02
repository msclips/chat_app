const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const { sequelize, connectMongoDB } = require('./config/db');

// Routes
const userRoutes = require('./routes/users');
const conversationRoutes = require('./routes/conversation');
const communityRoutes = require('./routes/community');
const groupRoutes = require('./routes/group');
const socketRoutes = require('./routes/socket');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // Adjust for production
    methods: ['GET', 'POST']
  }
});

// Share io instance with express app
app.set('io', io);

// Socket.IO authentication middleware
io.use((socket, next) => {
  const userId = socket.handshake.auth.userId;
  const username = socket.handshake.auth.username;
  if (!userId) {
    return next(new Error('Authentication error: User ID is required'));
  }
  socket.user = { id: Number(userId), user_name: username };
  next();
});

// Register Socket.IO handlers
const chatHandler = require('./socket/chatHandler');
chatHandler(io);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('frontend'));

// API Routes
app.use('/api/users', userRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/communities', communityRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/socket', socketRoutes);


// Connect Databases and Start Server
const startServer = async () => {
  try {
    // Connect MySQL
    await sequelize.authenticate();
    console.log('✅ MySQL Connected');
    
    // Connect MongoDB
    await connectMongoDB();

    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error('❌ Server Initialization Error:', err.message);
  }
};

startServer();
