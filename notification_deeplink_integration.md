# Push Notification Deep Linking Integration Guide

This document outlines the payload structure of chat push notifications sent by the backend and provides integration examples for the mobile app to handle deep linking. When a user clicks on a push notification, the app should automatically open the specific chat conversation.

## 1. FCM Notification Payload

When the backend sends a chat push notification, it includes extra metadata inside the `data` object. The mobile developer must extract these values when handling the notification click.

### Example Payload
```json
{
  "notification": {
    "title": "John Doe",
    "body": "Hey, how are you?"
  },
  "data": {
    "type": "chat_message",
    "chat_id": "64abcdef1234567890",
    "chat_type": "private", 
    "group_id": "",         
    "message_id": "987xyz...",
    "sender_id": "101"
  }
}
```

### Data Fields Breakdown
- **`type`**: Always `"chat_message"` for chat notifications. Use this to differentiate from other types of notifications (like system alerts).
- **`chat_id`**: The unique MongoDB `_id` of the `Conversation`. **(Required for navigation)**
- **`chat_type`**: The type of the conversation. Possible values: `"private"`, `"group"`, `"community"`.
- **`group_id`**: The MySQL ID of the group/community. This is empty for `"private"` chats.
- **`sender_id`**: The user ID of the person who sent the message.

---

## 2. React Native / Expo Integration Examples

To handle push notification interactions seamlessly, you must handle two application states:
1. **Background**: The app is running in the background.
2. **Quit/Killed**: The app was completely closed by the user.

### A. Handling Background Notifications
Use the `onNotificationOpenedApp` listener to trigger navigation when the user clicks a notification while the app is in the background.

```javascript
import messaging from '@react-native-firebase/messaging';
import { useNavigation } from '@react-navigation/native';

export function NotificationHandler() {
  const navigation = useNavigation();

  useEffect(() => {
    // Triggered when app is opened from the background
    const unsubscribe = messaging().onNotificationOpenedApp(remoteMessage => {
      console.log('App opened from BACKGROUND by notification:', remoteMessage.data);
      
      handleNotificationNavigation(remoteMessage.data);
    });

    return unsubscribe;
  }, []);

  const handleNotificationNavigation = (data) => {
    if (data && data.type === 'chat_message') {
      const chatId = data.chat_id;
      const chatType = data.chat_type;
      
      // Navigate to your Chat Screen passing the conversation details
      navigation.navigate('ChatScreen', {
        conversationId: chatId,
        type: chatType,
      });
    }
  };

  return null;
}
```

### B. Handling Quit/Killed State Notifications
Use `getInitialNotification` when the app starts up to check if it was launched as a result of a notification click.

```javascript
import messaging from '@react-native-firebase/messaging';
import { useEffect } from 'react';

export function AppInitialization() {
  useEffect(() => {
    // Triggered if the app was completely closed and opened via notification
    messaging()
      .getInitialNotification()
      .then(remoteMessage => {
        if (remoteMessage) {
          console.log('App opened from QUIT state by notification:', remoteMessage.data);
          
          if (remoteMessage.data && remoteMessage.data.type === 'chat_message') {
            const chatId = remoteMessage.data.chat_id;
            const chatType = remoteMessage.data.chat_type;
            
            // Note: Since the app just started, ensure your Navigation Container 
            // is fully mounted before attempting to navigate. 
            // You can use a timeout or a navigation ref.
            setTimeout(() => {
               // Replace `navigate` with your global navigation ref if needed
               // navigationRef.current?.navigate('ChatScreen', { ... })
            }, 500);
          }
        }
      });
  }, []);

  return null;
}
```

## 3. Flutter Integration Overview (If applicable)

If you are using Flutter (`firebase_messaging`), the logic is very similar:

```dart
// 1. App is in the background
FirebaseMessaging.onMessageOpenedApp.listen((RemoteMessage message) {
  if (message.data['type'] == 'chat_message') {
    String chatId = message.data['chat_id'];
    String chatType = message.data['chat_type'];
    
    // Use Navigator to push the chat route
    Navigator.pushNamed(context, '/chat', arguments: {
      'conversationId': chatId,
      'type': chatType,
    });
  }
});

// 2. App was terminated/killed
RemoteMessage? initialMessage = await FirebaseMessaging.instance.getInitialMessage();
if (initialMessage != null && initialMessage.data['type'] == 'chat_message') {
    // Navigate similarly after your runApp() initializes the router
}
```
