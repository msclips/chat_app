const API_URL = window.location.origin;
let socket = null;
let currentUser = null;
let currentToken = null;
let activeConversationId = null;
let activeCommunityId = null;
let conversations = [];
let communities = [];
let allUsers = [];


// DOM Elements
const loginView = document.getElementById('login-view');
const chatView = document.getElementById('chat-view');
const loginForm = document.getElementById('login-form');
const conversationsContainer = document.getElementById('conversations-container');
const communitiesContainer = document.getElementById('communities-container');
const messagesContainer = document.getElementById('messages-container');
const activeChat = document.getElementById('active-chat');
const noChatSelected = document.getElementById('no-chat-selected');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const chatWithName = document.getElementById('chat-with-name');
const logoutBtn = document.getElementById('logout-btn');
const newChatBtn = document.getElementById('new-chat-btn');
const newChatModal = document.getElementById('new-chat-modal');
const closeModalBtn = document.getElementById('close-modal');
const usersListContainer = document.getElementById('users-list');
const userSearchInput = document.getElementById('user-search-input');

const chatsTab = document.getElementById('chats-tab');
const communitiesTab = document.getElementById('communities-tab');
const chatsContent = document.getElementById('chats-content');
const communitiesContent = document.getElementById('communities-content');

// --- Initialization ---

// Check for existing session
const savedToken = localStorage.getItem('token');
const savedUser = localStorage.getItem('user');

if (savedToken && savedUser) {
    currentToken = savedToken;
    currentUser = JSON.parse(savedUser);
    showChatView();
}

