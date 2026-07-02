const API_URL = window.location.origin;
let socket = null;
let currentUser = null;
let activeConversationId = null;
let activeCommunityId = null;
let conversations = [];
let communities = [];
let allUsers = [];
let replyingToMessage = null;
let editingMessageId = null;
let muteStates = {}; // { conversationId: muteUntil }

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

// Group Elements
const newGroupBtn = document.getElementById('new-group-btn');
const newGroupModal = document.getElementById('new-group-modal');
const closeGroupModalBtn = document.getElementById('close-group-modal');
const groupNameInput = document.getElementById('group-name-input');
const groupDescInput = document.getElementById('group-desc-input');
const groupUserSearchInput = document.getElementById('group-user-search-input');
const groupUsersListContainer = document.getElementById('group-users-list');
const createGroupSubmitBtn = document.getElementById('create-group-submit-btn');
const newGroupImageUpload = document.getElementById('new-group-image-upload');
const newGroupAvatarPreview = document.getElementById('new-group-avatar-preview');
let newGroupPhotoUrl = null;
let selectedGroupMembers = new Set();

const replyIndicator = document.getElementById('reply-indicator');
const replyToName = document.getElementById('reply-to-name');
const replyToText = document.getElementById('reply-to-text');
const cancelReplyBtn = document.getElementById('cancel-reply-btn');

const editIndicator = document.getElementById('edit-indicator');
const editToText = document.getElementById('edit-to-text');
const cancelEditBtn = document.getElementById('cancel-edit-btn');

// Poll Elements
const createPollBtn = document.getElementById('create-poll-btn');
const pollModal = document.getElementById('poll-modal');
const closePollModalBtn = document.getElementById('close-poll-modal');
const pollOptionsContainer = document.getElementById('poll-options-container');
const addPollOptionBtn = document.getElementById('add-poll-option-btn');
const submitPollBtn = document.getElementById('submit-poll-btn');
const pollQuestionInput = document.getElementById('poll-question');
const pollAllowMultiple = document.getElementById('poll-allow-multiple');
const pollShowVoters = document.getElementById('poll-show-voters');

// Mute Elements
const muteToggleBtn = document.getElementById('mute-toggle-btn');
const muteModal = document.getElementById('mute-modal');
const closeMuteModalBtn = document.getElementById('close-mute-modal');

function isMuted(conversationId) {
    const muteUntil = muteStates[conversationId];
    if (!muteUntil) return false;
    return new Date(muteUntil) > new Date();
}

function getMuteLabel(conversationId) {
    const muteUntil = muteStates[conversationId];
    if (!muteUntil) return '';
    const d = new Date(muteUntil);
    if (d.getFullYear() >= 9999) return 'Muted';
    const diff = d - new Date();
    if (diff <= 0) return '';
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    if (days <= 1) return 'Muted · 1d';
    if (days <= 7) return `Muted · ${days}d`;
    return 'Muted';
}

function cancelReply() {
    replyingToMessage = null;
    if (replyIndicator) replyIndicator.classList.add('hidden');
}

function cancelEdit() {
    editingMessageId = null;
    if (editIndicator) editIndicator.classList.add('hidden');
    if (!replyingToMessage) messageInput.value = '';
}

if (cancelReplyBtn) {
    cancelReplyBtn.addEventListener('click', cancelReply);
}

