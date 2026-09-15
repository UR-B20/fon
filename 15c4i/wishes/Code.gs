/**
 * 15 C4I WISHES WALL — Google Apps Script backend
 * =================================================
 * Paste this whole file into the Apps Script editor of your Google Sheet
 * (Extensions → Apps Script), replacing everything that is there.
 *
 * SETUP (about 10 minutes)
 *  1. Telegram: message @BotFather → /newbot → follow the prompts → copy the token.
 *     Open your new bot's chat in Telegram and press START (or send "hi").
 *     To share approvals with a co-organiser, add the bot to a small group
 *     and send one message in that group instead.
 *  2. Paste the token between the quotes in TELEGRAM_BOT_TOKEN below, then Save (Ctrl/Cmd+S).
 *  3. In the toolbar pick the function "setup" and press Run. Accept the permissions
 *     prompt (Advanced → Go to project). This creates the Wishes sheet and a secret key.
 *  4. Pick the function "setupTelegram" and press Run. You should receive
 *     "Wishes Wall connected" on Telegram. If not, read the Execution log.
 *  5. Deploy → New deployment → type: Web app →
 *        Execute as: Me
 *        Who has access: Anyone            (must be "Anyone", not "Anyone with Google account")
 *     → Deploy → copy the Web app URL (ends in /exec).
 *  6. Paste that URL into 15c4i/wishes/config.js on GitHub and commit.
 *
 * IMPORTANT: if you ever edit this file again, go to Deploy → Manage deployments →
 * pencil icon → Version: "New version" → Deploy. Saving alone does not update the live URL.
 *
 * Moderation: every submission is sent to your Telegram with Approve / Reject buttons.
 * The "Approved" checkbox column in the sheet is the source of truth, so you can also
 * tick or untick it there by hand at any time.
 */

var TELEGRAM_BOT_TOKEN = 'PASTE_BOT_TOKEN_HERE';
var TELEGRAM_CHAT_ID   = '';   // optional: leave blank, setupTelegram() fills it in
var ADMIN_KEY          = '';   // optional: leave blank, setup() generates one

var SHEET_NAME = 'Wishes';
var HEADER = ['Timestamp', 'Name', 'Message', 'Signature', 'Approved', 'ID', 'Status', 'TgMsgId'];
var COL = { ts: 1, name: 2, message: 3, signature: 4, approved: 5, id: 6, status: 7, tgMsgId: 8 };
var LIMITS = { name: 40, message: 220, signature: 49000 };

/* ---------------- one-time setup ---------------- */

function setup() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) {
    sh.appendRow(HEADER);
  }
  sh.getRange(1, 1, 1, HEADER.length).setFontWeight('bold').setBackground('#A0181F').setFontColor('#FFFFFF');
  sh.setFrozenRows(1);
  sh.getRange(2, COL.approved, 2000, 1).insertCheckboxes();
  sh.setColumnWidth(COL.name, 160);
  sh.setColumnWidth(COL.message, 360);
  sh.setColumnWidth(COL.signature, 60);
  sh.getRange(2, COL.signature, 2000, 1).setWrap(false);
  sh.setColumnWidth(COL.id, 120);

  var props = PropertiesService.getScriptProperties();
  if (!ADMIN_KEY && !props.getProperty('ADMIN_KEY')) {
    props.setProperty('ADMIN_KEY', Utilities.getUuid().replace(/-/g, ''));
  }
  Logger.log('Setup complete. Sheet "' + SHEET_NAME + '" is ready. Now run setupTelegram.');
}

function setupTelegram() {
  if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN.indexOf('PASTE_') === 0) {
    throw new Error('Paste your bot token into TELEGRAM_BOT_TOKEN first, then Save and run again.');
  }
  var props = PropertiesService.getScriptProperties();
  var chatId = TELEGRAM_CHAT_ID || props.getProperty('TELEGRAM_CHAT_ID');
  if (!chatId) {
    var res = tg('getUpdates', {});
    var updates = (res && res.result) || [];
    for (var i = updates.length - 1; i >= 0; i--) {
      var u = updates[i];
      var msg = u.message || u.channel_post || u.edited_message;
      var member = u.my_chat_member;
      if (msg && msg.chat && msg.chat.id) { chatId = String(msg.chat.id); break; }
      if (member && member.chat && member.chat.id) { chatId = String(member.chat.id); break; }
    }
    if (!chatId) {
      throw new Error('No chat found yet. Open your bot in Telegram, press START or send "hi", then run setupTelegram again.');
    }
    props.setProperty('TELEGRAM_CHAT_ID', chatId);
  }
  var ok = tg('sendMessage', {
    chat_id: chatId,
    text: '15 C4I Wishes Wall connected. New wishes will arrive here with Approve / Reject buttons.'
  });
  if (!ok || !ok.ok) throw new Error('Telegram refused the test message: ' + JSON.stringify(ok));
  Logger.log('Telegram connected. Chat id ' + chatId + '. Next: Deploy → New deployment → Web app.');
}

