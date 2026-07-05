const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const Message = require('../models/Message');

const isProduction = process.env.NODE_ENV === 'production';
if (isProduction) {
    console.log("Firebase initialized in PRODUCTION mode");
} else {
    console.log("Firebase initialized in DEVELOPMENT mode");
}

const filePath = {
    dev: '../middleware/external_documents/firebase/karmas.firebase.json',
    prod: '../middleware/external_documents/firebase/karmas.live.firebase.json'
};

const serviceAccountPath = isProduction ?
    path.resolve(__dirname, filePath.prod) :
    path.resolve(__dirname, filePath.dev);

try {
    const serviceAccountRaw = fs.readFileSync(serviceAccountPath, 'utf-8');
    const serviceAccount = JSON.parse(serviceAccountRaw);
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log("✅ Firebase Admin SDK is initialized and ready.");
    }
} catch (err) {
    console.log("⚠️  Could not load Firebase service account key from", serviceAccountPath);
}

// Assuming UserTokenService and NotificationHistoryDAL are imported here or available globally based on your architecture.
// If they are in a different path, please adjust the require paths.
// const UserTokenService = require('./UserTokenService');
// const NotificationHistoryDAL = require('./NotificationHistoryDAL');

const chunkArray = (array, size) => {
    const chunked = [];
    for (let i = 0; i < array.length; i += size) {
        chunked.push(array.slice(i, i + size));
    }
    return chunked;
};

const convertObjectValuesToString = (obj) => {
    const stringifiedObj = {};
    for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
            stringifiedObj[key] = String(obj[key]);
        }
    }
    return stringifiedObj;
};

/**
 * Format the unread messages for a specific user into a WhatsApp-style notification body.
 */
const buildUnreadNotificationBody = (unreadMessages, chatType, senderName, currentMessage) => {
    try {
        if (!unreadMessages || unreadMessages.length === 0) {
            const msgType = currentMessage?.msg_type || currentMessage?.messageType || 'text';
            if (msgType !== 'text') return '📷 Photo' || `${senderName} sent an attachment`;
            return currentMessage?.message_content || `${senderName} sent you a message`;
        }

        const lines = unreadMessages.reverse().map(m => {
            const content = m.content && m.content.trim() !== '' ? m.content : null;
            if (!content) return null;
            const isGroup = chatType === 'group' || chatType === 'community';
            return isGroup ? `${m.senderName || senderName}: ${content}` : content;
        }).filter(Boolean);

        return lines.join('\n') || `${senderName} sent you a message`;
    } catch (err) {
        console.error('[NOTIFICATION] Error building unread body:', err.message);
        return currentMessage?.message_content || `${senderName} sent you a message`;
    }
};

/**
 * Service to send chat push notifications
 * @param {Object} params
 * @param {Array}  params.userIds          - Array of { user_id, android_token, web_token }
 * @param {String} params.senderName       - Sender display name
 * @param {Object} params.chatData         - Payload (chat_id, message_id, sender_id, ...)
 * @param {String} params.conversationName - Display name for the notification title (group name etc.)
 */
