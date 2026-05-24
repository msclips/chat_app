const API_URL = window.location.origin;
let socket = null;
let currentUser = null;
let activeConversationId = null;
let activeCommunityId = null;
let conversations = [];
let communities = [];
let allUsers = [];

// DOM Elements
const loginView = document.getElementById('login-view');
const chatView = document.getElementById('chat-view');
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

/**
 * Helper to generate request headers with user identity.
 * Bypasses all Bearer/JWT tokens by sending direct identity headers.
 */
function getHeaders() {
    return {
        'Content-Type': 'application/json',
        'X-User-Id': currentUser ? currentUser.id : '',
        'X-User-Name': currentUser ? currentUser.user_name : ''
    };
}

// --- Initialization ---

async function initApp() {
    // Hide login view immediately
    if (loginView) {
        loginView.style.display = 'none';
        loginView.classList.add('hidden');
    }

    const savedUser = localStorage.getItem('user');

    if (savedUser) {
        try {
            currentUser = JSON.parse(savedUser);
            showChatView();
        } catch (e) {
            localStorage.removeItem('user');
            initApp();
        }
    } else {
        // Prompt for a quick chat nickname to directly register
        let user_name = prompt("Welcome to GlowChat!\nEnter your name to start chatting:");
        if (!user_name || !user_name.trim()) {
            user_name = "Guest_" + Math.floor(1000 + Math.random() * 9000);
        }
        user_name = user_name.trim();

        try {
            const response = await fetch(`${API_URL}/api/users/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_name })
            });

            const data = await response.json();

            if (response.ok) {
                currentUser = data.user;
                localStorage.setItem('user', JSON.stringify(currentUser));
                showChatView();
            } else {
                alert('Could not join chat: ' + (data.message || 'unknown error'));
                initApp();
            }
        } catch (err) {
            console.error('App init error:', err);
            alert('Could not connect to server. Retrying...');
            setTimeout(initApp, 2000);
        }
    }
}

logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('user');
    window.location.reload();
});

function showChatView() {
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
    // Authenticate directly using userId and username parameters (no token)
    socket = io(API_URL, {
        auth: {
            userId: currentUser.id,
            username: currentUser.user_name
        }
    });

    socket.on('connect', () => {
        console.log('✅ Connected to socket as:', currentUser.user_name);
    });

    socket.on('message:new', (message) => {
        if (message.conversationId === activeConversationId) {
            appendMessage(message);
            scrollToBottom();
        }
        updateConversationPreview(message);
    });

    socket.on('message:delivered', ({ tempId, message }) => {
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

    socket.on('conversation:accepted', ({ conversationId }) => {
        const conv = conversations.find(c => c._id === conversationId);
        if (conv) {
            conv.status = 'accepted';
            if (activeConversationId === conversationId) {
                selectConversation(conversationId, chatWithName.textContent);
            }
        }
    });

    socket.on('connect_error', (err) => {
        console.error('Socket connection error:', err.message);
    });
}

// --- Data Fetching ---

async function fetchConversations() {
    try {
        const response = await fetch(`${API_URL}/api/conversations`, {
            headers: getHeaders()
        });
        conversations = await response.json();
        renderConversations();
        
        if (!activeConversationId && conversations.length > 0) {
            const firstConv = conversations[0];
            const otherParticipant = firstConv.participants.find(p => p.userId !== currentUser.id);
            const name = otherParticipant ? otherParticipant.username : 'Group Chat';
            selectConversation(firstConv._id, name);
        }

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
            headers: getHeaders()
        });
        communities = await response.json();
        renderCommunities();
    } catch (err) {
        console.error('Fetch communities error:', err);
    }
}

async function fetchUsers() {
    try {
        const response = await fetch(`${API_URL}/api/users`, {
            headers: getHeaders()
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
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
        console.log(`Fetching messages for ${conversationId}...`);
        const response = await fetch(`${API_URL}/api/conversations/${conversationId}/messages`, {
            headers: getHeaders(),
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) throw new Error(`Server returned ${response.status}`);
        
        const messages = await response.json();
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
            headers: getHeaders(),
            body: JSON.stringify({ participantId })
        });
        
        const conversation = await response.json();
        
        if (response.ok) {
            newChatModal.classList.add('hidden');
            activeConversationId = conversation._id;
            await fetchConversations();
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
    
    if (isCommunity) {
        document.getElementById('chat-avatar').style.background = 'linear-gradient(135deg, #f59e0b, #d97706)';
        document.querySelector('.status-text').textContent = 'Public Community';
    } else {
        document.getElementById('chat-avatar').style.background = '';
        document.querySelector('.status-text').textContent = 'Online';
    }

    noChatSelected.classList.add('hidden');
    activeChat.classList.remove('hidden');
    
    messagesContainer.innerHTML = '<div class="loading-messages">Loading history...</div>';
    fetchMessages(id);
    
    // Manage Accept / Reject banners
    const requestBanner = document.getElementById('request-banner');
    const waitingBanner = document.getElementById('waiting-banner');
    
    requestBanner.classList.add('hidden');
    waitingBanner.classList.add('hidden');
    
    let isPendingRecipient = false;
    
    if (!isCommunity) {
        const activeConv = conversations.find(c => c._id === id);
        if (activeConv && activeConv.status === 'pending') {
            if (activeConv.initiatorId !== currentUser.id) {
                isPendingRecipient = true;
                document.getElementById('request-sender-name').textContent = name;
                requestBanner.classList.remove('hidden');
            } else {
                waitingBanner.classList.remove('hidden');
            }
        }
    }
    
    if (!canSend) {
        messageInput.placeholder = "You are not a member of this community";
        messageInput.disabled = true;
        document.getElementById('send-btn').disabled = true;
        document.getElementById('send-btn').style.opacity = '0.5';
    } else if (isPendingRecipient) {
        messageInput.placeholder = "Accept message request to start chatting...";
        messageInput.disabled = true;
        document.getElementById('send-btn').disabled = true;
        document.getElementById('send-btn').style.opacity = '0.5';
    } else {
        messageInput.placeholder = "Type a message...";
        messageInput.disabled = false;
        document.getElementById('send-btn').disabled = false;
        document.getElementById('send-btn').style.opacity = '1';
    }

    document.querySelectorAll('.conv-item').forEach(el => el.classList.remove('active'));
    renderConversations();
    renderCommunities();

    if (!messageInput.disabled) messageInput.focus();
}

async function selectCommunity(groupId, name) {
    try {
        activeCommunityId = groupId;
        
        const response = await fetch(`${API_URL}/api/communities/${groupId}/init`, {
            method: 'POST',
            headers: getHeaders()
        });
        
        const data = await response.json();
        
        if (response.ok) {
            const conversation = data.conversation;
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

    appendMessage({
        senderId: currentUser.id,
        content: content,
        createdAt: new Date().toISOString()
    });
    
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

// --- Accept / Reject Request Actions ---

document.getElementById('btn-accept').addEventListener('click', async () => {
    if (!activeConversationId) return;
    try {
        const response = await fetch(`${API_URL}/api/conversations/${activeConversationId}/accept`, {
            method: 'POST',
            headers: getHeaders()
        });
        const data = await response.json();
        if (response.ok) {
            // Update the status of the conversation locally
            const conv = conversations.find(c => c._id === activeConversationId);
            if (conv) conv.status = 'accepted';
            
            // Re-trigger selectConversation to refresh input state and fetch messages
            selectConversation(activeConversationId, chatWithName.textContent);
        } else {
            alert(data.message || 'Failed to accept conversation request.');
        }
    } catch (err) {
        console.error('Accept error:', err);
    }
});

document.getElementById('btn-reject').addEventListener('click', async () => {
    if (!activeConversationId) return;
    if (!confirm('Are you sure you want to reject this request? The sender will be blocked and this chat will be hidden.')) return;
    try {
        const response = await fetch(`${API_URL}/api/conversations/${activeConversationId}/reject`, {
            method: 'POST',
            headers: getHeaders()
        });
        const data = await response.json();
        if (response.ok) {
            // Remove the conversation locally
            conversations = conversations.filter(c => c._id !== activeConversationId);
            renderConversations();
            
            // Clear current chat view
            activeConversationId = null;
            activeChat.classList.add('hidden');
            noChatSelected.classList.remove('hidden');
        } else {
            alert(data.message || 'Failed to reject conversation request.');
        }
    } catch (err) {
        console.error('Reject error:', err);
    }
});

// Trigger initial app startup
initApp();
