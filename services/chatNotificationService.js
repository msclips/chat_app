const admin = require('firebase-admin');
// Ensure firebase-admin is initialized in your main server file (e.g., server.js)
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
    try {
        if (!admin.apps.length) {
            console.error("❌ Firebase Admin SDK is NOT initialized.");
            return;
        }

        const messaging = admin.messaging();
        const title = "New Message";
        const description = `${senderName} sent you a message`;

        if (!userIds || userIds.length === 0) {
            console.log("No user IDs (with tokens) provided. Skipping chat notification send.");
            return { totalTokens: 0, successCount: 0, failureCount: 0, failedTokens: [] };
        }

        const messages = [];

        userIds.forEach(user => {
            const dataPayload = {
                type: "chat_message",
                ...convertObjectValuesToString(chatData)
            };

            // send to Android if token available
            if (user.android_token) {
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
            if (user.web_token) {
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

        // Break into batches of 500 (FCM max)
        const batchSize = 500;
        let totalSuccessCount = 0;
        let totalFailureCount = 0;
        const allFailedTokensDetails = [];

        for (let i = 0; i < messages.length; i += batchSize) {
            const batchMessages = messages.slice(i, i + batchSize);
            console.log(`Processing chat notification batch ${Math.floor(i / batchSize) + 1} with ${batchMessages.length} messages.`);
            
            try {
                const response = await messaging.sendEach(batchMessages);
                totalSuccessCount += response.successCount;
                totalFailureCount += response.failureCount;

                if (response.failureCount > 0) {
                    for (let index = 0; index < response.responses.length; index++) {
                        const resp = response.responses[index];

                        if (!resp.success) {
                            const failedMsg = batchMessages[index];
                            const originalUserIdEntry = userIds.find(u => u.android_token === failedMsg.token || u.web_token === failedMsg.token);

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
                                console.warn(`Removing invalid token from DB: ${failedMsg.token}`);
                                // Uncomment and integrate with your token service:
                                // await UserTokenService.removeOnlyThisToken(failedMsg.token);
                            }
                        }
                    }
                }
            } catch (err) {
                console.error(`Error sending chat batch:`, err);
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

        console.log(`--- Chat Notification Send Summary ---`);
        console.log(`Total successful sends: ${totalSuccessCount}`);
        console.log(`Total failed sends: ${totalFailureCount}`);

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

        try {
            // Uncomment and integrate with your notification history model:
            // await NotificationHistoryDAL.CreateBulkData(notificationRows);
        } catch (dbErr) {
            console.error("Error saving chat notification history:", dbErr);
        }

        return {
            totalTokens: userIds.length,
            successCount: totalSuccessCount,
            failureCount: totalFailureCount,
            failedTokens: allFailedTokensDetails
        };

    } catch (error) {
        console.error("Failed to send chat push notifications:", error);
        // We don't throw error to avoid breaking chat flow
    }
};

module.exports = {
    sendChatNotification
};