if (cancelEditBtn) {
    cancelEditBtn.addEventListener('click', cancelEdit);
}

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
            if (message._id) tempMsg.dataset.id = message._id;
        }
        updateConversationPreview(message);
    });

    socket.on('message:updated', (updatedMessage) => {
        if (updatedMessage.conversationId === activeConversationId) {
            const msgEl = document.querySelector(`.message[data-id="${updatedMessage._id}"]`);
            if (msgEl) {
                // For all updates, recreate and replace to handle content, edits, and reactions properly
                const nextSibling = msgEl.nextSibling;
                msgEl.remove();
                
                // Temporary flag to prevent auto scroll down if not at bottom
                const isAtBottom = messagesContainer.scrollHeight - messagesContainer.scrollTop <= messagesContainer.clientHeight + 50;
                
                appendMessage(updatedMessage);
                const newMsgEl = messagesContainer.lastElementChild;
                if (nextSibling) {
                    messagesContainer.insertBefore(newMsgEl, nextSibling);
                }
                
                if (isAtBottom) scrollToBottom();
            }
        }
        updateConversationPreview(updatedMessage);
    });

    socket.on('group:created', ({ group, conversationId }) => {
        fetchConversations();
    });

    socket.on('group:invitation_received', ({ group }) => {
        fetchConversations();
    });

    socket.on('group:member_joined', ({ groupId, userId, username }) => {
        fetchConversations();
    });

    socket.on('group:member_removed', ({ groupId, userId }) => {
        if (userId === currentUser.id) {
            alert('You have been removed from the group.');
            fetchConversations();
            if (activeConversationId) {
                activeChat.classList.add('hidden');
                noChatSelected.classList.remove('hidden');
            }
        }
    });

    socket.on('message:deleted', ({ messageId, deleteType, conversationId }) => {
        const msgEl = document.querySelector(`.message[data-id="${messageId}"]`);
        if (msgEl) {
            msgEl.remove();
        }
    });

    socket.on('conversation:mute_updated', ({ conversationId, muteUntil }) => {
        muteStates[conversationId] = muteUntil;
        renderConversations();
        renderCommunities();
        // Update header icon if this is the active chat
        if (conversationId === activeConversationId) {
            const muteBtn = document.getElementById('mute-toggle-btn');
            if (isMuted(conversationId)) {
                muteBtn.innerHTML = '<i class="ph ph-bell-slash"></i>';
                muteBtn.title = 'Unmute';
                muteBtn.classList.add('muted');
            } else {
                muteBtn.innerHTML = '<i class="ph ph-bell"></i>';
                muteBtn.title = 'Mute';
                muteBtn.classList.remove('muted');
            }
        }
    });

    socket.on('conversation:updated', ({ conversationId, lastMessage, incrementUnread, groupName, photoUrl }) => {
        const conv = conversations.find(c => c._id === conversationId);
        if (conv) {
            if (lastMessage !== undefined) {
                conv.lastMessage = lastMessage;
                if (lastMessage) {
                    conv.updatedAt = lastMessage.createdAt || new Date();
                    if (typeof updateConversationPreview === 'function') {
                        updateConversationPreview(lastMessage);
                    }
                }
            }
            if (groupName) {
                conv.groupName = groupName;
                if (activeConversationId === conversationId && chatWithName) {
                    chatWithName.textContent = groupName;
                }
            }
            if (photoUrl) {
                conv.photoUrl = photoUrl;
                if (activeConversationId === conversationId) {
                    const headerAvatar = document.getElementById('chat-avatar');
                    if (headerAvatar) {
                        headerAvatar.innerHTML = `<img src="${photoUrl}" alt="${conv.groupName || 'Group'}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`;
                    }
                }
            }
            
            if (incrementUnread && activeConversationId !== conversationId && lastMessage) {
                if (!conv.unreadCounts) conv.unreadCounts = {};
                conv.unreadCounts[currentUser.id.toString()] = (conv.unreadCounts[currentUser.id.toString()] || 0) + 1;
            } else if (activeConversationId === conversationId && lastMessage) {
                // Instantly emit read receipt if we are looking at the chat
                socket.emit('messages:read', { conversationId: conversationId, messageId: lastMessage._id });
            }

            // Move to top ONLY if there is a new message
            if (lastMessage) {
                conversations = conversations.filter(c => c._id !== conversationId);
                conversations.unshift(conv);
            }

            renderConversations();
        } else {
            // New conversation, fetch it
            fetchConversations();
        }
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

    // Group info real-time listeners (MUST be inside initSocket so socket exists)
    socket.on('group:updated', (data) => {
        console.log('📸 group:updated received:', data.groupId, 'photoUrl?', !!data.photoUrl);
        if (currentGroupInfo && currentGroupInfo.groupId === data.groupId) {
            currentGroupInfo.name = data.name;
            if (data.photoUrl) {
                currentGroupInfo.photoUrl = data.photoUrl;
                if (groupInfoAvatar) {
                    groupInfoAvatar.innerHTML = `<img src="${data.photoUrl}" alt="${data.name}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`;
                }
            }
            if (groupInfoName) groupInfoName.value = data.name;
            if (groupInfoAvatar && !data.photoUrl) groupInfoAvatar.textContent = data.name.charAt(0).toUpperCase();
            if (chatWithName) chatWithName.textContent = data.name;
        }
        
        // Find by groupId if it's there, or conversationId if provided
        const conv = conversations.find(c => c.groupId === data.groupId || c._id === data.conversationId);
        if (conv) {
            conv.groupName = data.name;
            if (data.photoUrl) {
                conv.photoUrl = data.photoUrl;
            }
            if (activeConversationId === conv._id && chatWithName) {
                chatWithName.textContent = data.name;
                if (data.photoUrl) {
                    const headerAvatar = document.getElementById('chat-avatar');
                    if (headerAvatar) {
                        headerAvatar.innerHTML = `<img src="${data.photoUrl}" alt="${data.name}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`;
                    }
                }
            }
            renderConversations();
        }
    });

    socket.on('group:member_updated', () => {
        if (activeConversationId) {
            // Re-fetch info silently
            fetch(`${API_URL}/api/conversations/${activeConversationId}/groupInfo`, { headers: getHeaders() })
                .then(res => res.json())
                .then(data => {
                    if (currentGroupInfo) {
                        currentGroupMembers = data.members;
                        if (!groupInfoModal.classList.contains('hidden')) {
                            renderGroupInfoMembers();
                            if (groupInfoCount) groupInfoCount.textContent = `${data.members.length} participants`;
                        }
                    }
                });
        }
    });
}

// --- Data Fetching ---

async function fetchConversations() {
    try {
        const response = await fetch(`${API_URL}/api/conversations`, {
            headers: getHeaders()
        });
        conversations = await response.json();
        
        conversations.forEach(conv => {
            const me = conv.participants.find(p => p.userId === currentUser.id);
            muteStates[conv._id] = me?.muteUntil || null;
        });

        renderConversations();
        
        if (!activeConversationId && conversations.length > 0) {
            const firstConv = conversations[0];
            let name = 'Group Chat';
            if (firstConv.type === 'private') {
                const otherParticipant = firstConv.participants.find(p => p.userId !== currentUser.id);
                name = otherParticipant ? otherParticipant.username : 'Deleted User';
            } else if (firstConv.type === 'group') {
                name = firstConv.groupName || 'Group Chat';
            } else if (firstConv.type === 'community') {
                name = firstConv.communityName || 'Community Chat';
            }
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
        let name = 'Group Chat';
        if (conv.type === 'private') {
            const otherParticipant = conv.participants.find(p => p.userId !== currentUser.id);
            name = otherParticipant ? otherParticipant.username : 'Deleted User';
        } else if (conv.type === 'group') {
            name = conv.groupName || 'Group Chat';
        } else if (conv.type === 'community') {
            name = conv.communityName || 'Community Chat';
        }

        let lastMsg = 'No messages yet';
        if (conv.lastMessage) {
            if (typeof conv.lastMessage === 'object') {
                if (conv.lastMessage.messageType === 'poll') {
                    lastMsg = 'Poll: ' + (conv.lastMessage.pollData ? conv.lastMessage.pollData.question : '');
                } else if (conv.lastMessage.messageType === 'image') {
                    lastMsg = '📷 Image';
                } else if (conv.lastMessage.messageType === 'file') {
                    lastMsg = '📄 File';
                } else if (conv.lastMessage.content) {
                    lastMsg = conv.lastMessage.content;
                } else {
                    lastMsg = 'New message...';
                }
            } else {
                lastMsg = 'New message...';
            }
        }
        
        const muteIcon = isMuted(conv._id) ? '<i class="ph ph-bell-slash mute-indicator" title="Muted"></i>' : '';

        const div = document.createElement('div');
        div.className = `conv-item ${conv._id === activeConversationId ? 'active' : ''}`;
        div.onclick = () => selectConversation(conv._id, name, conv.type === 'community');
        
        // Show pending or blocked tags
        let extraTags = '';
        if (conv.type === 'group' && conv.groupMemberStatus === 'pending') {
            extraTags += '<span style="color: #f59e0b; font-size: 10px; margin-left: 5px;">(Invite)</span>';
        }
        if (conv.status === 'blocked') {
            extraTags += '<span style="color: #ef4444; font-size: 10px; margin-left: 5px; font-weight: bold;">(Blocked)</span>';
        }

        const unreadCount = conv.unreadCounts ? (conv.unreadCounts[currentUser.id.toString()] || 0) : 0;
        const badgeHTML = unreadCount > 0 ? `<div style="background-color: #22c55e; color: white; font-size: 11px; font-weight: bold; border-radius: 50%; min-width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; padding: 0 6px;">${unreadCount}</div>` : '';

        let avatarHTML = `<div class="avatar">${name.charAt(0).toUpperCase()}</div>`;
        if (conv.photoUrl) {
            avatarHTML = `<div class="avatar"><img src="${conv.photoUrl}" alt="${name}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;"></div>`;
        } else if (conv.type === 'community') {
            avatarHTML = `<div class="avatar" style="background: linear-gradient(135deg, #f59e0b, #d97706)">${name.charAt(0).toUpperCase()}</div>`;
        }

        div.innerHTML = `
            ${avatarHTML}
            <div class="conv-info">
                <div class="conv-name-row">
                    <h4>${name}${extraTags}${muteIcon}</h4>
                    <span class="conv-time">${formatDate(conv.updatedAt)}</span>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <p class="conv-last-msg" id="last-msg-${conv._id}">${lastMsg}</p>
                    ${badgeHTML}
                </div>
            </div>
        `;
        conversationsContainer.appendChild(div);
    });
}

function renderGroupUsers(filter = '') {
    groupUsersListContainer.innerHTML = '';
    const filteredUsers = allUsers.filter(u => 
        u.id !== currentUser.id && u.user_name.toLowerCase().includes(filter.toLowerCase())
    );

    if (filteredUsers.length === 0) {
        groupUsersListContainer.innerHTML = '<p class="text-muted" style="text-align: center; padding: 20px;">No users found</p>';
        return;
    }

    filteredUsers.forEach(user => {
        const div = document.createElement('div');
        div.className = 'user-item';
        div.style.display = 'flex';
        div.style.justifyContent = 'space-between';
        div.style.alignItems = 'center';
        
        const isSelected = selectedGroupMembers.has(user.id);
        
        div.innerHTML = `
            <div style="display: flex; align-items: center; gap: 12px;">
                <div class="avatar">${user.user_name.charAt(0).toUpperCase()}</div>
                <div class="user-name">${user.user_name}</div>
            </div>
            <input type="checkbox" ${isSelected ? 'checked' : ''} style="cursor: pointer;">
        `;
        
        div.addEventListener('click', (e) => {
            if (e.target.tagName !== 'INPUT') {
                const cb = div.querySelector('input');
                cb.checked = !cb.checked;
            }
            if (div.querySelector('input').checked) {
                selectedGroupMembers.add(user.id);
            } else {
                selectedGroupMembers.delete(user.id);
            }
        });
        
        groupUsersListContainer.appendChild(div);
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
        
        // Use group_id as conversationId mapping for mute state? We need the actual conv id.
        // For communities, the communityId (groupId) might be mapped to convId after init, 
        // but for render list, we don't have conv id yet unless fetched. We can rely on `muteStates` if mapped.
        // In fetchCommunities, we only get groups. We will handle community mute icon differently if needed, 
        // or fetch conversations to get community conv ID. For now, communities are muted by default.
        const muteIcon = '<i class="ph ph-bell-slash mute-indicator" title="Muted"></i>';

        const div = document.createElement('div');
        div.className = `conv-item ${comm.group_id === activeCommunityId ? 'active' : ''}`;
        div.onclick = () => selectCommunity(comm.group_id, name);
        
        div.innerHTML = `
            <div class="avatar" style="background: linear-gradient(135deg, #f59e0b, #d97706)">${name.charAt(0).toUpperCase()}</div>
            <div class="conv-info">
                <div class="conv-name-row">
                    <h4>${name}${muteIcon}</h4>
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
    
    // Look up the conversation to get photoUrl
    const conv = conversations.find(c => c._id === id);
    const chatAvatarEl = document.getElementById('chat-avatar');
    
    if (conv && conv.photoUrl) {
        chatAvatarEl.innerHTML = `<img src="${conv.photoUrl}" alt="${name}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`;
        chatAvatarEl.style.background = '';
    } else {
        chatAvatarEl.innerHTML = name.charAt(0).toUpperCase();
        if (isCommunity) {
            chatAvatarEl.style.background = 'linear-gradient(135deg, #f59e0b, #d97706)';
        } else {
            chatAvatarEl.style.background = '';
        }
    }
    
    if (isCommunity) {
        document.querySelector('.status-text').textContent = 'Public Community';
    } else {
        document.querySelector('.status-text').textContent = 'Online';
    }

    const muteBtn = document.getElementById('mute-toggle-btn');
    if (isMuted(id) || (isCommunity && muteStates[id] === undefined)) {
        // If community and undefined, assume default muted unless fetched otherwise
        muteBtn.innerHTML = '<i class="ph ph-bell-slash"></i>';
        muteBtn.title = 'Unmute';
        muteBtn.classList.add('muted');
    } else {
        muteBtn.innerHTML = '<i class="ph ph-bell"></i>';
        muteBtn.title = 'Mute';
        muteBtn.classList.remove('muted');
    }

    noChatSelected.classList.add('hidden');
    activeChat.classList.remove('hidden');
    
    // Clear reply and edit state on chat switch
    cancelReply();
    cancelEdit();
    
    messagesContainer.innerHTML = '<div class="loading-messages">Loading history...</div>';
    fetchMessages(id);
    
    // Clear unread badge locally and tell server
    const activeConv = conversations.find(c => c._id === id);
    if (activeConv) {
        if (!activeConv.unreadCounts) activeConv.unreadCounts = {};
        if (activeConv.unreadCounts[currentUser.id.toString()] > 0) {
            activeConv.unreadCounts[currentUser.id.toString()] = 0;
            // Get the last message ID if available to mark as read
            const lastMsgId = (activeConv.lastMessage && activeConv.lastMessage._id) ? activeConv.lastMessage._id : null;
            socket.emit('messages:read', { conversationId: id, messageId: lastMsgId });
        }
    }
    
    // Manage Accept / Reject banners
    const requestBanner = document.getElementById('request-banner');
    const waitingBanner = document.getElementById('waiting-banner');
    
    requestBanner.classList.add('hidden');
    waitingBanner.classList.add('hidden');
    
    let isPendingRecipient = false;
    
    if (!isCommunity) {
        const activeConv = conversations.find(c => c._id === id);
        if (activeConv && activeConv.type === 'private' && activeConv.status === 'pending') {
            if (activeConv.initiatorId !== currentUser.id) {
                isPendingRecipient = true;
                document.getElementById('request-sender-name').textContent = name;
                requestBanner.classList.remove('hidden');
            } else {
                waitingBanner.classList.remove('hidden');
            }
        } else if (activeConv && activeConv.type === 'group' && activeConv.groupMemberStatus === 'pending') {
            isPendingRecipient = true;
            document.getElementById('request-sender-name').textContent = name + ' (Group Invite)';
            requestBanner.classList.remove('hidden');
        }
    }
    
    let isBlockedByMe = false;
    let isBlockedByThem = false;
    
    if (activeConv && activeConv.status === 'blocked') {
        if (activeConv.blockedBy === currentUser.id) {
            isBlockedByMe = true;
        } else {
            isBlockedByThem = true;
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
    } else if (isBlockedByMe) {
        messageInput.placeholder = "You blocked this user. Unblock to send messages.";
        messageInput.disabled = true;
        document.getElementById('send-btn').disabled = true;
        document.getElementById('send-btn').style.opacity = '0.5';
    } else if (isBlockedByThem) {
        messageInput.placeholder = "You are blocked from sending messages to this user.";
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
            activeConversationId = data.conversation._id;
            
            // Populate mute state for community conversation if not fetched yet
            const me = data.conversation.participants.find(p => p.userId === currentUser.id);
            muteStates[activeConversationId] = me?.muteUntil || null;

            selectConversation(data.conversation._id, name, true, data.isMember);
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
    if (message._id) div.dataset.id = message._id;
    
    const sName = message.senderName || (isSent ? currentUser.user_name : chatWithName.textContent);
    
    let replyHTML = '';
    if (message.replyTo) {
        replyHTML = `
            <div class="replied-message-block">
                <div class="replied-name">${escapeHTML(message.replyTo.senderName || 'User')}</div>
                <div class="replied-text">${escapeHTML(message.replyTo.content || '')}</div>
            </div>
        `;
    }
    
    let editedHTML = message.isEdited ? '<span class="edited-label"> (edited)</span>' : '';

    let contentHTML = '';
    if (message.messageType === 'poll' && message.pollData) {
        const { question, options, showVoters } = message.pollData;
        let totalVotes = 0;
        options.forEach(opt => totalVotes += opt.votes.length);

        let optionsHTML = '';
        options.forEach(opt => {
            const voteCount = opt.votes.length;
            const percentage = totalVotes > 0 ? Math.round((voteCount / totalVotes) * 100) : 0;
            const hasVoted = opt.votes.includes(currentUser.id);
            
            let votersHTML = '';
            if (showVoters && voteCount > 0) {
                const voterNames = opt.votes.map(vId => {
                    const u = allUsers.find(user => user.id === vId);
                    return u ? u.user_name : 'User ' + vId;
                });
                
                votersHTML = `
                <div class="poll-voters">
                    <div style="font-weight: 600; margin-bottom: 4px; color: var(--primary-light);">Voters:</div>
                    <ul style="margin: 0; padding-left: 16px; list-style: disc;">
                        ${voterNames.map(name => `<li>${escapeHTML(name)}</li>`).join('')}
                    </ul>
                </div>`;
            }

            optionsHTML += `
                <div class="poll-option ${hasVoted ? 'voted' : ''} ${showVoters && voteCount > 0 ? 'show-voters-btn' : ''}" data-option-id="${opt._id || opt.option}">
                    <div class="poll-option-bar" style="width: ${percentage}%"></div>
                    <div class="poll-option-content">
                        <span class="poll-option-text">${escapeHTML(opt.option)}</span>
                        <span class="poll-option-stats">${voteCount} (${percentage}%)</span>
                    </div>
                    ${votersHTML}
                </div>
            `;
        });

        contentHTML = `
            <div class="poll-container">
                <div class="poll-question">${escapeHTML(question)}</div>
                ${optionsHTML}
                <div class="poll-total-votes">${totalVotes} total votes</div>
            </div>
        `;
    } else {
        contentHTML = `<div class="message-content">${escapeHTML(message.content)}</div>`;
    }

    let reactionsHTML = '';
    if (message.reactions && Object.keys(message.reactions).length > 0) {
        const reactionCounts = {};
        let myReaction = null;
        for (const [uid, emoji] of Object.entries(message.reactions)) {
            if (uid === currentUser.id.toString()) myReaction = emoji;
            reactionCounts[emoji] = (reactionCounts[emoji] || 0) + 1;
        }
        
        const reactionsList = Object.entries(reactionCounts)
            .map(([emoji, count]) => `<span class="reaction-badge ${myReaction === emoji ? 'my-reaction' : ''}" data-emoji="${emoji}">${emoji} ${count > 1 ? count : ''}</span>`)
            .join('');
        reactionsHTML = `<div class="message-reactions">${reactionsList}</div>`;
    }

    div.innerHTML = `
        ${replyHTML}
        ${contentHTML}
        ${reactionsHTML}
        <div class="message-time">${formatTime(message.createdAt)}${editedHTML}</div>
        <div class="message-actions">
            <i class="ph ph-smiley react-btn" title="React"></i>
            <i class="ph ph-arrow-u-up-left reply-btn" title="Reply"></i>
            ${isSent && message.messageType !== 'poll' ? '<i class="ph ph-pencil-simple edit-btn" title="Edit"></i>' : ''}
            <i class="ph ph-trash delete-btn" title="Delete"></i>
        </div>
    `;

    const reactBtn = div.querySelector('.react-btn');
    if (reactBtn) {
        reactBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const msgId = message._id || div.dataset.id;
            if (msgId) {
                showReactionPicker(reactBtn, msgId);
            }
        });
    }

    const reactionBadges = div.querySelectorAll('.reaction-badge');
    reactionBadges.forEach(badge => {
        badge.addEventListener('click', (e) => {
            e.stopPropagation();
            const emoji = badge.getAttribute('data-emoji');
            const msgId = message._id || div.dataset.id;
            if (msgId) {
                const isMyReaction = badge.classList.contains('my-reaction');
                socket.emit('message:react', {
                    messageId: msgId,
                    emoji: isMyReaction ? '' : emoji
                });
            }
        });
    });

    if (message.messageType === 'poll') {
        const pollOptions = div.querySelectorAll('.poll-option');
        pollOptions.forEach(optDiv => {
            optDiv.addEventListener('click', () => {
                const optionId = optDiv.getAttribute('data-option-id');
                const msgId = message._id || div.dataset.id;
                if (!msgId) return;

                const isVoted = optDiv.classList.contains('voted');
                let newOptionIds = [];

                if (message.pollData.allowMultiple) {
                    // Collect all currently voted options
                    const allVoted = Array.from(div.querySelectorAll('.poll-option.voted'))
                        .map(el => el.getAttribute('data-option-id'));
                    
                    if (isVoted) {
                        newOptionIds = allVoted.filter(id => id !== optionId);
                    } else {
                        newOptionIds = [...allVoted, optionId];
                    }
                } else {
                    // Single choice: if clicking already voted, maybe we want to unvote? Or just switch.
                    // Let's allow unvoting if clicking the same, else switch.
                    if (isVoted) {
                        newOptionIds = [];
                    } else {
                        newOptionIds = [optionId];
                    }
                }

                socket.emit('message:poll_vote', {
                    messageId: msgId,
                    optionIds: newOptionIds
                });
            });
        });
    }
    
    const replyBtn = div.querySelector('.reply-btn');
    if (replyBtn) {
        replyBtn.addEventListener('click', () => {
            const msgId = message._id || div.dataset.id;
            if (msgId) {
                replyingToMessage = { _id: msgId, senderName: sName, content: message.content };
                replyToName.textContent = `Replying to ${sName}`;
                replyToText.textContent = message.content;
                if (replyIndicator) replyIndicator.classList.remove('hidden');
                cancelEdit();
                messageInput.focus();
            }
        });
    }

    const editBtn = div.querySelector('.edit-btn');
    if (editBtn) {
        editBtn.addEventListener('click', () => {
            const msgId = message._id || div.dataset.id;
            if (msgId) {
                const currentContentEl = div.querySelector('.message-content');
                const currentContent = currentContentEl ? currentContentEl.textContent : message.content;
                editingMessageId = msgId;
                editToText.textContent = currentContent;
                if (editIndicator) editIndicator.classList.remove('hidden');
                cancelReply();
                messageInput.value = currentContent;
                messageInput.focus();
            }
        });
    }

    const deleteBtn = div.querySelector('.delete-btn');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
            const msgId = message._id || div.dataset.id;
            if (!msgId) return;

            let deleteType = 1;
            if (isSent) {
                if (confirm("Delete this message for everyone? (OK = Everyone, Cancel = Only Me)")) {
                    deleteType = 2;
                } else {
                    if (!confirm("Delete for me only?")) {
                        return;
                    }
                }
            } else {
                if (!confirm("Are you sure you want to delete this message for yourself?")) {
                    return;
                }
            }

            socket.emit('message:delete', { messageId: msgId, deleteType });
            
            // Optimistically remove from UI
            div.remove();
        });
    }
    
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

    if (editingMessageId) {
        socket.emit('message:edit', { messageId: editingMessageId, content });
        messageInput.value = '';
        cancelEdit();
        return;
    }

    const tempId = Date.now().toString();
    const messageData = {
        conversationId: activeConversationId,
        content: content,
        messageType: 'text',
        tempId: tempId,
        replyTo: replyingToMessage ? replyingToMessage._id : null
    };

    appendMessage({
        senderId: currentUser.id,
        content: content,
        createdAt: new Date().toISOString(),
        replyTo: replyingToMessage ? {
            _id: replyingToMessage._id,
            senderName: replyingToMessage.senderName,
            content: replyingToMessage.content
        } : null
    });
    
    messagesContainer.lastElementChild.setAttribute('data-temp-id', tempId);
    messagesContainer.lastElementChild.classList.add('pending');

    socket.emit('message:send', messageData);
    messageInput.value = '';
    
    cancelReply();
    
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

