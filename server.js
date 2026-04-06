const express = require('express');
const webPush = require('web-push');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
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

// Database setup
const db = new sqlite3.Database('./database.sqlite');
db.serialize(() => {
  db.run("CREATE TABLE IF NOT EXISTS subscriptions (endpoint TEXT PRIMARY KEY, keys TEXT)");
  db.run("CREATE TABLE IF NOT EXISTS status (date TEXT PRIMARY KEY, taken BOOLEAN)");
});

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
  
  db.run("INSERT OR REPLACE INTO subscriptions (endpoint, keys) VALUES (?, ?)",
    [subscription.endpoint, JSON.stringify(subscription.keys)],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.status(201).json({ message: 'Subscribed successfully.' });
    }
  );
});

app.post('/mark-taken', (req, res) => {
  const dateStr = getTodayStr();
  
  db.run("INSERT OR REPLACE INTO status (date, taken) VALUES (?, ?)", [dateStr, true], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.status(200).json({ message: 'Marked as taken for today.' });
  });
});

app.get('/test-push', (req, res) => {
  sendPushToAll("Test Push", "This is a test notification from your backend!");
  res.send("Pushes sent (check server logs).");
});

// Logic to send push
const sendPushToAll = (title, body) => {
  db.all("SELECT * FROM subscriptions", [], (err, rows) => {
    if (err) {
      console.error(err);
      return;
    }
    const payload = JSON.stringify({
      title: title,
      body: body,
      icon: '/daily-scoop/favicon.svg'
    });
    
    rows.forEach(row => {
      const sub = {
        endpoint: row.endpoint,
        keys: JSON.parse(row.keys)
      };
      webPush.sendNotification(sub, payload).catch(error => {
        console.error('Error sending push:', error);
        if (error.statusCode === 410 || error.statusCode === 404) {
          console.log('Subscription expired or invalid, deleting...', sub.endpoint);
          db.run("DELETE FROM subscriptions WHERE endpoint = ?", [sub.endpoint]);
        }
      });
    });
  });
};

// Cron Job: Run at exactly 5 PM every day
// Syntax: '0 17 * * *' -> 5:00 PM
cron.schedule('0 17 * * *', () => {
    const dateStr = getTodayStr();
    console.log(`Cron triggered at 5 PM for ${dateStr}. Checking status...`);
    
    db.get("SELECT taken FROM status WHERE date = ?", [dateStr], (err, row) => {
      if (err) {
        console.error("Database error in cron:", err);
        return;
      }
      if (!row || row.taken !== 1) {
        // Not taken today! Send push!
        console.log("Creatine NOT taken yet. Sending push notification.");
        sendPushToAll("Daily Scoop", "Did you take your creatine today? Open the app to mark it down!");
      } else {
        console.log("Creatine was taken. No push needed.");
      }
    });
}, {
    timezone: "America/New_York" // You might want this to be dynamic later
});

app.listen(port, () => {
  console.log(`Backend server running at http://localhost:${port}`);
  console.log('Serving VAPID public key at /vapidPublicKey');
});
