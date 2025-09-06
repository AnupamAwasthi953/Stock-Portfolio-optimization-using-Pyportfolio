// Simple & Catchy Real-Time Chat Application
class ChatApp {
    constructor() {
        this.currentUser = null;
        this.currentChat = null;
        this.users = [];
        this.messages = {};
        this.socket = null;
        this.authToken = null;
        this.typingTimeout = null;
        this.isConnected = false;
        
        this.init();
    }

    init() {
        this.checkAuthState();
        this.bindEvents();
        this.initializeSocket();
    }

    // Authentication Methods
    checkAuthState() {
        const savedToken = localStorage.getItem('chatapp_token');
        if (savedToken) {
            this.authToken = savedToken;
            this.verifyToken();
        } else {
            this.showAuthModal();
        }
    }

    async verifyToken() {
        try {
            const response = await fetch('/api/auth/verify', {
                headers: {
                    'Authorization': `Bearer ${this.authToken}`
                }
            });

            if (response.ok) {
                const data = await response.json();
                this.currentUser = data.user;
                this.showChatApp();
                this.connectSocket();
            } else {
                this.logout();
            }
        } catch (error) {
            console.error('Token verification failed:', error);
            this.logout();
        }
    }

    showAuthModal() {
        document.getElementById('auth-modal').classList.remove('hidden');
        document.getElementById('chat-app').classList.add('hidden');
    }

    showChatApp() {
        document.getElementById('auth-modal').classList.add('hidden');
        document.getElementById('chat-app').classList.remove('hidden');
        this.initializeChatApp();
    }

    async login(username, password) {
        try {
            this.showToast('Logging in...', 'info');
            
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (response.ok) {
                this.authToken = data.token;
                this.currentUser = data.user;
                localStorage.setItem('chatapp_token', this.authToken);
                
                this.showToast('Welcome back! 🎉', 'success');
                this.showChatApp();
                this.connectSocket();
                return true;
            } else {
                throw new Error(data.error || 'Login failed');
            }
        } catch (error) {
            this.showToast(error.message, 'error');
            throw error;
        }
    }