// --- Group Modal Events ---
if (newGroupImageUpload) {
    newGroupImageUpload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        if (!file.type.startsWith('image/')) {
            alert('Please select a valid image file');
            return;
        }

        if (file.size > 5 * 1024 * 1024) {
            alert('Image size must be less than 5MB');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            newGroupPhotoUrl = e.target.result;
            if (newGroupAvatarPreview) {
                newGroupAvatarPreview.innerHTML = `<img src="${newGroupPhotoUrl}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`;
            }
        };
        reader.onerror = () => {
            alert('Failed to read image file');
        };
        reader.readAsDataURL(file);
    });
}

if (newGroupBtn) {
    newGroupBtn.addEventListener('click', () => {
        if (newGroupModal) newGroupModal.classList.remove('hidden');
        if (groupNameInput) groupNameInput.value = '';
        if (groupDescInput) groupDescInput.value = '';
        if (groupUserSearchInput) groupUserSearchInput.value = '';
        selectedGroupMembers.clear();
        newGroupPhotoUrl = null;
        if (newGroupAvatarPreview) {
            newGroupAvatarPreview.innerHTML = 'G';
        }
        if (newGroupImageUpload) {
            newGroupImageUpload.value = '';
        }
        renderGroupUsers();
        if (groupNameInput) groupNameInput.focus();
    });
}

