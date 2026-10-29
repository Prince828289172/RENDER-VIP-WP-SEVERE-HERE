import express from 'express';
import fs from 'fs';
import chalk from 'chalk';
import multer from 'multer';
import makeWASocket, {
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  DisconnectReason,
  Browsers,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import pino from 'pino';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { Boom } from '@hapi/boom';
import cors from 'cors';
import archiver from 'archiver';
import AdmZip from 'adm-zip';
import QRCode from 'qrcode';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 5000;
const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

const VOLUME_ROOT = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(process.cwd(), 'session');
const SESSION_DIR = VOLUME_ROOT.endsWith('session') ? VOLUME_ROOT : path.join(VOLUME_ROOT, 'session');
const SESSION_FILE = path.join(SESSION_DIR, 'running_sessions.json');

console.log(chalk.cyan(`📁 Session dir: ${SESSION_DIR}`));
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads', { recursive: true });

try {
  console.log(chalk.cyan("SESSION CONTENTS:", fs.readdirSync(SESSION_DIR)));
} catch (e) {}

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Prince890';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_BACKUP_REPO;
const GITHUB_BACKUP_FILE = 'session_backup.zip';

async function downloadBackupFromGitHub() {
  if (!GITHUB_TOKEN || !GITHUB_REPO) return;
  try {
    console.log(chalk.cyan('📥 Checking for backup on GitHub...'));
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_BACKUP_FILE}`, {
      headers: { Authorization: `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3.raw' }
    });
    if (res.ok) {
      const buffer = await res.arrayBuffer();
      fs.writeFileSync('./temp_backup.zip', Buffer.from(buffer));
      const zip = new AdmZip('./temp_backup.zip');
      zip.extractAllTo(SESSION_DIR, true);
      fs.unlinkSync('./temp_backup.zip');
      console.log(chalk.green('✅ Backup restored from GitHub!'));
    } else {
      console.log(chalk.yellow('⚠️ No backup found on GitHub (Fresh Start).'));
    }
  } catch (e) { console.error(chalk.red('Download error:'), e.message); }
}

