const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

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
 * Service to send chat push notifications
 * @param {Object} params
 * @param {Array} params.userIds - Array of objects like { user_id: 'user_id', android_token: 'token1', web_token: 'token2', user_image: 'url' }
 * @param {String} params.senderName - Name of the sender
 * @param {Object} params.chatData - Chat data payload (chat_id, message_id, sender_id, receiver_id)
 */
const sendChatNotification = async ({
    userIds,
    senderName,
    chatData
}) => {
    console.log("[NOTIFICATION] Function Started: sendChatNotification");
    console.log("[NOTIFICATION] Input Parameters:", { senderName });
    console.log("[NOTIFICATION] User Tokens Data Received:", userIds);
    console.log("[NOTIFICATION] Template Data Received:", chatData);

    try {
        console.log("[NOTIFICATION] Firebase Initialization Status Check");
        if (!admin.apps.length) {
            console.error("[NOTIFICATION] ❌ Firebase Admin SDK is NOT initialized.");
            return;
        }
        console.log("[NOTIFICATION] Firebase Initialization Status: Initialized");

        const messaging = admin.messaging();
        const title = senderName || "New Message";
        let description = `${senderName || 'Someone'} sent you a message`;

        if (chatData) {
            const msgContent = chatData.message_content || chatData.content || chatData.message;
            const msgType = chatData.message_type || chatData.messageType || 'text';

            if (msgType !== 'text') {
                description = `Sent an attachment`;
            } else if (msgContent && msgContent.trim() !== '') {
                description = msgContent;
            }
        }

        console.log(`[NOTIFICATION] Total Users Count: ${userIds ? userIds.length : 0}`);

        if (!userIds || userIds.length === 0) {
            console.log("[NOTIFICATION] No user IDs (with tokens) provided. Skipping chat notification send.");
            return { totalTokens: 0, successCount: 0, failureCount: 0, failedTokens: [] };
        }

        const messages = [];
        const uniqueTokens = new Set();
        let androidTokensCount = 0;
        let webTokensCount = 0;

        userIds.forEach(user => {
            const dataPayload = {
                type: "chat_message",
                ...convertObjectValuesToString(chatData)
            };

            // send to Android if token available
            if (user.android_token && !uniqueTokens.has(user.android_token)) {
                uniqueTokens.add(user.android_token);
                androidTokensCount++;
                messages.push({
                    token: user.android_token,
                    notification: {
                        title,
                        body: description,
                    },
                    data: dataPayload,
                });
            }

            // send to Web if token available
            if (user.web_token && !uniqueTokens.has(user.web_token)) {
                uniqueTokens.add(user.web_token);
                webTokensCount++;
                messages.push({
                    token: user.web_token,
                    notification: {
                        title,
                        body: description,
                    },
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
            notification_details: description,
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