if (closeGroupModalBtn) {
    closeGroupModalBtn.addEventListener('click', () => {
        newGroupModal.classList.add('hidden');
    });
}

if (groupUserSearchInput) {
    groupUserSearchInput.addEventListener('input', (e) => {
        renderGroupUsers(e.target.value);
    });
}

if (createGroupSubmitBtn) {
    createGroupSubmitBtn.addEventListener('click', () => {
        const name = groupNameInput.value.trim();
        if (!name) return alert('Group name is required.');
        
        socket.emit('group:create', {
            name,
            description: groupDescInput.value.trim(),
            photoUrl: newGroupPhotoUrl,
            initialMembers: Array.from(selectedGroupMembers)
        });
        
        newGroupModal.classList.add('hidden');
    });
}

// --- Poll Modal Events ---

let pollOptionCount = 0;

function createPollOptionInput() {
    pollOptionCount++;
    const wrapper = document.createElement('div');
    wrapper.className = 'poll-option-input-wrapper';
    wrapper.innerHTML = `
        <input type="text" class="poll-option-input" placeholder="Option ${pollOptionCount}">
        <button class="poll-remove-option"><i class="ph ph-trash"></i></button>
    `;
    wrapper.querySelector('.poll-remove-option').addEventListener('click', () => {
        if (pollOptionsContainer.children.length > 2) {
            wrapper.remove();
        } else {
            alert('A poll must have at least 2 options.');
        }
    });
    return wrapper;
}

