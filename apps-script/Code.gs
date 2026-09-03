const CONFIG_KEY = 'DAILY_EMAIL_REMINDER_CONFIG';
const DRIVE_FOLDER_KEY = 'DAILY_EMAIL_REMINDER_FOLDER_ID';
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'status';
  let result;
  try {
    if (action === 'status') result = status();
    else result = { ok: false, error: 'Unsupported action' };
  } catch (err) {
    result = { ok: false, error: err.message };
  }

  const callback = e && e.parameter && e.parameter.callback;
  if (callback) {
    const safeCallback = String(callback).replace(/[^A-Za-z0-9_.$]/g, '');
    return ContentService
      .createTextOutput(`${safeCallback}(${JSON.stringify(result)})`)
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const params = e && e.parameter ? e.parameter : {};
    const action = params.action;
    if (action === 'start') return json(start(params));
    if (action === 'stop') return json(stop());
    return json({ ok: false, error: 'Unsupported action' });
  } catch (err) {
    console.error(err.stack || err.message);
    return json({ ok: false, error: err.message });
  }
}

function start(p) {
  validateStart(p);
  stopExistingTriggers();
  cleanupAttachment();

  const trackingId = 'DER-' + Utilities.getUuid().replace(/-/g, '').substring(0, 16).toUpperCase();
  let attachmentFileId = '';
  if (p.attachmentBase64) {
    const bytes = Utilities.base64Decode(p.attachmentBase64);
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error('Image exceeds the 2 MB limit.');
    const blob = Utilities.newBlob(bytes, p.attachmentMime || 'image/jpeg', p.attachmentName || 'reminder-image');
    const file = getAttachmentFolder().createFile(blob);
    attachmentFileId = file.getId();
  }

  const now = new Date();
  const config = {
    active: true,
    state: 'RUNNING',
    to: p.to.trim(),
    subject: p.subject.trim(),
    body: p.body.trim(),
    sendHour: Number(p.sendHour || 9),
    trackingId,
    attachmentFileId,
    startedAt: now.toISOString(),
    lastSentAt: '',
    lastSentDate: '',
    replyReceivedAt: '',
    threadId: ''
  };

  saveConfig(config);
  createDailyTrigger(config.sendHour);
  return { ok: true, ...publicStatus(config) };
}

function stop() {
  const config = loadConfig();
  stopExistingTriggers();
  if (!config) return { ok: true, state: 'STOPPED' };
  config.active = false;
  config.state = 'STOPPED';
  saveConfig(config);
  return { ok: true, ...publicStatus(config) };
}

function dailyJob() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  try {
    const config = loadConfig();
    if (!config || !config.active) {
      stopExistingTriggers();
      return;
    }

    if (hasReply(config)) {
      config.active = false;
      config.state = 'COMPLETED';
      config.replyReceivedAt = new Date().toISOString();
      saveConfig(config);
      stopExistingTriggers();
      cleanupAttachment();
      return;
    }

    const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    if (config.lastSentDate === today) return;

    const emailBody = `${config.body}\n\n---\nDaily Email Reminder ID: ${config.trackingId}`;
    const options = {};
    if (config.attachmentFileId) {
      try {
        options.attachments = [DriveApp.getFileById(config.attachmentFileId).getBlob()];
      } catch (err) {
        console.warn('Attachment unavailable: ' + err.message);
      }
    }

    GmailApp.sendEmail(config.to, config.subject, emailBody, options);
    config.lastSentAt = new Date().toISOString();
    config.lastSentDate = today;

    // GmailApp.sendEmail does not expose the created message ID. Find the sent
    // message by the unique tracking ID and retain its thread for reply detection.
    config.threadId = findSentThreadId(config.trackingId) || config.threadId;
    saveConfig(config);
  } finally {
    lock.releaseLock();
  }
}

function hasReply(config) {
  if (!config.threadId) {
    // A thread may not be indexed immediately after sending. The next run will retry.
    return false;
  }

  try {
    const thread = GmailApp.getThreadById(config.threadId);
    if (!thread) return false;
    const messages = thread.getMessages();
    const started = new Date(config.startedAt).getTime();
    const recipient = config.to.toLowerCase();

    return messages.some(message => {
      if (message.getDate().getTime() <= started) return false;
      return extractEmail(message.getFrom()).toLowerCase() === recipient;
    });
  } catch (err) {
    console.warn('Reply check failed: ' + err.message);
    return false;
  }
}

function findSentThreadId(trackingId) {
  const query = `in:sent "${trackingId}"`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const threads = GmailApp.search(query, 0, 5);
    if (threads.length) return threads[0].getId();
    Utilities.sleep(1000);
  }
  return '';
}

function extractEmail(from) {
  const match = String(from || '').match(/<([^>]+)>/);
  return match ? match[1].trim() : String(from || '').trim();
}

function status() {
  const config = loadConfig();
  if (!config) return { ok: true, state: 'STOPPED' };

  // Status requests also perform a reply check so the UI can reflect completion
  // before the next daily trigger runs.
  if (config.active && hasReply(config)) {
    config.active = false;
    config.state = 'COMPLETED';
    config.replyReceivedAt = config.replyReceivedAt || new Date().toISOString();
    saveConfig(config);
    stopExistingTriggers();
    cleanupAttachment();
  }
  return { ok: true, ...publicStatus(loadConfig()) };
}

function publicStatus(config) {
  return {
    state: config.state || 'STOPPED',
    startedAt: config.startedAt || '',
    lastSentAt: config.lastSentAt || '',
    replyReceivedAt: config.replyReceivedAt || ''
  };
}

function validateStart(p) {
  const email = String(p.to || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Invalid recipient email address.');
  if (!String(p.subject || '').trim()) throw new Error('Subject is required.');
  if (!String(p.body || '').trim()) throw new Error('Email body is required.');
  const hour = Number(p.sendHour || 9);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error('Invalid send hour.');
}

function createDailyTrigger(hour) {
  ScriptApp.newTrigger('dailyJob').timeBased().atHour(hour).everyDays(1).create();
}

function stopExistingTriggers() {
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === 'dailyJob') ScriptApp.deleteTrigger(trigger);
  });
}

function loadConfig() {
  const raw = PropertiesService.getScriptProperties().getProperty(CONFIG_KEY);
  return raw ? JSON.parse(raw) : null;
}

function saveConfig(config) {
  PropertiesService.getScriptProperties().setProperty(CONFIG_KEY, JSON.stringify(config));
}

function getAttachmentFolder() {
  const props = PropertiesService.getScriptProperties();
  const existingId = props.getProperty(DRIVE_FOLDER_KEY);
  if (existingId) {
    try { return DriveApp.getFolderById(existingId); } catch (_) {}
  }
  const folder = DriveApp.createFolder('Daily Email Reminder Attachments');
  props.setProperty(DRIVE_FOLDER_KEY, folder.getId());
  return folder;
}

function cleanupAttachment() {
  const config = loadConfig();
  if (!config || !config.attachmentFileId) return;
  try { DriveApp.getFileById(config.attachmentFileId).setTrashed(true); } catch (_) {}
  config.attachmentFileId = '';
  saveConfig(config);
}

function json(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

// Run this once manually after adding the script to verify Gmail, Drive and
// trigger permissions. Set the Apps Script project timezone to Asia/Kolkata
// before using the daily schedule.
function setupCheck() {
  console.log('Timezone: ' + Session.getScriptTimeZone());
  console.log('Gmail account: ' + Session.getActiveUser().getEmail());
  console.log('Attachment folder: ' + getAttachmentFolder().getName());
}
