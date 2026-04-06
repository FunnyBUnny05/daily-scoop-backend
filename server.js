const express = require('express');
const webPush = require('web-push');
const cors = require('cors');
const cron = require('node-cron');

const app = express();
const port = process.env.PORT || 3001;

// Middlewares
app.use(cors());
app.use(express.json());

// VAPID keys setup
const publicVapidKey = 'BOvVmTl1KIRUC3upnnvkxOfrULKixcxV3UKLgA59yogkU7Po84lAT1gga_74eBMpa09UuqvRaFh5KXG1saEAfKU';
const privateVapidKey = 'o0_HJzV5m2iMdirkLHv9YxcQlHrkgz-XeLa8xRcZsoM';

webPush.setVapidDetails(
  'mailto:test@example.com',
  publicVapidKey,
  privateVapidKey
);

// In-memory database (no native binaries needed!)
const store = {
  subscriptions: {},  // keyed by endpoint
  status: {}          // keyed by date string
};

const getTodayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Routes
app.get('/vapidPublicKey', (req, res) => {
  res.send(publicVapidKey);
});

app.post('/subscribe', (req, res) => {
  const subscription = req.body;
  store.subscriptions[subscription.endpoint] = subscription.keys;
  console.log('New subscription registered. Total:', Object.keys(store.subscriptions).length);
  res.status(201).json({ message: 'Subscribed successfully.' });
});

app.post('/mark-taken', (req, res) => {
  const dateStr = getTodayStr();
  store.status[dateStr] = true;
  console.log(`Marked as taken for ${dateStr}`);
  res.status(200).json({ message: 'Marked as taken for today.' });
});

app.get('/test-push', (req, res) => {
  sendPushToAll("Test Push", "This is a test notification from your cloud backend!");
  res.send("Pushes sent (check server logs).");
});

app.get('/', (req, res) => {
  res.json({ status: 'Daily Scoop Backend is running!', subscriptions: Object.keys(store.subscriptions).length });
});

// Logic to send push
const sendPushToAll = (title, body) => {
  const payload = JSON.stringify({
    title: title,
    body: body,
    icon: '/daily-scoop/favicon.svg'
  });
  
  const endpoints = Object.keys(store.subscriptions);
  console.log(`Sending push to ${endpoints.length} subscriber(s)...`);
  
  endpoints.forEach(endpoint => {
    const sub = {
      endpoint: endpoint,
      keys: store.subscriptions[endpoint]
    };
    webPush.sendNotification(sub, payload).catch(error => {
      console.error('Error sending push:', error.statusCode || error.message);
      if (error.statusCode === 410 || error.statusCode === 404) {
        console.log('Subscription expired, removing:', endpoint);
        delete store.subscriptions[endpoint];
      }
    });
  });
};

// Cron Job: Run at exactly 5 PM Israel time every day
cron.schedule('0 14 * * *', () => {
    const dateStr = getTodayStr();
    console.log(`Cron triggered for ${dateStr}. Checking status...`);
    
    if (!store.status[dateStr]) {
      console.log("Creatine NOT taken yet. Sending push notification.");
      sendPushToAll("Daily Scoop 🥄", "Did you take your creatine today? Open the app to mark it down!");
    } else {
      console.log("Creatine was taken. No push needed.");
    }
}, {
    timezone: "Asia/Jerusalem"
});

app.listen(port, () => {
  console.log(`Backend server running on port ${port}`);
  console.log('Serving VAPID public key at /vapidPublicKey');
});