function resetPollModal() {
    pollQuestionInput.value = '';
    pollAllowMultiple.checked = false;
    pollShowVoters.checked = false;
    pollOptionsContainer.innerHTML = '<label style="display: block; margin-bottom: 8px; font-weight: 500;">Options</label>';
    pollOptionCount = 0;
    pollOptionsContainer.appendChild(createPollOptionInput());
    pollOptionsContainer.appendChild(createPollOptionInput());
}

createPollBtn.addEventListener('click', () => {
    if (!activeConversationId) return;
    resetPollModal();
    pollModal.classList.remove('hidden');
});

if (closePollModalBtn) {
    closePollModalBtn.addEventListener('click', () => pollModal.classList.add('hidden'));
}

if (muteToggleBtn) {
    muteToggleBtn.addEventListener('click', () => {
        if (!activeConversationId) return;
        if (isMuted(activeConversationId) || (activeCommunityId && muteStates[activeConversationId] === undefined)) {
            // Unmute
            socket.emit('conversation:unmute', { conversationId: activeConversationId });
        } else {
            // Show modal
            muteModal.classList.remove('hidden');
        }
    });
}

if (closeMuteModalBtn) {
    closeMuteModalBtn.addEventListener('click', () => muteModal.classList.add('hidden'));
}

document.querySelectorAll('.mute-option-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const duration = btn.dataset.duration;
        socket.emit('conversation:mute', { conversationId: activeConversationId, duration });
        muteModal.classList.add('hidden');
    });
});

pollModal.addEventListener('click', (e) => {
    if (e.target === pollModal) {
        pollModal.classList.add('hidden');
    }
});

addPollOptionBtn.addEventListener('click', () => {
    pollOptionsContainer.appendChild(createPollOptionInput());
});