const sendChatNotification = async ({
    userIds,
    senderName,
    chatData,
    conversationName
}) => {
    console.log("[NOTIFICATION] Function Started: sendChatNotification");
    
    try {
        if (!admin.apps.length) {
            console.error("[NOTIFICATION] ❌ Firebase Admin SDK is NOT initialized.");
            return;
        }

        const messaging = admin.messaging();
        const chatType = chatData?.chat_type || 'direct';
        const conversationId = chatData?.chat_id || '';

        // Title: group/community shows group name, direct shows sender name
        const isGroupChat = chatType === 'group' || chatType === 'community';
        const title = (isGroupChat && conversationName) ? conversationName : (senderName || 'New Message');

        // Fetch recent messages ONCE for the conversation to find unread ones per user
        let recentMessages = [];
        let conversationDb = null;
        let groupMemberships = [];
        let communityMemberships = [];

        if (conversationId) {
             recentMessages = await Message.find({ conversationId })
                .sort({ createdAt: -1 })
                .limit(10) // Fetch up to 10 recent messages
                .lean();

             conversationDb = await require('../models/Conversation').findById(conversationId).lean();
             
             if (chatType === 'group' && conversationDb?.groupId) {
                 groupMemberships = await require('../models/GroupMember').find({ groupId: conversationDb.groupId }).lean();
             } else if (chatType === 'community' && conversationDb?.communityId) {
                 communityMemberships = await require('../models/GroupUser').findAll({ where: { group_id: conversationDb.communityId } });
             }
        }



        if (!userIds || userIds.length === 0) {
            console.log("[NOTIFICATION] No user IDs (with tokens) provided. Skipping chat notification send.");
            return { totalTokens: 0, successCount: 0, failureCount: 0, failedTokens: [] };
        }

        const messages = [];
        const uniqueTokens = new Set();
        let androidTokensCount = 0;
        let webTokensCount = 0;

        userIds.forEach(user => {
            // Determine this user's read threshold
            let unreadForUser = [];
            
            if (recentMessages.length > 0) {
                let lastReadTime = null;

                if (chatType === 'private' && conversationDb) {
                    const participant = conversationDb.participants?.find(p => String(p.userId) === String(user.user_id));
                    if (participant && participant.lastRead) lastReadTime = new Date(participant.lastRead);
                } else if (chatType === 'group') {
                    const member = groupMemberships.find(m => String(m.userId) === String(user.user_id));
                    if (member && member.lastReadMessageId) {
                        const readMsg = recentMessages.find(m => String(m._id) === String(member.lastReadMessageId));
                        if (readMsg) lastReadTime = new Date(readMsg.createdAt);
                    }
                } else if (chatType === 'community') {
                    const member = communityMemberships.find(m => String(m.user_id) === String(user.user_id));
                    if (member && member.last_seen_at) lastReadTime = new Date(member.last_seen_at);
                }

                // Filter messages created after the user's lastReadTime
                // (Also exclude messages sent by the user themselves)
                unreadForUser = recentMessages.filter(m => {
                    if (String(m.senderId) === String(user.user_id)) return false;
                    if (!lastReadTime) return true; // If no read record, assume all are unread
                    return new Date(m.createdAt) > lastReadTime;
                });
            }

            // Build the body string containing only their unread messages
            const description = buildUnreadNotificationBody(unreadForUser, chatType, senderName, chatData);
            user.computed_description = description;

            const dataPayload = {
                type: "chat_message",
                sender_name: senderName || '',
                action_reply: 'true',
                action_mark_read: 'true',
                ...convertObjectValuesToString(chatData)
            };

            // Android: tag groups notifications per conversation
            const androidConfig = conversationId ? {
                notification: {
                    tag: conversationId,
                    channelId: 'high_importance_channel',
                },
            } : undefined;

            // iOS: thread-id groups notifications per conversation
            const apnsConfig = conversationId ? {
                payload: {
                    aps: { 
                        'thread-id': conversationId,
                        category: 'MESSAGE_ACTIONS' // Allows iOS client to map to local action buttons
                    },
                },
            } : undefined;



            // send to Android if token available
            if (user.android_token && !uniqueTokens.has(user.android_token)) {
                uniqueTokens.add(user.android_token);
                androidTokensCount++;
                const notifObj = { title, body: description };
                
                messages.push({
                    token: user.android_token,
                    notification: notifObj,
                    data: dataPayload,
                    ...(androidConfig ? { android: androidConfig } : {}),
                    ...(apnsConfig ? { apns: apnsConfig } : {}),
                });
            }

            // send to Web if token available
            if (user.web_token && !uniqueTokens.has(user.web_token)) {
                uniqueTokens.add(user.web_token);
                webTokensCount++;
                const notifObj = { title, body: description };
                
                messages.push({
                    token: user.web_token,
                    notification: notifObj,
                    data: dataPayload,
                });
            }
        });

        console.log(`[NOTIFICATION] Total Android Tokens Count: ${androidTokensCount}`);
        console.log(`[NOTIFICATION] Total Web Tokens Count: ${webTokensCount}`);
        console.log(`[NOTIFICATION] Generated Messages Array Count: ${messages.length}`);

        // Break into batches of 500 (FCM max)
        const batchSize = 500;
        let totalSuccessCount = 0;
        let totalFailureCount = 0;
        const allFailedTokensDetails = [];

        console.log("[NOTIFICATION] Batch Processing Start");

        for (let i = 0; i < messages.length; i += batchSize) {
            const batchMessages = messages.slice(i, i + batchSize);
            const batchNo = Math.floor(i / batchSize) + 1;
            console.log(`[NOTIFICATION] Batch Number: ${batchNo}`);
            console.log(`[NOTIFICATION] Batch Message Count: ${batchMessages.length}`);

            try {
                console.log(`[NOTIFICATION] Firebase Send Request Start (Batch ${batchNo})`);
                const response = await messaging.sendEach(batchMessages);
                console.log(`[NOTIFICATION] Firebase Send Response (Batch ${batchNo}):`, JSON.stringify(response, null, 2));

                totalSuccessCount += response.successCount;
                totalFailureCount += response.failureCount;

                console.log(`[NOTIFICATION] Success Count (Batch ${batchNo}): ${response.successCount}`);
                console.log(`[NOTIFICATION] Failure Count (Batch ${batchNo}): ${response.failureCount}`);

                if (response.failureCount > 0) {
                    for (let index = 0; index < response.responses.length; index++) {
                        const resp = response.responses[index];

                        console.log(`[NOTIFICATION] Individual Token Processing: ${batchMessages[index].token}`);
                        if (!resp.success) {
                            const failedMsg = batchMessages[index];
                            const originalUserIdEntry = userIds.find(u => u.android_token === failedMsg.token || u.web_token === failedMsg.token);

                            console.log(`[NOTIFICATION] Individual Token Failure Reason: ${resp.error?.message} (Code: ${resp.error?.code})`);

                            allFailedTokensDetails.push({
                                token: failedMsg.token,
                                user_id: originalUserIdEntry ? originalUserIdEntry.user_id : 'unknown',
                                error: resp.error?.message,
                                errorCode: resp.error?.code
                            });

                            // Invalid token → remove only that specific token
                            if ([
                                'messaging/invalid-registration-token',
                                'messaging/not-found',
                                'messaging/registration-token-not-registered'
                            ].includes(resp.error?.code)) {
                                console.warn(`[NOTIFICATION] Invalid Token Detection: ${failedMsg.token}`);
                                console.log(`[NOTIFICATION] Token Cleanup Operation / Invalid Token Removal from Database Start`);
                                // Uncomment and integrate with your token service:
                                // await UserTokenService.removeOnlyThisToken(failedMsg.token);
                                console.log(`[NOTIFICATION] Token Cleanup Operation / Invalid Token Removal from Database Complete`);
                            }
                        }
                    }
                }
            } catch (err) {
                console.error(`[NOTIFICATION] Error Sending Chat Batch:`, err);
                console.error(`[NOTIFICATION] Complete Error Stack Trace:`, err.stack);
                batchMessages.forEach(msg => {
                    const originalUserIdEntry = userIds.find(u => u.android_token === msg.token || u.web_token === msg.token);
                    allFailedTokensDetails.push({
                        token: msg.token,
                        user_id: originalUserIdEntry ? originalUserIdEntry.user_id : 'unknown',
                        error: err.message,
                        errorCode: 'batch-send-error'
                    });
                });
                totalFailureCount += batchMessages.length;
            }
        }

        console.log(`[NOTIFICATION] --- Chat Notification Send Summary ---`);
        console.log(`[NOTIFICATION] Total Successful Sends: ${totalSuccessCount}`);
        console.log(`[NOTIFICATION] Total Failed Sends: ${totalFailureCount}`);

        console.log(`[NOTIFICATION] Notification History Data Creation Start`);
        // Notification History Setup (Adapt NotificationHistoryDAL call based on your exact implementation)
        const notificationRows = userIds.map(user => ({
            user_id: user.user_id ?? null,
            notification_title: title,
            notification_details: user.computed_description || 'New message',
            notification_type: 'chat_message',
            image_object: JSON.stringify(chatData),
            is_viewed: 0,
            is_active: 1,
            created_at: new Date(),
        }));
        console.log(`[NOTIFICATION] Notification History Data Creation Complete`);

        try {
            console.log(`[NOTIFICATION] Notification History Insert Start`);
            // Uncomment and integrate with your notification history model:
            // await NotificationHistoryDAL.CreateBulkData(notificationRows);
            console.log(`[NOTIFICATION] Notification History Insert Response: (mocked/commented out)`);
            console.log(`[NOTIFICATION] Notification History Insert Complete`);
        } catch (dbErr) {
            console.error("[NOTIFICATION] Error saving chat notification history:", dbErr);
            console.error("[NOTIFICATION] Complete Error Stack Trace:", dbErr.stack);
        }

        const finalResponse = {
            totalTokens: userIds.length,
            successCount: totalSuccessCount,
            failureCount: totalFailureCount,
            failedTokens: allFailedTokensDetails
        };

        console.log(`[NOTIFICATION] Final Response Object:`, finalResponse);
        console.log(`[NOTIFICATION] Function Completed: sendChatNotification`);

        return finalResponse;

    } catch (error) {
        console.error("[NOTIFICATION] Failed to send chat push notifications:", error);
        console.error("[NOTIFICATION] Complete Error Stack Trace:", error.stack);
        // We don't throw error to avoid breaking chat flow
    }
};

module.exports = {
    sendChatNotification
};