// --- Auth Functions ---

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const user_name = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const loginBtn = document.getElementById('login-btn');

    try {
        loginBtn.disabled = true;
        loginBtn.innerHTML = '<span>Signing In...</span>';

        const response = await fetch(`${API_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_name, password })
        });

        const data = await response.json();

        if (response.ok) {
            currentToken = data.token;
            currentUser = data.user;
            localStorage.setItem('token', currentToken);
            localStorage.setItem('user', JSON.stringify(currentUser));
            showChatView();
        } else {
            alert(data.message || 'Login failed');
        }
    } catch (err) {
        console.error('Login error:', err);
        alert('Could not connect to server');
    } finally {
        loginBtn.disabled = false;
        loginBtn.innerHTML = '<span>Sign In</span><i class="ph ph-arrow-right"></i>';
    }
});

logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.reload();
});

function showChatView() {
    loginView.classList.add('hidden');
    chatView.classList.remove('hidden');
    document.getElementById('current-username').textContent = currentUser.user_name;
    document.getElementById('current-user-avatar').textContent = currentUser.user_name.charAt(0).toUpperCase();
    
    initSocket();
    fetchConversations();
    fetchCommunities();
    fetchUsers();
}

// --- Tab Switching ---

chatsTab.addEventListener('click', () => {
    chatsTab.classList.add('active');
    communitiesTab.classList.remove('active');
    chatsContent.classList.remove('hidden');
    communitiesContent.classList.add('hidden');
});

communitiesTab.addEventListener('click', () => {
    communitiesTab.classList.add('active');
    chatsTab.classList.remove('active');
    communitiesContent.classList.remove('hidden');
    chatsContent.classList.add('hidden');
});

// --- Socket.IO Functions ---

function initSocket() {
    socket = io(API_URL, {
        auth: { token: currentToken }
    });

    socket.on('connect', () => {
        console.log('✅ Connected to socket');
    });

    socket.on('message:new', (message) => {
        if (message.conversationId === activeConversationId) {
            appendMessage(message);
            scrollToBottom();
        }
        updateConversationPreview(message);
    });

    socket.on('message:delivered', ({ tempId, message }) => {
        // Find and update the temporary message if needed
        const tempMsg = document.querySelector(`[data-temp-id="${tempId}"]`);
        if (tempMsg) {
            tempMsg.classList.remove('pending');
            tempMsg.removeAttribute('data-temp-id');
        }
        updateConversationPreview(message);
    });

    socket.on('conversation:updated', ({ conversationId, lastMessage }) => {
        updateConversationPreview(lastMessage);
    });

    socket.on('connect_error', (err) => {
        console.error('Socket connection error:', err.message);
        if (err.message.includes('Authentication')) {
            logoutBtn.click();
        }
    });
}

// --- Data Fetching ---

async function fetchConversations() {
    try {
        const response = await fetch(`${API_URL}/api/conversations`, {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        conversations = await response.json();
        renderConversations();
        
        // Auto-select the first conversation if none active
        if (!activeConversationId && conversations.length > 0) {
            const firstConv = conversations[0];
            const otherParticipant = firstConv.participants.find(p => p.userId !== currentUser.id);
            const name = otherParticipant ? otherParticipant.username : 'Group Chat';
            selectConversation(firstConv._id, name);
        }

        // Join all conversation rooms
        if (conversations.length > 0) {
            const ids = conversations.map(c => c._id);
            socket.emit('conversations:join', ids);
        }
    } catch (err) {
        console.error('Fetch conversations error:', err);
    }
}

async function fetchCommunities() {
    try {
        const response = await fetch(`${API_URL}/api/communities`, {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        communities = await response.json();
        renderCommunities();
    } catch (err) {
        console.error('Fetch communities error:', err);
    }
}

async function fetchUsers() {
    try {
        const response = await fetch(`${API_URL}/api/auth/users`, {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        allUsers = await response.json();
        renderUsers();
    } catch (err) {
        console.error('Fetch users error:', err);
    }
}

// --- UI Rendering ---

function renderConversations() {
    conversationsContainer.innerHTML = '';
    conversations.forEach(conv => {
        const otherParticipant = conv.participants.find(p => p.userId !== currentUser.id);
        const name = otherParticipant ? otherParticipant.username : 'Group Chat';
        const lastMsg = conv.lastMessage ? 'New message...' : 'No messages yet';
        
        const div = document.createElement('div');
        div.className = `conv-item ${conv._id === activeConversationId ? 'active' : ''}`;
        div.onclick = () => selectConversation(conv._id, name);
        
        div.innerHTML = `
            <div class="avatar">${name.charAt(0).toUpperCase()}</div>
            <div class="conv-info">
                <div class="conv-name-row">
                    <h4>${name}</h4>
                    <span class="conv-time">${formatDate(conv.updatedAt)}</span>
                </div>
                <p class="conv-last-msg" id="last-msg-${conv._id}">${lastMsg}</p>
            </div>
        `;
        conversationsContainer.appendChild(div);
    });
}

function renderCommunities() {
    communitiesContainer.innerHTML = '';
    if (communities.length === 0) {
        communitiesContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 13px;">No communities found.</div>';
        return;
    }
    communities.forEach(comm => {
        const name = comm.group_name;
        
        const div = document.createElement('div');
        div.className = `conv-item ${comm.group_id === activeCommunityId ? 'active' : ''}`;
        div.onclick = () => selectCommunity(comm.group_id, name);
        
        div.innerHTML = `
            <div class="avatar" style="background: linear-gradient(135deg, #f59e0b, #d97706)">${name.charAt(0).toUpperCase()}</div>
            <div class="conv-info">
                <div class="conv-name-row">
                    <h4>${name}</h4>
                </div>
                <p class="conv-last-msg">Community Chat</p>
            </div>
        `;
        communitiesContainer.appendChild(div);
    });
}

function renderUsers(filter = '') {
    usersListContainer.innerHTML = '';
    const filteredUsers = allUsers.filter(u => 
        u.user_name.toLowerCase().includes(filter.toLowerCase())
    );

    if (filteredUsers.length === 0) {
        usersListContainer.innerHTML = '<p class="text-muted" style="text-align: center; padding: 20px;">No users found</p>';
        return;
    }

    filteredUsers.forEach(user => {
        const div = document.createElement('div');
        div.className = 'user-item';
        div.onclick = () => startConversation(user.id, user.user_name);
        
        div.innerHTML = `
            <div class="avatar">${user.user_name.charAt(0).toUpperCase()}</div>
            <div class="user-name">${user.user_name}</div>
        `;
        usersListContainer.appendChild(div);
    });
}

async function fetchMessages(conversationId) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

    try {
        console.log(`Fetching messages for ${conversationId}...`);
        const response = await fetch(`${API_URL}/api/conversations/${conversationId}/messages`, {
            headers: { 'Authorization': `Bearer ${currentToken}` },
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) throw new Error(`Server returned ${response.status}`);
        
        const messages = await response.json();
        console.log(`Received ${messages.length} messages`);
        messagesContainer.innerHTML = '';
        
        if (messages.length === 0) {
            messagesContainer.innerHTML = '<div class="empty-messages">No messages yet. Say hello!</div>';
        } else {
            messages.forEach(msg => appendMessage(msg));
            scrollToBottom();
        }
    } catch (err) {
        clearTimeout(timeoutId);
        console.error('Fetch messages error:', err);
        messagesContainer.innerHTML = `<div class="error-messages">Error loading message history: ${err.message}</div>`;
    }
}

async function startConversation(participantId, username) {
    try {
        const response = await fetch(`${API_URL}/api/conversations`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentToken}`
            },
            body: JSON.stringify({ participantId })
        });
        
        const conversation = await response.json();
        
        if (response.ok) {
            newChatModal.classList.add('hidden');
            activeConversationId = conversation._id;
            
            // Re-fetch conversations to include the new one and join its room
            await fetchConversations();
            
            // Select the conversation
            selectConversation(conversation._id, username);
        } else {
            alert(conversation.message || 'Error starting conversation');
        }
    } catch (err) {
        console.error('Start conversation error:', err);
    }
}