/* ---------------- web app entry points ---------------- */

function doPost(e) {
  try {
    var raw = (e && e.postData && e.postData.contents) || '{}';
    var data = JSON.parse(raw);
    var name = clean(data.name, LIMITS.name);
    var message = clean(data.message, LIMITS.message);
    var sig = String(data.signature || '');

    if (!name) return json({ ok: false, error: 'Name is required.' });
    if (!message) return json({ ok: false, error: 'Message is required.' });
    if (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+\/=]+$/.test(sig)) return json({ ok: false, error: 'Signature is required.' });
    if (sig.length > LIMITS.signature) return json({ ok: false, error: 'Signature image is too large. Please clear and sign again.' });

    var id = Utilities.getUuid();
    var lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      sheet().appendRow([new Date(), name, message, sig, false, id, 'pending', '']);
    } finally {
      lock.releaseLock();
    }

    try {
      var msgId = notifyTelegram(id, name, message, sig);
      if (msgId) setCell(id, COL.tgMsgId, String(msgId));
    } catch (err) {
      // Telegram problems must never lose a submission; the row is already saved.
    }
    return json({ ok: true, id: id });
  } catch (err) {
    return json({ ok: false, error: 'Server error: ' + err });
  }
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action === 'approve' || p.action === 'reject') return decide(p);
  if (p.approved === '1') return json(approvedList());
  return json({ ok: false, error: 'Unknown request.' });
}

/* ---------------- data ---------------- */

function sheet() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);
  if (!sh) throw new Error('Sheet "' + SHEET_NAME + '" not found. Run setup first.');
  return sh;
}

function approvedList() {
  var rows = sheet().getDataRange().getValues();
  var out = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (r[COL.approved - 1] !== true) continue;
    if (!r[COL.id - 1]) continue;
    out.push({
      id: String(r[COL.id - 1]),
      name: String(r[COL.name - 1]),
      message: String(r[COL.message - 1]),
      signature: String(r[COL.signature - 1]),
      ts: r[COL.ts - 1] instanceof Date ? r[COL.ts - 1].getTime() : 0
    });
  }
  out.sort(function (a, b) { return a.ts - b.ts; });
  return out;
}

function findRow(id) {
  var col = sheet().getRange(2, COL.id, Math.max(sheet().getLastRow() - 1, 1), 1).getValues();
  for (var i = 0; i < col.length; i++) {
    if (String(col[i][0]) === String(id)) return i + 2;
  }
  return 0;
}

function setCell(id, colIndex, value) {
  var row = findRow(id);
  if (row) sheet().getRange(row, colIndex).setValue(value);
}

function decide(p) {
  var key = adminKey();
  if (!key || String(p.key || '') !== key) return page('Link invalid', 'This approval link is not valid.', '');
  var row = findRow(p.id);
  if (!row) return page('Not found', 'This wish is no longer in the sheet.', '');

  var sh = sheet();
  var vals = sh.getRange(row, 1, 1, HEADER.length).getValues()[0];
  var name = String(vals[COL.name - 1]);
  var message = String(vals[COL.message - 1]);
  var status = String(vals[COL.status - 1] || 'pending');
  var approve = p.action === 'approve';
  var want = approve ? 'approved' : 'rejected';

  if (status !== want) {
    sh.getRange(row, COL.approved).setValue(approve);
    sh.getRange(row, COL.status).setValue(want);
    try { updateTelegram(String(vals[COL.tgMsgId - 1]), name, message, want); } catch (err) {}
  }

  var base = ScriptApp.getService().getUrl();
  var other = approve ? 'reject' : 'approve';
  var otherUrl = base + '?action=' + other + '&id=' + encodeURIComponent(p.id) + '&key=' + encodeURIComponent(key);
  var title = approve ? 'Approved' : 'Rejected';
  var body = (status === want ? 'Already ' + want + ': ' : (approve ? 'Now on the wall: ' : 'Will not be shown: ')) + name;
  var link = '<a href="' + otherUrl + '">' + (approve ? 'Reject instead' : 'Approve instead') + '</a>';
  return page(title, body, link);
}