async function uploadBackupToGitHub() {
  if (!GITHUB_TOKEN || !GITHUB_REPO) return;
  if (!fs.existsSync(SESSION_DIR) || fs.readdirSync(SESSION_DIR).length === 0) return;

  try {
    const archive = archiver('zip');
    const chunks = [];
    archive.on('data', chunk => chunks.push(chunk));
    archive.on('end', async () => {
      const buffer = Buffer.concat(chunks);
      const base64Content = buffer.toString('base64');

      let sha = null;
      const getRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_BACKUP_FILE}`, {
        headers: { Authorization: `token ${GITHUB_TOKEN}` }
      });
      if (getRes.ok) {
        const data = await getRes.json();
        sha = data.sha;
      }

      const body = { message: 'Auto-backup WhatsApp session', content: base64Content, ...(sha && { sha }) };
      const putRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_BACKUP_FILE}`, {
        method: 'PUT',
        headers: { Authorization: `token ${GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (putRes.ok) console.log(chalk.green('☁️ Session auto-backed up to GitHub!'));
    });
    archive.directory(SESSION_DIR, false);
    archive.finalize();
  } catch (e) { console.error(chalk.red('Upload error:'), e.message); }
}

const royalHeroesSessions = {};
const royalStopFlags = {};
const royalActiveSockets = {};
const royalMessageQueues = {};
const royalReconnectAttempts = {};
const royalConnectionStates = {};
const royalQRCodes = {}; 
const royalActiveConnections = new Set(); 

const RoyalSessionState = { INIT: 'INIT', PAIRED: 'PAIRED', CONNECTED: 'CONNECTED', RECONNECTING: 'RECONNECTING', STOPPED: 'STOPPED' };

const cleanupOldSessions = () => {
  try {
    if (!fs.existsSync(SESSION_DIR)) return;
    const activeKeys = Object.keys(royalHeroesSessions);
    if (activeKeys.length === 0) return;
    const dirs = fs.readdirSync(SESSION_DIR).filter(d => {
        try { return fs.statSync(path.join(SESSION_DIR, d)).isDirectory(); } catch { return false; }
      }).map(d => ({ name: d, path: path.join(SESSION_DIR, d), mtime: fs.statSync(path.join(SESSION_DIR, d)).mtimeMs })).sort((a, b) => b.mtime - a.mtime);
    let deleted = 0;
    dirs.forEach(d => {
      if (!activeKeys.includes(d.name)) { try { fs.rmSync(d.path, { recursive: true, force: true }); deleted++; } catch (e) {} }
    });
    if (deleted > 0) console.log(chalk.yellow(`🧹 Cleaned ${deleted} old session folder(s)`));
  } catch (error) {}
};

const royalSaveSessions = () => {
  try {
    const sessionsToSave = {};
    for (const key in royalHeroesSessions) { const { restartTimer, ...sessionData } = royalHeroesSessions[key]; sessionsToSave[key] = sessionData; }
    fs.writeFileSync(SESSION_FILE, JSON.stringify(sessionsToSave, null, 2), 'utf8');
  } catch (error) {}
};

const royalGenerateUniqueKey = () => crypto.randomBytes(16).toString('hex');

const royalStartMessaging = (RoyalKing, uniqueKey, target, hatersName, messages, speed) => {
  if (royalStopFlags[uniqueKey]?.timeout) clearTimeout(royalStopFlags[uniqueKey].timeout);
  delete royalMessageQueues[uniqueKey];
  royalMessageQueues[uniqueKey] = { messages: [...messages], currentIndex: 0, isSending: false, lastSentAt: Date.now() };
  const queue = royalMessageQueues[uniqueKey];

  const royalSendNextMessage = async () => {
    if (royalStopFlags[uniqueKey]?.stopped || royalConnectionStates[uniqueKey] === RoyalSessionState.STOPPED) {
      if (royalStopFlags[uniqueKey]?.timeout) clearTimeout(royalStopFlags[uniqueKey].timeout);
      delete royalMessageQueues[uniqueKey];
      return;
    }
    if (!royalActiveSockets[uniqueKey] || royalConnectionStates[uniqueKey] !== RoyalSessionState.CONNECTED) return;
    if (queue.isSending) return;
    queue.isSending = true;

    const chatId = target.includes('@g.us') ? target : `${target}@s.whatsapp.net`;
    const formattedMessage = `${hatersName} ${queue.messages[queue.currentIndex]}`;

    try {
      await Promise.race([
        RoyalKing.sendMessage(chatId, { text: formattedMessage }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Send timeout')), 30000))
      ]);
      console.log(chalk.green(`✉️ [${queue.currentIndex + 1}/${queue.messages.length}] Sent: ${formattedMessage.substring(0, 50)}...`));
      queue.lastSentAt = Date.now();
      queue.currentIndex++;
      if (queue.currentIndex >= queue.messages.length) { queue.currentIndex = 0; }
    } catch (err) { console.error(chalk.red(`❌ Send error: ${err.message}`)); } 
    finally { queue.isSending = false; }
  };

  const baseInterval = (parseInt(speed) || 5) * 1000;
  const royalIntervalFunc = async () => {
    await royalSendNextMessage();
    if (!royalStopFlags[uniqueKey]?.stopped) royalStopFlags[uniqueKey].timeout = setTimeout(royalIntervalFunc, baseInterval);
  };
  royalStopFlags[uniqueKey] = { stopped: false, timeout: setTimeout(royalIntervalFunc, baseInterval) };
  console.log(chalk.cyan(`📨 Messaging started for ${uniqueKey.substring(0, 8)}`));
};

const royalConnectAndLogin = async (phoneNumber, uniqueKey, sendCallback = null) => {
  if (royalActiveConnections.has(uniqueKey)) {
    console.log(chalk.yellow(`⚠️ Lock already active for ${uniqueKey.substring(0,8)}.`));
    return;
  }
  royalActiveConnections.add(uniqueKey);

  const sessionPath = path.join(SESSION_DIR, uniqueKey);
  if (!royalConnectionStates[uniqueKey]) royalConnectionStates[uniqueKey] = RoyalSessionState.INIT;

  const royalStartConnection = async () => {
    if (royalConnectionStates[uniqueKey] === RoyalSessionState.CONNECTED && royalActiveSockets[uniqueKey]) {
      royalActiveConnections.delete(uniqueKey);
      return;
    }

    try {
      console.log(chalk.magenta(`🚀 [${royalConnectionStates[uniqueKey]}] Connecting: ${phoneNumber}`));
      if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath, { recursive: true });

      const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
      
      let version;
      try {
        const vRes = await fetchLatestBaileysVersion();
        version = vRes.version;
      } catch (e) {
        console.log(chalk.yellow(`⚠️ fetchLatestBaileysVersion failed, using default.`));
      }

      if (royalActiveSockets[uniqueKey]) {
        try { royalActiveSockets[uniqueKey].ev.removeAllListeners(); royalActiveSockets[uniqueKey].end(); delete royalActiveSockets[uniqueKey]; } catch (e) {}
      }

      const RoyalKing = makeWASocket({
        version, 
        logger: pino({ level: 'fatal' }), 
        browser: Browsers.ubuntu('Chrome'),
        auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' })) },
        printQRInTerminal: true, 
        markOnlineOnConnect: true,
        connectTimeoutMs: 120000,
        keepAliveIntervalMs: 15000,
        getMessage: async () => undefined,
        syncFullHistory: false,
        generateHighQualityLinkPreview: false
      });

      royalActiveSockets[uniqueKey] = RoyalKing;

      RoyalKing.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;

        console.log("CONNECTION UPDATE:", {
          connection,
          hasQR: Boolean(qr),
          statusCode: lastDisconnect?.error?.output?.statusCode,
          error: lastDisconnect?.error?.message
        });

        if (qr) {
          try {
            royalQRCodes[uniqueKey] = await QRCode.toDataURL(qr, { errorCorrectionLevel: 'M', margin: 2, width: 300 });
            console.log(chalk.cyan(`📱 QR generated for ${uniqueKey.substring(0, 8)}`));
          } catch (error) { console.error(chalk.red(`QR generation error: ${error.message}`)); }
        }

        if (connection === "open") {
          console.log(chalk.green(`\n✅ WhatsApp Connected! (${phoneNumber}) ✅\n`));
          delete royalQRCodes[uniqueKey];
          royalConnectionStates[uniqueKey] = RoyalSessionState.CONNECTED;
          royalReconnectAttempts[uniqueKey] = 0;
          royalActiveConnections.delete(uniqueKey); 

          royalHeroesSessions[uniqueKey] = { ...royalHeroesSessions[uniqueKey], phoneNumber, uniqueKey, connected: true, lastUpdateTimestamp: Date.now() };
          royalSaveSessions();

          if (sendCallback) sendCallback(null, true);
          if (royalHeroesSessions[uniqueKey]?.messaging && royalHeroesSessions[uniqueKey]?.messages) {
            royalStartMessaging(RoyalKing, uniqueKey, royalHeroesSessions[uniqueKey].target, royalHeroesSessions[uniqueKey].hatersName, royalHeroesSessions[uniqueKey].messages, royalHeroesSessions[uniqueKey].speed);
          }
        }

        if (connection === "close") {
          royalActiveConnections.delete(uniqueKey); 
          const statusCode = (lastDisconnect?.error instanceof Boom) ? lastDisconnect.error.output.statusCode : 0;
          if (royalMessageQueues[uniqueKey]) royalMessageQueues[uniqueKey].isSending = false;
          
          if (statusCode === DisconnectReason.restartRequired || statusCode === 515) {
            royalConnectionStates[uniqueKey] = RoyalSessionState.RECONNECTING;
            delete royalActiveSockets[uniqueKey];
            setTimeout(() => royalStartConnection(), 1000);
            return;
          }

          let shouldReconnect = true;
          if (statusCode === DisconnectReason.loggedOut) { if (!fs.existsSync(path.join(sessionPath, 'creds.json'))) shouldReconnect = false; }

          if (shouldReconnect && royalConnectionStates[uniqueKey] !== RoyalSessionState.STOPPED) {
            royalConnectionStates[uniqueKey] = RoyalSessionState.RECONNECTING;
            delete royalActiveSockets[uniqueKey];
            const attempts = royalReconnectAttempts[uniqueKey] || 1;
            const delay = Math.min(2000 * attempts, 30000);
            royalReconnectAttempts[uniqueKey] = attempts + 1;
            setTimeout(() => royalStartConnection(), delay);
          }
        }
      });

      RoyalKing.ev.on('creds.update', async () => { await saveCreds(); uploadBackupToGitHub(); });

    } catch (error) {
      royalActiveConnections.delete(uniqueKey);
      console.error(chalk.red(`❌ Connection Error: ${error.message}`));
      if (royalConnectionStates[uniqueKey] !== RoyalSessionState.STOPPED) setTimeout(() => royalStartConnection(), 5000);
    }
  };
  await royalStartConnection();
};

const royalRestoreSessions = async () => {
  if (fs.existsSync(SESSION_FILE)) {
    try {
      const data = fs.readFileSync(SESSION_FILE, 'utf8');
      Object.assign(royalHeroesSessions, JSON.parse(data));
      const restorePromises = [];
      for (const [key, session] of Object.entries(royalHeroesSessions)) {
        if (session.phoneNumber && session.uniqueKey) {
          console.log(chalk.cyan(`🔄 Restoring: ${session.phoneNumber}`));
          restorePromises.push(royalConnectAndLogin(session.phoneNumber, session.uniqueKey, null));
        }
      }
      await Promise.all(restorePromises);
    } catch (err) {}
  }
};

app.post('/login', async (req, res) => {
  try {
    let { phoneNumber } = req.body;
    if (!phoneNumber) return res.status(400).json({ success: false, message: 'Phone number required!' });
    phoneNumber = phoneNumber.replace(/[^0-9]/g, '');
    const uniqueKey = royalGenerateUniqueKey();
    royalConnectAndLogin(phoneNumber, uniqueKey, null).catch(() => {});
    res.json({ success: true, message: 'Waiting for QR', uniqueKey });
  } catch (error) { if (!res.headersSent) res.status(500).json({ success: false, message: error.message }); }
});

app.get('/qr/:uniqueKey', (req, res) => {
  const { uniqueKey } = req.params;
  if (!/^[a-f0-9]{32}$/i.test(uniqueKey)) return res.status(400).json({ success: false, message: 'Invalid key' });
  const qr = royalQRCodes[uniqueKey];
  const isConnected = royalConnectionStates[uniqueKey] === RoyalSessionState.CONNECTED;
  if (isConnected) res.json({ success: true, connected: true });
  else if (qr) res.json({ success: true, qr });
  else res.json({ success: true, qr: null, message: 'Waiting...' });
});

app.post('/getGroupUID', async (req, res) => {
  try {
    const { uniqueKey } = req.body;
    if (!uniqueKey || !royalActiveSockets[uniqueKey]) return res.status(400).json({ success: false, message: 'Invalid' });
    const groups = await royalActiveSockets[uniqueKey].groupFetchAllParticipating();
    res.json({ success: true, groupUIDs: Object.values(groups).map(g => ({ groupName: g.subject, groupId: g.id })) });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

app.post('/startMessaging', upload.single('messageFile'), async (req, res) => {
  try {
    const { uniqueKey, target, hatersName, speed } = req.body;
    const filePath = req.file?.path;
    if (!uniqueKey || !target || !royalActiveSockets[uniqueKey] || !filePath) {
      if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return res.status(400).json({ success: false, message: 'Missing fields' });
    }
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const messages = fileContent.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    fs.unlinkSync(filePath);
    if (messages.length === 0) return res.status(400).json({ success: false, message: 'Empty file' });

    royalHeroesSessions[uniqueKey] = { ...royalHeroesSessions[uniqueKey], target, hatersName, messages, speed, messaging: true };
    royalSaveSessions();
    royalStartMessaging(royalActiveSockets[uniqueKey], uniqueKey, target, hatersName, messages, speed);
    res.json({ success: true, message: 'Started', messageCount: messages.length });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

app.post('/stop', async (req, res) => {
  const { uniqueKey } = req.body;
  if (!uniqueKey || !royalHeroesSessions[uniqueKey]) return res.status(400).json({ success: false, message: 'Invalid' });
  royalConnectionStates[uniqueKey] = RoyalSessionState.STOPPED;
  if (royalStopFlags[uniqueKey]?.timeout) clearTimeout(royalStopFlags[uniqueKey].timeout);
  if (royalActiveSockets[uniqueKey]) { try { await royalActiveSockets[uniqueKey].logout(); } catch (e) {} delete royalActiveSockets[uniqueKey]; }
  const sessionPath = path.join(SESSION_DIR, uniqueKey);
  if (fs.existsSync(sessionPath)) { try { fs.rmSync(sessionPath, { recursive: true, force: true }); } catch (e) {} }
  delete royalHeroesSessions[uniqueKey]; delete royalStopFlags[uniqueKey]; delete royalMessageQueues[uniqueKey]; delete royalReconnectAttempts[uniqueKey]; delete royalConnectionStates[uniqueKey]; delete royalQRCodes[uniqueKey];
  royalSaveSessions();
  res.json({ success: true, message: 'Stopped' });
});

app.post('/admin/sessions', (req, res) => {
  if (req.body.password !== ADMIN_PASSWORD) return res.status(401).json({ success: false, message: 'Galat password!' });
  res.json({ success: true, sessions: Object.entries(royalHeroesSessions).map(([key, s]) => ({
    uniqueKey: key, phoneNumber: s.phoneNumber || 'Unknown', connected: royalConnectionStates[key] === RoyalSessionState.CONNECTED,
    state: royalConnectionStates[key] || 'UNKNOWN', messaging: !!s.messaging, target: s.target || null,
    speed: s.speed || null, messagesCount: s.messages?.length || 0, lastUpdate: s.lastUpdateTimestamp || null, hasSocket: !!royalActiveSockets[key]
  })) });
});

app.post('/admin/reconnect', async (req, res) => {
  if (req.body.password !== ADMIN_PASSWORD) return res.status(401).json({ success: false });
  const session = royalHeroesSessions[req.body.uniqueKey];
  if (!session) return res.status(400).json({ success: false });
  royalConnectionStates[req.body.uniqueKey] = RoyalSessionState.RECONNECTING;
  if (royalActiveSockets[req.body.uniqueKey]) { try { royalActiveSockets[req.body.uniqueKey].end(); } catch (e) {} delete royalActiveSockets[req.body.uniqueKey]; }
  royalConnectAndLogin(session.phoneNumber, req.body.uniqueKey, null).catch(() => {});
  res.json({ success: true, message: 'Reconnecting...' });
});

app.get('/health', (req, res) => res.json({ status: 'alive', sessions: Object.keys(royalHeroesSessions).length }));

app.get("/", (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, '0.0.0.0', async () => {
  console.log(chalk.green(`✅ Server running on port ${PORT}`));
  await downloadBackupFromGitHub(); 
  await royalRestoreSessions();

  cleanupOldSessions();
  setInterval(cleanupOldSessions, 60 * 60 * 1000);
  setInterval(uploadBackupToGitHub, 10 * 60 * 1000); 

  setInterval(() => {
    for (const key in royalHeroesSessions) {
      const session = royalHeroesSessions[key];
      if (!session.messaging) continue;
      if (!royalActiveSockets[key] || royalConnectionStates[key] !== RoyalSessionState.CONNECTED) {
        royalConnectionStates[key] = RoyalSessionState.RECONNECTING;
        delete royalActiveSockets[key];
        if (royalMessageQueues[key]) royalMessageQueues[key].isSending = false;
        royalConnectAndLogin(session.phoneNumber, key, null);
      }
    }
  }, 5 * 60 * 1000);

  setInterval(() => { fetch(`http://localhost:${PORT}/health`).catch(() => {}); }, 4 * 60 * 1000);
});