    async register(username, email, password) {
        try {
            this.showToast('Creating your account...', 'info');
            
            const response = await fetch('/api/auth/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, email, password })
            });

            const data = await response.json();

            if (response.ok) {
                this.authToken = data.token;
                this.currentUser = data.user;
                localStorage.setItem('chatapp_token', this.authToken);
                
                this.showToast('Account created! Welcome aboard! 🚀', 'success');
                this.showChatApp();
                this.connectSocket();
                return true;
            } else {
                throw new Error(data.error || 'Registration failed');
            }
        } catch (error) {
            this.showToast(error.message, 'error');
            throw error;
        }
    }

    logout() {
        localStorage.removeItem('chatapp_token');
        if (this.socket) {
            this.socket.disconnect();
        }
        this.currentUser = null;
        this.currentChat = null;
        this.users = [];
        this.messages = {};
        this.authToken = null;
        this.showAuthModal();
        this.showToast('See you later! 👋', 'info');
    }

    // Socket.io Integration
    initializeSocket() {
        if (typeof io !== 'undefined') {
            this.socket = io();
            this.setupSocketEvents();
        } else {
            console.error('Socket.io not loaded');
        }
    }

    connectSocket() {
        if (this.socket && this.authToken) {
            this.socket.emit('authenticate', this.authToken);
        }
    }

    setupSocketEvents() {
        this.socket.on('connect', () => {
            console.log('Connected to server');
            this.isConnected = true;
            this.updateConnectionStatus();
        });

        this.socket.on('disconnect', () => {
            console.log('Disconnected from server');
            this.isConnected = false;
            this.updateConnectionStatus();
        });

        this.socket.on('authenticated', (data) => {
            console.log('Socket authenticated:', data.user.username);
            this.loadUsers();
        });

        this.socket.on('authentication-error', (error) => {
            console.error('Socket authentication failed:', error);
            this.logout();
        });

        this.socket.on('receive-message', (message) => {
            console.log('Received message:', message);
            this.handleNewMessage(message);
        });

        this.socket.on('message-sent', (message) => {
            console.log('Message sent confirmation:', message);
            this.handleMessageSent(message);
        });

        this.socket.on('user-typing', (data) => {
            this.handleTypingIndicator(data);
        });

        this.socket.on('user-online', (data) => {
            this.handleUserStatusChange(data.userId, true);
        });

        this.socket.on('user-offline', (data) => {
            this.handleUserStatusChange(data.userId, false);
        });

        this.socket.on('error', (error) => {
            this.showToast(error, 'error');
        });
    }

    // Chat Management
    async initializeChatApp() {
        this.updateUserInfo();
        await this.loadUsers();
        this.createEmojiPicker();
    }

    updateUserInfo() {
        if (this.currentUser) {
            document.getElementById('user-name').textContent = this.currentUser.username;
            document.getElementById('user-avatar-text').textContent = this.currentUser.username.charAt(0).toUpperCase();
        }
    }

    async loadUsers() {
        try {
            const response = await fetch('/api/users', {
                headers: {
                    'Authorization': `Bearer ${this.authToken}`
                }
            });

            if (response.ok) {
                const data = await response.json();
                this.users = data.users;
                console.log('Loaded users:', this.users.length);
                this.renderUserList();
            }
        } catch (error) {
            console.error('Failed to load users:', error);
            this.showToast('Failed to load contacts', 'error');
        }
    }

    renderUserList() {
        const chatListContainer = document.getElementById('chat-list-container');
        
        if (this.users.length === 0) {
            chatListContainer.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">💬</div>
                    <h3>No contacts yet</h3>
                    <p>Register more accounts to start chatting!</p>
                </div>
            `;
            return;
        }
        
        chatListContainer.innerHTML = this.users.map(user => {
            const isOnline = user.isOnline;
            const statusText = isOnline ? '🟢 Online' : '⚫ Offline';
            const statusClass = isOnline ? 'online' : 'offline';
            const messageCount = this.messages[user._id] ? this.messages[user._id].length : 0;
            const lastMessage = messageCount > 0 ? 
                this.messages[user._id][messageCount - 1].content.substring(0, 50) + '...' : 
                'No messages yet';
            
            return `
                <div class="chat-item ${statusClass}" data-user-id="${user._id}">
                    <div class="chat-avatar">
                        <span class="chat-avatar-text">${user.username.charAt(0).toUpperCase()}</span>
                        <div class="status-dot ${statusClass}"></div>
                    </div>
                    <div class="chat-item-info">
                        <div class="chat-item-header">
                            <div class="chat-item-name">${user.username}</div>
                            ${messageCount > 0 ? `<div class="message-count">${messageCount}</div>` : ''}
                        </div>
                        <div class="chat-item-preview">${lastMessage}</div>
                        <div class="chat-item-status">${statusText}</div>
                    </div>
                    <div class="chat-arrow">❯</div>
                </div>
            `;
        }).join('');

        this.addUserClickListeners();
    }

    addUserClickListeners() {
        document.querySelectorAll('.chat-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const userId = item.getAttribute('data-user-id');
                if (userId) {
                    this.selectUser(userId);
                }
            });
        });
    }

    async selectUser(userId) {
        document.querySelectorAll('.chat-item').forEach(item => {
            item.classList.remove('active');
        });

        const userElement = document.querySelector(`[data-user-id="${userId}"]`);
        if (userElement) {
            userElement.classList.add('active');
        }

        this.currentChat = this.users.find(user => user._id === userId);
        if (this.currentChat) {
            this.updateChatHeader();
            await this.loadMessages(userId);
            this.showToast(`💬 Chatting with ${this.currentChat.username}`, 'success');
        }
    }

    updateChatHeader() {
        if (this.currentChat) {
            document.getElementById('chat-name').textContent = this.currentChat.username;
            document.getElementById('chat-avatar-text').textContent = this.currentChat.username.charAt(0).toUpperCase();
            const statusText = this.currentChat.isOnline ? '🟢 Online' : '⚫ Offline';
            document.getElementById('chat-status').textContent = statusText;
        }
    }

    async loadMessages(userId) {
        try {
            const response = await fetch(`/api/messages/${userId}`, {
                headers: {
                    'Authorization': `Bearer ${this.authToken}`
                }
            });

            if (response.ok) {
                const data = await response.json();
                this.messages[userId] = data.messages;
                this.renderMessages();
            }
        } catch (error) {
            console.error('Failed to load messages:', error);
            this.showToast('Failed to load messages', 'error');
        }
    }

    // Emoji Picker
    createEmojiPicker() {
        const emojiPicker = document.createElement('div');
        emojiPicker.id = 'emoji-picker';
        emojiPicker.className = 'emoji-picker hidden';
        
        const emojis = [
            '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇',
            '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚',
            '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🤩',
            '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '☹️', '😣',
            '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔',
            '👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '🤙', '👋', '💪',
            '🔥', '⭐', '✨', '🎉', '🎊', '💯', '✅', '❌', '⚡', '💎'
        ];

        emojiPicker.innerHTML = `
            <div class="emoji-header">Choose an emoji</div>
            <div class="emoji-grid">
                ${emojis.map(emoji => `<span class="emoji-item" data-emoji="${emoji}">${emoji}</span>`).join('')}
            </div>
        `;

        document.body.appendChild(emojiPicker);

        emojiPicker.addEventListener('click', (e) => {
            if (e.target.classList.contains('emoji-item')) {
                const emoji = e.target.getAttribute('data-emoji');
                this.insertEmoji(emoji);
                this.hideEmojiPicker();
            }
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('#emoji-picker') && !e.target.closest('.emoji-btn')) {
                this.hideEmojiPicker();
            }
        });
    }

    showEmojiPicker() {
        const picker = document.getElementById('emoji-picker');
        if (picker) {
            picker.style.position = 'fixed';
            picker.style.bottom = '90px';
            picker.style.right = '20px';
            picker.classList.remove('hidden');
        }
    }

    hideEmojiPicker() {
        const picker = document.getElementById('emoji-picker');
        if (picker) {
            picker.classList.add('hidden');
        }
    }

    insertEmoji(emoji) {
        const messageInput = document.getElementById('message-input');
        if (messageInput) {
            const cursorPos = messageInput.selectionStart;
            const textBefore = messageInput.value.substring(0, cursorPos);
            const textAfter = messageInput.value.substring(cursorPos);
            
            messageInput.value = textBefore + emoji + textAfter;
            messageInput.focus();
            messageInput.setSelectionRange(cursorPos + emoji.length, cursorPos + emoji.length);
        }
    }

    // Message Handling
    async sendMessage(content, type = 'text') {
        if (!this.currentChat || !content.trim()) return;

        const messageData = {
            receiverId: this.currentChat._id,
            content: content.trim(),
            messageType: type
        };

        if (this.socket && this.isConnected) {
            this.socket.emit('send-message', messageData);
        }
    }

    handleNewMessage(message) {
        const senderId = message.sender._id || message.sender;
        
        if (!this.messages[senderId]) {
            this.messages[senderId] = [];
        }
        
        this.messages[senderId].push(message);
        
        if (this.currentChat && this.currentChat._id === senderId) {
            this.renderMessages();
        }
        
        if (!this.currentChat || this.currentChat._id !== senderId) {
            const senderName = message.sender.username || 'Someone';
            this.showToast(`💬 New message from ${senderName}`, 'info');
            this.playNotificationSound();
        }

        this.renderUserList();
    }

    handleMessageSent(message) {
        const receiverId = message.receiver._id || message.receiver;
        
        if (!this.messages[receiverId]) {
            this.messages[receiverId] = [];
        }
        
        this.messages[receiverId].push(message);
        
        if (this.currentChat && this.currentChat._id === receiverId) {
            this.renderMessages();
        }

        this.renderUserList();
    }

    renderMessages() {
        if (!this.currentChat) return;

        const messagesList = document.getElementById('messages-list');
        const messages = this.messages[this.currentChat._id] || [];
        
        if (messages.length === 0) {
            messagesList.innerHTML = `
                <div class="empty-chat">
                    <div class="empty-chat-icon">💬</div>
                    <h3>Start the conversation!</h3>
                    <p>Send a message to ${this.currentChat.username}</p>
                </div>
            `;
            return;
        }
        
        messagesList.innerHTML = messages.map((message, index) => {
            const isOwn = message.sender._id === this.currentUser.id || message.sender === this.currentUser.id;
            const time = new Date(message.createdAt || message.timestamp).toLocaleTimeString([], {
                hour: '2-digit', 
                minute: '2-digit'
            });
            
            const senderName = isOwn ? 'You' : (message.sender.username || 'User');
            const avatar = isOwn ? this.currentUser.username.charAt(0).toUpperCase() : 
                           (message.sender.username ? message.sender.username.charAt(0).toUpperCase() : 'U');

            // Check if this message should be grouped with the previous one
            const previousMessage = messages[index - 1];
            const shouldGroup = previousMessage && 
                               (previousMessage.sender._id === message.sender._id || 
                                previousMessage.sender === message.sender);

            return `
                <div class="message ${isOwn ? 'own' : ''} ${shouldGroup ? 'grouped' : ''}">
                    ${!shouldGroup ? `
                        <div class="message-avatar">
                            <span class="message-avatar-text">${avatar}</span>
                        </div>
                    ` : ''}
                    <div class="message-content">
                        ${!shouldGroup ? `
                            <div class="message-header">
                                <span class="message-author">${senderName}</span>
                                <span class="message-time">${time}</span>
                            </div>
                        ` : ''}
                        <div class="message-bubble">
                            <div class="message-text">${this.escapeHtml(message.content)}</div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        setTimeout(() => {
            messagesList.scrollTop = messagesList.scrollHeight;
        }, 100);
    }

    // Typing Indicators
    handleTypingIndicator(data) {
        if (this.currentChat && data.userId === this.currentChat._id) {
            const typingElement = document.querySelector('.typing-indicator');
            if (data.isTyping) {
                if (!typingElement) {
                    const indicator = document.createElement('div');
                    indicator.className = 'typing-indicator';
                    indicator.innerHTML = `
                        <div class="typing-avatar">
                            <span>${data.username.charAt(0).toUpperCase()}</span>
                        </div>
                        <div class="typing-content">
                            <div class="typing-dots">
                                <span></span>
                                <span></span>
                                <span></span>
                            </div>
                            <span class="typing-text">${data.username} is typing...</span>
                        </div>
                    `;
                    document.getElementById('messages-list').appendChild(indicator);
                }
            } else {
                if (typingElement) {
                    typingElement.remove();
                }
            }
        }
    }

    handleUserStatusChange(userId, isOnline) {
        const user = this.users.find(u => u._id === userId);
        if (user) {
            user.isOnline = isOnline;
            this.renderUserList();
            
            if (this.currentChat && this.currentChat._id === userId) {
                this.currentChat.isOnline = isOnline;
                this.updateChatHeader();
            }
        }
    }

    // Event Bindings
    bindEvents() {
        // Login form
        document.getElementById('login-form')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('login-email').value;
            const password = document.getElementById('login-password').value;
            
            try {
                await this.login(username, password);
            } catch (error) {
                // Error already handled
            }
        });

        // Register form
        document.getElementById('register-form')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('register-name').value;
            const email = document.getElementById('register-email').value;
            const password = document.getElementById('register-password').value;
            
            try {
                await this.register(username, email, password);
            } catch (error) {
                // Error already handled
            }
        });

        // Form toggle
        document.getElementById('show-register')?.addEventListener('click', () => {
            document.getElementById('login-form').classList.add('hidden');
            document.getElementById('register-form').classList.remove('hidden');
            document.getElementById('auth-title').textContent = 'Join ChatApp';
            document.getElementById('auth-subtitle').textContent = 'Create your account and start chatting!';
        });

        document.getElementById('show-login')?.addEventListener('click', () => {
            document.getElementById('register-form').classList.add('hidden');
            document.getElementById('login-form').classList.remove('hidden');
            document.getElementById('auth-title').textContent = 'Welcome Back!';
            document.getElementById('auth-subtitle').textContent = 'Sign in to continue chatting';
        });

        // Logout
        document.getElementById('logout-btn')?.addEventListener('click', () => {
            this.logout();
        });

        // Emoji button
        document.querySelector('.emoji-btn')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showEmojiPicker();
        });

        // Message input
        const messageInput = document.getElementById('message-input');
        const sendBtn = document.getElementById('send-btn');

        // Auto-resize textarea
        messageInput?.addEventListener('input', (e) => {
            e.target.style.height = 'auto';
            e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
            
            // Typing indicator
            if (this.currentChat && this.socket) {
                this.socket.emit('typing', { receiverId: this.currentChat._id });
                
                clearTimeout(this.typingTimeout);
                this.typingTimeout = setTimeout(() => {
                    this.socket.emit('stop-typing', { receiverId: this.currentChat._id });
                }, 1000);
            }
        });

        messageInput?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.handleSendMessage();
            }
        });

        sendBtn?.addEventListener('click', () => {
            this.handleSendMessage();
        });
    }

    handleSendMessage() {
        const messageInput = document.getElementById('message-input');
        const content = messageInput.value.trim();
        
        if (content && this.currentChat) {
            this.sendMessage(content);
            messageInput.value = '';
            messageInput.style.height = 'auto';
        } else if (!this.currentChat) {
            this.showToast('Please select a contact to start chatting 💬', 'warning');
        }
    }

    // Utility Methods
    updateConnectionStatus() {
        const indicator = document.querySelector('.connection-indicator');
        if (indicator) {
            if (this.isConnected) {
                indicator.className = 'connection-indicator online';
                indicator.title = 'Connected';
            } else {
                indicator.className = 'connection-indicator offline';
                indicator.title = 'Disconnected';
            }
        }
    }

    showToast(message, type = 'info') {
        const toastContainer = document.querySelector('.toast-container') || this.createToastContainer();
        const toast = document.createElement('div');
        toast.className = `toast toast--${type}`;
        toast.innerHTML = `
            <div class="toast-icon">
                ${type === 'success' ? '✅' : type === 'error' ? '❌' : type === 'warning' ? '⚠️' : 'ℹ️'}
            </div>
            <div class="toast-content">${message}</div>
        `;
        
        toastContainer.appendChild(toast);
        
        // Animate in
        setTimeout(() => toast.classList.add('show'), 100);
        
        // Remove after delay
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }

    createToastContainer() {
        const container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
        return container;
    }

    playNotificationSound() {
        try {
            const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+Dx3mUcDTyH0O7bfSgEJ4PQ7+OSTwsOVqzn77BdGAg+ltryxnkpBSl+z+/eizEIHWq+8OGYTAwNUKXh8bllIA==');
            audio.volume = 0.3;
            audio.play().catch(() => {}); // Ignore errors if audio can't play
        } catch (error) {
            // Ignore audio errors
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize the app
const app = new ChatApp();