function selectConversation(id, name, isCommunity = false, canSend = true) {
    activeConversationId = id;
    if (!isCommunity) activeCommunityId = null;
    
    chatWithName.textContent = name;
    document.getElementById('chat-avatar').textContent = name.charAt(0).toUpperCase();
    
    // Update avatar color for community
    if (isCommunity) {
        document.getElementById('chat-avatar').style.background = 'linear-gradient(135deg, #f59e0b, #d97706)';
        document.querySelector('.status-text').textContent = 'Public Community';
    } else {
        document.getElementById('chat-avatar').style.background = '';
        document.querySelector('.status-text').textContent = 'Online';
    }

    noChatSelected.classList.add('hidden');
    activeChat.classList.remove('hidden');
    
    // Clear messages and fetch history
    messagesContainer.innerHTML = '<div class="loading-messages">Loading history...</div>';
    fetchMessages(id);
    
    // Handle read-only state for communities
    if (!canSend) {
        messageInput.placeholder = "You are not a member of this community";
        messageInput.disabled = true;
        document.getElementById('send-btn').disabled = true;
        document.getElementById('send-btn').style.opacity = '0.5';
    } else {
        messageInput.placeholder = "Type a message...";
        messageInput.disabled = false;
        document.getElementById('send-btn').disabled = false;
        document.getElementById('send-btn').style.opacity = '1';
    }

    // Highlight active item in sidebar
    document.querySelectorAll('.conv-item').forEach(el => el.classList.remove('active'));
    renderConversations();
    renderCommunities();

    // Focus input
    if (!messageInput.disabled) messageInput.focus();
}

async function selectCommunity(groupId, name) {
    try {
        activeCommunityId = groupId;
        
        // Init/Get community conversation
        const response = await fetch(`${API_URL}/api/communities/${groupId}/init`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        
        const data = await response.json();
        
        if (response.ok) {
            const conversation = data.conversation;
            
            // Join the room via socket
            socket.emit('conversations:join', [conversation._id]);
            
            selectConversation(conversation._id, name, true, data.isMember);
        } else {
            alert(data.message || 'Error joining community');
        }
    } catch (err) {
        console.error('Select community error:', err);
    }
}

function appendMessage(message) {
    const isSent = message.senderId === currentUser.id;
    const div = document.createElement('div');
    div.className = `message ${isSent ? 'sent' : 'received'}`;
    
    div.innerHTML = `
        <div class="message-content">${escapeHTML(message.content)}</div>
        <div class="message-time">${formatTime(message.createdAt)}</div>
    `;
    
    messagesContainer.appendChild(div);
}

function updateConversationPreview(message) {
    const lastMsgEl = document.getElementById(`last-msg-${message.conversationId}`);
    if (lastMsgEl) {
        lastMsgEl.textContent = message.content;
    }
    
    // Optional: Move conversation to top
    // fetchConversations(); 
}

// --- Message Sending ---

messageForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const content = messageInput.value.trim();
    if (!content || !activeConversationId) return;

    const tempId = Date.now().toString();
    const messageData = {
        conversationId: activeConversationId,
        content: content,
        messageType: 'text',
        tempId: tempId
    };

    // Optimistic UI update
    appendMessage({
        senderId: currentUser.id,
        content: content,
        createdAt: new Date().toISOString()
    });
    
    // Add temp ID to the last message element to track it
    messagesContainer.lastElementChild.setAttribute('data-temp-id', tempId);
    messagesContainer.lastElementChild.classList.add('pending');

    socket.emit('message:send', messageData);
    messageInput.value = '';
    scrollToBottom();
});

// --- Modal Events ---

newChatBtn.addEventListener('click', () => {
    newChatModal.classList.remove('hidden');
    userSearchInput.value = '';
    renderUsers();
    userSearchInput.focus();
});

closeModalBtn.addEventListener('click', () => {
    newChatModal.classList.add('hidden');
});

newChatModal.addEventListener('click', (e) => {
    if (e.target === newChatModal) {
        newChatModal.classList.add('hidden');
    }
});

userSearchInput.addEventListener('input', (e) => {
    renderUsers(e.target.value);
});


// --- Utilities ---

function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function formatDate(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    if (date.toDateString() === now.toDateString()) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatTime(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function escapeHTML(str) {
    const p = document.createElement('p');
    p.textContent = str;
    return p.innerHTML;
}