submitPollBtn.addEventListener('click', () => {
    const question = pollQuestionInput.value.trim();
    if (!question) return alert('Please enter a poll question.');

    const optionInputs = pollOptionsContainer.querySelectorAll('.poll-option-input');
    const options = [];
    optionInputs.forEach(input => {
        const val = input.value.trim();
        if (val) options.push({ option: val, votes: [] });
    });

    if (options.length < 2) return alert('Please provide at least 2 options.');

    const pollData = {
        question,
        options,
        allowMultiple: pollAllowMultiple.checked,
        showVoters: pollShowVoters.checked
    };

    const tempId = Date.now().toString();
    const messageData = {
        conversationId: activeConversationId,
        content: '',
        messageType: 'poll',
        pollData: pollData,
        tempId: tempId,
        replyTo: replyingToMessage ? replyingToMessage._id : null
    };

    appendMessage({
        senderId: currentUser.id,
        content: '',
        messageType: 'poll',
        pollData: pollData,
        createdAt: new Date().toISOString(),
        replyTo: replyingToMessage ? {
            _id: replyingToMessage._id,
            senderName: replyingToMessage.senderName,
            content: replyingToMessage.content
        } : null
    });
    
    messagesContainer.lastElementChild.setAttribute('data-temp-id', tempId);
    messagesContainer.lastElementChild.classList.add('pending');

    socket.emit('message:send', messageData);
    pollModal.classList.add('hidden');
    cancelReply();
    scrollToBottom();
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
    const conv = conversations.find(c => c._id === activeConversationId);
    
    if (conv && conv.type === 'group') {
        socket.emit('group:approve_request', { groupId: conv.groupId, status: 'approved' });
        conv.groupMemberStatus = 'approved';
        selectConversation(activeConversationId, chatWithName.textContent);
        return;
    }

    try {
        const response = await fetch(`${API_URL}/api/conversations/${activeConversationId}/accept`, {
            method: 'POST',
            headers: getHeaders()
        });
        const data = await response.json();
        if (response.ok) {
            // Update the status of the conversation locally
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
    const conv = conversations.find(c => c._id === activeConversationId);
    
    if (!confirm('Are you sure you want to reject this request? The sender will be blocked and this chat will be hidden.')) return;

    if (conv && conv.type === 'group') {
        socket.emit('group:approve_request', { groupId: conv.groupId, status: 'rejected' });
        conversations = conversations.filter(c => c._id !== activeConversationId);
        renderConversations();
        activeConversationId = null;
        activeChat.classList.add('hidden');
        noChatSelected.classList.remove('hidden');
        return;
    }

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

// --- Group Info Modal Logic ---
const groupInfoModal = document.getElementById('group-info-modal');
const closeGroupInfoModal = document.getElementById('close-group-info-modal');
const chatTitleHeader = document.getElementById('chat-title-header');
const groupInfoAvatar = document.getElementById('group-info-avatar');
const groupInfoName = document.getElementById('group-info-name');
const groupInfoCount = document.getElementById('group-info-count');
const groupAdminsList = document.getElementById('group-admins-list');
const groupParticipantsList = document.getElementById('group-participants-list');
const editGroupNameBtn = document.getElementById('edit-group-name-btn');
const exitGroupBtn = document.getElementById('exit-group-btn');
const addParticipantBtn = document.getElementById('add-participant-btn');
const groupInfoSearch = document.getElementById('group-info-search');

const addParticipantModal2 = document.getElementById('add-participant-modal');
const closeAddParticipantModal2 = document.getElementById('close-add-participant-modal');
const addParticipantSearch2 = document.getElementById('add-participant-search');
const addParticipantList2 = document.getElementById('add-participant-list');
const submitAddParticipantsBtn2 = document.getElementById('submit-add-participants-btn');

let currentGroupInfo = null;
let currentGroupMembers = [];

if (chatTitleHeader) {
    chatTitleHeader.addEventListener('click', async () => {
        if (!activeConversationId) return;
        
        const conv = conversations.find(c => c._id === activeConversationId);
        if (!conv) return;

        if (conv.type === 'private') {
            const chatInfoModal = document.getElementById('chat-info-modal');
            const otherParticipant = conv.participants.find(p => p.userId !== currentUser.id);
            const name = otherParticipant ? otherParticipant.username : 'Deleted User';
            
            document.getElementById('chat-info-name').textContent = name;
            
            const avatarEl = document.getElementById('chat-info-avatar');
            if (conv.photoUrl) {
                avatarEl.innerHTML = `<img src="${conv.photoUrl}" alt="${name}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`;
                avatarEl.style.background = '';
            } else {
                avatarEl.innerHTML = name.charAt(0).toUpperCase();
            }

            // Block/Unblock chat logic
            const blockBtn = document.getElementById('action-block-chat');
            const blockBtnText = document.getElementById('block-btn-text');
            const isBlockedByMe = conv.status === 'blocked' && conv.blockedBy === currentUser.id;
            
            if (isBlockedByMe) {
                blockBtnText.textContent = 'Unblock User';
                blockBtn.innerHTML = '<i class="ph ph-check-circle"></i> <span id="block-btn-text">Unblock User</span>';
                blockBtn.style.color = '#22c55e';
                blockBtn.style.borderColor = '#22c55e';
                blockBtn.style.background = 'rgba(34, 197, 94, 0.05)';
                
                blockBtn.onclick = async () => {
                    try {
                        const response = await fetch(`${API_URL}/api/conversations/${activeConversationId}/unblock`, {
                            method: 'POST',
                            headers: getHeaders()
                        });
                        const data = await response.json();
                        if (response.ok) {
                            alert('User unblocked successfully.');
                            conv.status = 'accepted';
                            conv.blockedBy = null;
                            renderConversations();
                            selectConversation(activeConversationId, name); // Refresh chat UI
                            chatInfoModal.classList.add('hidden');
                        } else {
                            alert(data.message || 'Failed to unblock user.');
                        }
                    } catch (err) {
                        console.error('Unblock error:', err);
                    }
                };
            } else {
                blockBtn.innerHTML = '<i class="ph ph-prohibit"></i> <span id="block-btn-text">Block User</span>';
                blockBtn.style.color = '#ef4444';
                blockBtn.style.borderColor = '#ef4444';
                blockBtn.style.background = 'rgba(239, 68, 68, 0.05)';
                
                blockBtn.onclick = async () => {
                    if (confirm('Are you sure you want to block this user?')) {
                        try {
                            const response = await fetch(`${API_URL}/api/conversations/${activeConversationId}/block`, {
                                method: 'POST',
                                headers: getHeaders()
                            });
                            const data = await response.json();
                            if (response.ok) {
                                alert('User blocked successfully.');
                                conv.status = 'blocked';
                                conv.blockedBy = currentUser.id;
                                renderConversations();
                                selectConversation(activeConversationId, name); // Refresh chat UI
                                chatInfoModal.classList.add('hidden');
                            } else {
                                alert(data.message || 'Failed to block user.');
                            }
                        } catch (err) {
                            console.error('Block error:', err);
                        }
                    }
                };
            }
            
            document.getElementById('action-delete-chat').onclick = () => {
                alert('Delete entire chat functionality is not yet implemented.');
            };

            chatInfoModal.classList.remove('hidden');
            return;
        }

        if (conv.type !== 'group' && conv.type !== 'community') return;

        try {
            const res = await fetch(`${API_URL}/api/conversations/${activeConversationId}/groupInfo`, {
                headers: getHeaders()
            });
            const data = await res.json();
            
            if (res.ok) {
                currentGroupInfo = data.group;
                currentGroupMembers = data.members;
                
                if (data.group.photoUrl) {
                    if (groupInfoAvatar) {
                        groupInfoAvatar.innerHTML = `<img src="${data.group.photoUrl}" alt="${data.group.name}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`;
                    }
                } else {
                    if (groupInfoAvatar) {
                        groupInfoAvatar.innerHTML = data.group.name.charAt(0).toUpperCase();
                    }
                }
                
                if (groupInfoName) groupInfoName.value = data.group.name;
                if (groupInfoCount) groupInfoCount.textContent = `${data.members.length} participants`;
                
                const myMembership = data.members.find(m => m.userId == currentUser.id);
                const isAdmin = myMembership && myMembership.role === 'admin';
                
                if (groupInfoName) groupInfoName.disabled = !isAdmin;
                if (editGroupNameBtn) editGroupNameBtn.style.display = isAdmin ? 'block' : 'none';
                if (addParticipantBtn) addParticipantBtn.style.display = isAdmin ? 'flex' : 'none';
                
                const editGroupImageBtn = document.getElementById('edit-group-image-btn');
                if (editGroupImageBtn) editGroupImageBtn.style.display = isAdmin ? 'flex' : 'none';
                
                if (data.group.isCommunity) {
                    if (editGroupNameBtn) editGroupNameBtn.style.display = 'none';
                    if (addParticipantBtn) addParticipantBtn.style.display = 'none';
                    if (editGroupImageBtn) editGroupImageBtn.style.display = 'none';
                }
                
                renderGroupInfoMembers();
                if (groupInfoModal) groupInfoModal.classList.remove('hidden');
            } else {
                alert(data.message || 'Error loading group info');
            }
        } catch (err) {
            console.error('Error fetching group info', err);
        }
    });
}

function renderGroupInfoMembers(filter = '') {
    if (!groupAdminsList || !groupParticipantsList) return;
    groupAdminsList.innerHTML = '';
    groupParticipantsList.innerHTML = '';
    
    const filteredMembers = currentGroupMembers.filter(m => m.username.toLowerCase().includes(filter.toLowerCase()));
    
    filteredMembers.forEach(member => {
        const div = document.createElement('div');
        div.className = 'user-item';
        div.style.display = 'flex';
        div.style.justifyContent = 'space-between';
        div.style.alignItems = 'center';
        
        let roleBadge = '';
        if (member.role === 'admin') {
            roleBadge = '<span style="font-size: 10px; background: rgba(59, 130, 246, 0.1); color: #3b82f6; padding: 2px 6px; border-radius: 4px; font-weight: 600;">Admin</span>';
        } else if (member.role === 'member') {
            roleBadge = '<span style="font-size: 10px; background: rgba(107, 114, 128, 0.1); color: var(--text-muted); padding: 2px 6px; border-radius: 4px;">User</span>';
        }
        
        let removeBtn = '';
        const myMembership = currentGroupMembers.find(m => m.userId == currentUser.id);
        const isAdmin = myMembership && myMembership.role === 'admin';
        
        div.innerHTML = `
            <div style="display: flex; align-items: center; gap: 12px; width: 100%;">
                <div class="avatar">${member.username.charAt(0).toUpperCase()}</div>
                <div style="flex: 1; display:flex; align-items:center; justify-content:space-between;">
                    <div class="user-name" style="display:flex; align-items:center; gap:8px;">
                        ${member.username} ${member.userId == currentUser.id ? '(You)' : ''}
                        ${roleBadge}
                        ${member.status === 'blocked' ? '<span style="font-size: 10px; background: rgba(239, 68, 68, 0.1); color: #ef4444; padding: 2px 6px; border-radius: 4px;">Blocked</span>' : ''}
                    </div>
                    ${isAdmin && member.userId != currentUser.id && !currentGroupInfo.isCommunity ? '<i class="ph ph-dots-three-vertical" style="color:var(--text-muted);"></i>' : ''}
                </div>
            </div>
        `;
        
        if (isAdmin && member.userId != currentUser.id && !currentGroupInfo.isCommunity) {
             div.style.cursor = 'pointer';
             div.addEventListener('click', () => {
                 if (typeof openMemberActionModal === 'function') {
                     openMemberActionModal(member);
                 }
             });
        }
        
        if (member.role === 'admin') {
            groupAdminsList.appendChild(div);
        } else {
            groupParticipantsList.appendChild(div);
        }
    });
}

if (groupInfoSearch) {
    groupInfoSearch.addEventListener('input', (e) => {
        renderGroupInfoMembers(e.target.value);
    });
}

if (closeGroupInfoModal) {
    closeGroupInfoModal.addEventListener('click', () => {
        groupInfoModal.classList.add('hidden');
    });
}

const closeChatInfoModal = document.getElementById('close-chat-info-modal');
if (closeChatInfoModal) {
    closeChatInfoModal.addEventListener('click', () => {
        const chatInfoModal = document.getElementById('chat-info-modal');
        if (chatInfoModal) chatInfoModal.classList.add('hidden');
    });
}

const editGroupNameModal = document.getElementById('edit-group-name-modal');
const closeEditGroupNameModal = document.getElementById('close-edit-group-name-modal');
const editGroupNameInput = document.getElementById('edit-group-name-input');
const submitEditGroupNameBtn = document.getElementById('submit-edit-group-name-btn');

if (editGroupNameBtn) {
    editGroupNameBtn.addEventListener('click', () => {
        if (!currentGroupInfo || currentGroupInfo.isCommunity) return;
        if (editGroupNameModal) {
            editGroupNameModal.classList.remove('hidden');
            editGroupNameInput.value = currentGroupInfo.name;
            editGroupNameInput.focus();
        }
    });
}

if (closeEditGroupNameModal) {
    closeEditGroupNameModal.addEventListener('click', () => {
        if (editGroupNameModal) editGroupNameModal.classList.add('hidden');
    });
}

if (submitEditGroupNameBtn) {
    submitEditGroupNameBtn.addEventListener('click', () => {
        if (!currentGroupInfo || currentGroupInfo.isCommunity) return;
        const newName = editGroupNameInput.value.trim();
        if (newName && newName !== currentGroupInfo.name) {
            if (socket) socket.emit('group:edit', { groupId: currentGroupInfo.groupId, name: newName });
            
            // Optimistic update
            currentGroupInfo.name = newName;
            if (groupInfoName) groupInfoName.value = newName;
            if (chatWithName) chatWithName.textContent = newName;
            const conv = conversations.find(c => c._id === activeConversationId);
            if (conv) conv.groupName = newName;
            renderConversations();
        }
        if (editGroupNameModal) editGroupNameModal.classList.add('hidden');
    });
}


if (exitGroupBtn) {
    exitGroupBtn.addEventListener('click', () => {
        if (!currentGroupInfo) return;
        if (confirm('Are you sure you want to exit this group?')) {
            if (currentGroupInfo.isCommunity) {
                alert('Cannot exit community from here yet.');
            } else {
                if (socket) socket.emit('group:leave', { groupId: currentGroupInfo.groupId });
            }
            if (groupInfoModal) groupInfoModal.classList.add('hidden');
            if (activeChat) activeChat.classList.add('hidden');
            if (noChatSelected) noChatSelected.classList.remove('hidden');
            activeConversationId = null;
        }
    });
}

const groupImageUpload = document.getElementById('group-image-upload');
if (groupImageUpload) {
    groupImageUpload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            alert('Please select a valid image file');
            return;
        }

        if (file.size > 5 * 1024 * 1024) {
            alert('Image size must be less than 5MB');
            return;
        }

        if (groupInfoAvatar) {
            groupInfoAvatar.innerHTML = '<i class="ph ph-spinner pulse" style="font-size: 24px; color: var(--primary-color);"></i>';
        }

        const reader = new FileReader();
        reader.onload = (event) => {
            const base64Image = event.target.result;
            if (socket && currentGroupInfo) {
                socket.emit('group:editImage', { 
                    groupId: currentGroupInfo.groupId, 
                    base64Image 
                });
            }
        };
        reader.onerror = () => {
            alert('Failed to read image file');
            if (groupInfoAvatar && currentGroupInfo) {
                if (currentGroupInfo.photoUrl) {
                    groupInfoAvatar.innerHTML = `<img src="${currentGroupInfo.photoUrl}" alt="${currentGroupInfo.name}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`;
                } else {
                    groupInfoAvatar.textContent = currentGroupInfo.name.charAt(0).toUpperCase();
                }
            }
        };
        reader.readAsDataURL(file);
    });
}

// Add participants logic
let groupAddCandidates2 = new Set();

if (addParticipantBtn) {
    addParticipantBtn.addEventListener('click', () => {
        if (addParticipantModal2) addParticipantModal2.classList.remove('hidden');
        if (addParticipantSearch2) addParticipantSearch2.value = '';
        groupAddCandidates2.clear();
        renderAddParticipantList2();
    });
}

if (closeAddParticipantModal2) {
    closeAddParticipantModal2.addEventListener('click', () => {
        if (addParticipantModal2) addParticipantModal2.classList.add('hidden');
    });
}

function renderAddParticipantList2(filter = '') {
    if (!addParticipantList2) return;
    addParticipantList2.innerHTML = '';
    const filteredUsers = allUsers.filter(u => 
        u.id != currentUser.id && 
        u.user_name.toLowerCase().includes(filter.toLowerCase()) &&
        !currentGroupMembers.some(m => m.userId == u.id)
    );

    if (filteredUsers.length === 0) {
        addParticipantList2.innerHTML = '<p class="text-muted" style="text-align: center; padding: 20px;">No users found</p>';
        return;
    }

    filteredUsers.forEach(user => {
        const div = document.createElement('div');
        div.className = 'user-item';
        div.style.display = 'flex';
        div.style.justifyContent = 'space-between';
        div.style.alignItems = 'center';
        
        const isSelected = groupAddCandidates2.has(user.id);
        
        div.innerHTML = `
            <div style="display: flex; align-items: center; gap: 12px;">
                <div class="avatar">${user.user_name.charAt(0).toUpperCase()}</div>
                <div class="user-name">${user.user_name}</div>
            </div>
            <input type="checkbox" ${isSelected ? 'checked' : ''} style="cursor: pointer;">
        `;
        
        div.addEventListener('click', (e) => {
            if (e.target.tagName !== 'INPUT') {
                const cb = div.querySelector('input');
                cb.checked = !cb.checked;
            }
            if (div.querySelector('input').checked) {
                groupAddCandidates2.add(user.id);
            } else {
                groupAddCandidates2.delete(user.id);
            }
        });
        
        addParticipantList2.appendChild(div);
    });
}

if (addParticipantSearch2) {
    addParticipantSearch2.addEventListener('input', (e) => {
        renderAddParticipantList2(e.target.value);
    });
}

if (submitAddParticipantsBtn2) {
    submitAddParticipantsBtn2.addEventListener('click', () => {
        if (groupAddCandidates2.size > 0 && currentGroupInfo) {
            if (socket) {
                socket.emit('group:admin_add_members', {
                    groupId: currentGroupInfo.groupId,
                    userIds: Array.from(groupAddCandidates2)
                });
            }
            if (addParticipantModal2) addParticipantModal2.classList.add('hidden');
            if (groupInfoModal) groupInfoModal.classList.add('hidden');
            alert('Invitations sent to added members.');
        }
    });
}

// group:updated and group:member_updated listeners are now registered inside initSocket()

// Member Action Modal Logic
const memberActionModal = document.getElementById('member-action-modal');
const closeMemberActionModal = document.getElementById('close-member-action-modal');
const memberActionName = document.getElementById('member-action-name');
const actionMakeAdmin = document.getElementById('action-make-admin');
const actionBlockMember = document.getElementById('action-block-member');
const actionRemoveMember = document.getElementById('action-remove-member');
let currentActionMember = null;

function openMemberActionModal(member) {
    currentActionMember = member;
    if (memberActionName) memberActionName.textContent = `Manage ${member.username}`;
    
    if (actionMakeAdmin) actionMakeAdmin.style.display = member.role === 'admin' ? 'none' : 'flex';
    if (actionBlockMember) actionBlockMember.style.display = member.status === 'blocked' ? 'none' : 'flex';

    if (memberActionModal) memberActionModal.classList.remove('hidden');
}

if (closeMemberActionModal) {
    closeMemberActionModal.addEventListener('click', () => {
        memberActionModal.classList.add('hidden');
    });
}

if (actionMakeAdmin) {
    actionMakeAdmin.addEventListener('click', () => {
        if (currentActionMember && currentGroupInfo) {
            if (socket) socket.emit('group:admin_make_admin', { groupId: currentGroupInfo.groupId, targetUserId: currentActionMember.userId });
            memberActionModal.classList.add('hidden');
        }
    });
}

if (actionBlockMember) {
    actionBlockMember.addEventListener('click', () => {
        if (currentActionMember && currentGroupInfo) {
            if(confirm(`Block ${currentActionMember.username} from the group?`)) {
                if (socket) socket.emit('group:admin_block_member', { groupId: currentGroupInfo.groupId, targetUserId: currentActionMember.userId });
                memberActionModal.classList.add('hidden');
            }
        }
    });
}

if (actionRemoveMember) {
    actionRemoveMember.addEventListener('click', () => {
        if (currentActionMember && currentGroupInfo) {
            if(confirm(`Remove ${currentActionMember.username} from the group?`)) {
                if (socket) socket.emit('group:admin_remove_member', { groupId: currentGroupInfo.groupId, targetUserId: currentActionMember.userId });
                memberActionModal.classList.add('hidden');
            }
        }
    });
}

// Trigger initial app startup
initApp();
function showReactionPicker(btnElement, msgId) {
    const existing = document.getElementById('reaction-picker');
    if (existing) existing.remove();

    const picker = document.createElement('div');
    picker.id = 'reaction-picker';
    picker.className = 'reaction-picker';
    const emojis = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
    
    emojis.forEach(emoji => {
        const span = document.createElement('span');
        span.textContent = emoji;
        span.onclick = () => {
            socket.emit('message:react', { messageId: msgId, emoji });
            picker.remove();
        };
        picker.appendChild(span);
    });

    document.body.appendChild(picker);

    const rect = btnElement.getBoundingClientRect();
    picker.style.position = 'absolute';
    picker.style.left = `${Math.max(10, rect.left - 80)}px`;
    picker.style.top = `${rect.top - 50}px`;

    setTimeout(() => {
        document.addEventListener('click', function closePicker(e) {
            if (!picker.contains(e.target)) {
                picker.remove();
                document.removeEventListener('click', closePicker);
            }
        });
    }, 10);
}