/* ---------------- telegram ---------------- */

function tgToken() { return TELEGRAM_BOT_TOKEN; }
function tgChat() { return TELEGRAM_CHAT_ID || PropertiesService.getScriptProperties().getProperty('TELEGRAM_CHAT_ID') || ''; }
function adminKey() { return ADMIN_KEY || PropertiesService.getScriptProperties().getProperty('ADMIN_KEY') || ''; }

function tg(method, payload) {
  var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + tgToken() + '/' + method, {
    method: 'post',
    payload: payload,
    muteHttpExceptions: true
  });
  try { return JSON.parse(res.getContentText()); } catch (err) { return { ok: false, raw: res.getContentText() }; }
}

function buttons(id) {
  var base = ScriptApp.getService().getUrl();
  var key = encodeURIComponent(adminKey());
  var q = '?id=' + encodeURIComponent(id) + '&key=' + key + '&action=';
  return JSON.stringify({ inline_keyboard: [[
    { text: '✅ Approve', url: base + q + 'approve' },
    { text: '❌ Reject',  url: base + q + 'reject' }
  ]] });
}

function caption(name, message, status) {
  var text = 'New wish from ' + name + '\n\n“' + message + '”';
  if (status === 'approved') text += '\n\n✅ Approved — on the wall';
  else if (status === 'rejected') text += '\n\n❌ Rejected';
  else text += '\n\nTap to approve or reject:';
  return text.slice(0, 1000);
}

function notifyTelegram(id, name, message, sig) {
  var chat = tgChat();
  var token = tgToken();
  if (!chat || !token || token.indexOf('PASTE_') === 0) return '';

  var res = null;
  try {
    var parts = sig.split(',');
    var mime = /jpeg/.test(parts[0]) ? 'image/jpeg' : 'image/png';
    var blob = Utilities.newBlob(Utilities.base64Decode(parts[1]), mime, 'signature.' + (mime === 'image/jpeg' ? 'jpg' : 'png'));
    res = tg('sendPhoto', { chat_id: chat, photo: blob, caption: caption(name, message, 'pending'), reply_markup: buttons(id) });
  } catch (err) { res = null; }

  if (!res || !res.ok) {
    res = tg('sendMessage', { chat_id: chat, text: caption(name, message, 'pending'), reply_markup: buttons(id) });
  }
  return (res && res.ok && res.result && res.result.message_id) ? res.result.message_id : '';
}

function updateTelegram(msgId, name, message, status) {
  var chat = tgChat();
  if (!chat || !msgId) return;
  var text = caption(name, message, status);
  var empty = JSON.stringify({ inline_keyboard: [] });
  var res = tg('editMessageCaption', { chat_id: chat, message_id: msgId, caption: text, reply_markup: empty });
  if (!res || !res.ok) tg('editMessageText', { chat_id: chat, message_id: msgId, text: text, reply_markup: empty });
}

/* ---------------- helpers ---------------- */

function clean(v, max) {
  return String(v || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim().slice(0, max);
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function page(title, body, linkHtml) {
  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + esc(title) + '</title><style>' +
    'body{margin:0;background:#1F0507;color:#F6EDE2;font-family:-apple-system,Segoe UI,Roboto,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:24px}' +
    '.card{background:#3B0A0E;border:1px solid #D9A94A;border-radius:16px;padding:28px 24px;max-width:420px}' +
    'h1{font-family:Georgia,serif;color:#D9A94A;font-size:28px;margin:0 0 10px}p{font-size:17px;line-height:1.5;margin:0 0 18px}' +
    'a{color:#F0CC7A;font-size:14px}small{display:block;margin-top:18px;color:#CFAFA8;font-size:12px}' +
    '</style></head><body><div class="card"><h1>' + esc(title) + '</h1><p>' + esc(body) + '</p>' + (linkHtml || '') +
    '<small>15 C4I Wishes Wall · you can close this tab</small></div></body></html>';
  return HtmlService.createHtmlOutput(html).setTitle(title);
}
