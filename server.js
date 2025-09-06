// Simple & Clean Chat Server - Text Messages Only
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config();

// Initialize Express app and server
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50 // Reasonable limit for simple chat
});
app.use('/api', limiter);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/chatapp';

mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('✅ Connected to MongoDB'))
.catch(err => console.error('❌ MongoDB connection error:', err));

// Simple User Schema
const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minLength: 3,
    maxLength: 20
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true,
    minLength: 6
  },
  isOnline: {
    type: Boolean,
    default: false
  },
  lastSeen: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Simple Message Schema - Text Only
const messageSchema = new mongoose.Schema({
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  receiver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  content: {
    type: String,
    required: true,
    maxLength: 1000,
    trim: true
  },
  messageType: {
    type: String,
    enum: ['text'],
    default: 'text'
  },
  delivered: {
    type: Boolean,
    default: false
  },
  read: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

const User = mongoose.model('User', userSchema);
const Message = mongoose.model('Message', messageSchema);

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// Generate JWT token
const generateToken = (userId) => {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' });
};

// API Routes

// User Registration
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // Validation
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    if (username.length < 3 || username.length > 20) {
      return res.status(400).json({ error: 'Username must be 3-20 characters' });
    }

    // Check if user exists
    const existingUser = await User.findOne({
      $or: [{ email }, { username }]
    });

    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = new User({
      username,
      email,
      password: hashedPassword
    });

    await user.save();
    const token = generateToken(user._id);

    res.status(201).json({
      message: 'Account created successfully',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// User Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    // Find user
    const user = await User.findOne({
      $or: [{ username }, { email: username }]
    });

    if (!user) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    // Check password
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    // Update online status
    user.isOnline = true;
    user.lastSeen = new Date();
    await user.save();

    const token = generateToken(user._id);

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Verify token
app.get('/api/auth/verify', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-password');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        isOnline: user.isOnline,
        lastSeen: user.lastSeen
      }
    });
  } catch (error) {
    console.error('Verify error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all users (contacts)
app.get('/api/users', authenticateToken, async (req, res) => {
  try {
    const users = await User.find({
      _id: { $ne: req.user.userId }
    }).select('username email isOnline lastSeen').limit(50);

    res.json({ users });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get chat history
app.get('/api/messages/:userId', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user.userId;

    const messages = await Message.find({
      $or: [
        { sender: currentUserId, receiver: userId },
        { sender: userId, receiver: currentUserId }
      ]
    })
    .populate('sender', 'username')
    .populate('receiver', 'username')
    .sort({ createdAt: 1 })
    .limit(100);

    res.json({ messages });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Send message - Text only
app.post('/api/messages', authenticateToken, async (req, res) => {
  try {
    const { receiverId, content } = req.body;
    const senderId = req.user.userId;

    if (!receiverId || !content || !content.trim()) {
      return res.status(400).json({ error: 'Receiver and message content required' });
    }

    const messageData = {
      sender: senderId,
      receiver: receiverId,
      content: content.trim(),
      messageType: 'text'
    };

    const message = new Message(messageData);
    await message.save();
    await message.populate('sender', 'username');
    await message.populate('receiver', 'username');

    // Send via Socket.io
    io.to(`user_${receiverId}`).emit('receive-message', message);
    io.to(`user_${senderId}`).emit('message-sent', message);

    res.status(201).json({ message });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Socket.io - Simple Text Chat Only
const connectedUsers = new Map();

io.on('connection', (socket) => {
  console.log('👤 New connection:', socket.id);

  // Authenticate socket
  socket.on('authenticate', async (token) => {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = await User.findById(decoded.userId).select('-password');
      
      if (user) {
        socket.userId = user._id.toString();
        socket.username = user.username;
        
        // Join user room
        socket.join(`user_${socket.userId}`);
        
        // Update online status
        user.isOnline = true;
        user.lastSeen = new Date();
        await user.save();
        
        // Store connection
        connectedUsers.set(socket.userId, {
          socketId: socket.id,
          username: user.username
        });
        
        socket.emit('authenticated', {
          user: {
            id: user._id,
            username: user.username,
            email: user.email
          }
        });
        
        // Broadcast online status
        socket.broadcast.emit('user-online', {
          userId: user._id,
          username: user.username
        });
        
        console.log(`✅ ${user.username} connected`);
      } else {
        socket.emit('authentication-error', 'User not found');
      }
    } catch (error) {
      console.error('Auth error:', error);
      socket.emit('authentication-error', 'Invalid token');
    }
  });

  // Handle text messages
  socket.on('send-message', async (data) => {
    try {
      if (!socket.userId) {
        socket.emit('error', 'Not authenticated');
        return;
      }

      const { receiverId, content, messageType = 'text' } = data;
      
      if (!receiverId || !content || !content.trim()) {
        socket.emit('error', 'Invalid message data');
        return;
      }

      // Only allow text messages
      if (messageType !== 'text') {
        socket.emit('error', 'Only text messages allowed');
        return;
      }

      console.log(`💬 Message from ${socket.username}: "${content.substring(0, 50)}..."`);

      const messageData = {
        sender: socket.userId,
        receiver: receiverId,
        content: content.trim(),
        messageType: 'text'
      };

      const message = new Message(messageData);
      await message.save();
      await message.populate('sender', 'username');
      await message.populate('receiver', 'username');

      // Send to receiver
      io.to(`user_${receiverId}`).emit('receive-message', message);
      
      // Confirm to sender
      socket.emit('message-sent', message);

      console.log(`✅ Message delivered`);

    } catch (error) {
      console.error('Send message error:', error);
      socket.emit('error', 'Failed to send message');
    }
  });

  // Typing indicators
  socket.on('typing', (data) => {
    if (socket.userId && data.receiverId) {
      io.to(`user_${data.receiverId}`).emit('user-typing', {
        userId: socket.userId,
        username: socket.username,
        isTyping: true
      });
    }
  });

  socket.on('stop-typing', (data) => {
    if (socket.userId && data.receiverId) {
      io.to(`user_${data.receiverId}`).emit('user-typing', {
        userId: socket.userId,
        username: socket.username,
        isTyping: false
      });
    }
  });

  // Handle disconnection
  socket.on('disconnect', async () => {
    if (socket.userId) {
      console.log(`👋 ${socket.username} disconnected`);
      
      try {
        // Update offline status
        const user = await User.findById(socket.userId);
        if (user) {
          user.isOnline = false;
          user.lastSeen = new Date();
          await user.save();
        }
        
        // Remove from connected users
        connectedUsers.delete(socket.userId);
        
        // Broadcast offline status
        socket.broadcast.emit('user-offline', {
          userId: socket.userId,
          username: socket.username
        });
      } catch (error) {
        console.error('Disconnect error:', error);
      }
    }
  });
});

// Error handling
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({ error: 'Server error' });
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Simple ChatApp Server running on port ${PORT}`);
  console.log(`💬 Features: Text messaging only`);
  console.log(`✨ Clean, simple, and reliable!`);
  console.log(`🌐 Open http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down server...');
  
  // Set all connected users offline
  for (const [userId] of connectedUsers) {
    try {
      await User.findByIdAndUpdate(userId, { 
        isOnline: false, 
        lastSeen: new Date() 
      });
    } catch (error) {
      console.error('Error updating user status:', error);
    }
  }
  
  // Close database
  await mongoose.connection.close();
  console.log('✅ Database closed');
  
  process.exit(0);
});

module.exports = { app, server, io };