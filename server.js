const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const { sequelize, connectMongoDB } = require('./config/db');
const { socketAuthMiddleware } = require('./middleware/authMiddleware');
const chatHandler = require('./socket/chatHandler');

// Routes
const authRoutes = require('./routes/auth');
const conversationRoutes = require('./routes/conversation');
const communityRoutes = require('./routes/community');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // Adjust for production
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('frontend'));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/communities', communityRoutes);

// Socket.IO Middleware & Handler
io.use(socketAuthMiddleware);
chatHandler(io);

// Connect Databases and Start Server
const startServer = async () => {
  try {
    // Connect MySQL
    await sequelize.authenticate();
    console.log('✅ MySQL Connected');
    
    // Sync models (optional, be careful with existing tables)
    // await sequelize.sync(); 

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
