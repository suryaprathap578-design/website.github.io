/* =====================================================================
   SUBHA INFRA — Image Library & Website CMS  (Google Apps Script)
   ---------------------------------------------------------------------
   Database  : Google Sheet "SUBHA INFRA CMS Database" (one tab per table)
   Storage   : Google Drive folder "SUBHA INFRA CMS Images" (one sub-folder per category)
   Admin     : this web app (Admin.html)
   Public API: <web app URL>?api=site        (GET)  published image map read by /js/cms.js
               <web app URL>?api=enquiry     (POST) website enquiry form + pop-up -> sheet 'enquiries' + email

   First run (either way, only once):
     a) Deploy > New deployment > Web app, open the URL and fill in the
        "Create the admin account" form, or
     b) choose the function "setup" in the editor and press Run; the
        temporary password is printed in the execution log.
   Running setup again later is harmless: it only prints the current status.

   Useful functions to run from the editor later:
     resetOwnerPassword  new temporary password (printed in the log)
     useLocalSite        admin links/preview -> http://localhost:9090
     useLiveSite         admin links/preview -> https://www.subhainfra.com
     republish           push the current sheet data to the website
     syncWebsite         after pasting a newer Seed.gs: adds new images, placements and categories,
                         updates spots you never changed, keeps every choice you made, then publishes
     testEnquiryEmail    sends a test enquiry email to check notifications
   ===================================================================== */

var VERSION = '1.1.0';

var TABLES = {
  images: ['uid', 'image_id', 'prefix', 'seq', 'original_filename', 'display_name', 'category_code', 'subcategory', 'project_no', 'source', 'file_id', 'url', 'alt_text', 'width', 'height', 'bytes', 'mime', 'upload_date', 'updated_at', 'display_order', 'status', 'notes'],
  image_categories: ['code', 'name', 'group', 'service_url', 'sort'],
  image_subcategories: ['id', 'category_code', 'name', 'sort'],
  website_sections: ['slot_key', 'page', 'page_url', 'section', 'label', 'recommended_w', 'recommended_h', 'sizes', 'sort', 'source_file'],
  image_assignments: ['slot_key', 'image_id', 'updated_at', 'updated_by'],
  projects: ['project_no', 'slug', 'name', 'category', 'location', 'description', 'featured_image_id', 'status', 'year', 'featured', 'published', 'sort', 'updated_at'],
  project_images: ['project_no', 'image_id', 'role', 'sort'],
  administrators: ['email', 'name', 'role', 'salt', 'password_hash', 'active', 'last_login', 'created_at'],
  website_settings: ['key', 'value'],
  counters: ['prefix', 'last_seq'],
  audit_log: ['time', 'user', 'action', 'details'],
  enquiries: ['id', 'time', 'name', 'phone', 'email', 'service', 'location', 'message', 'source', 'page', 'status', 'notes', 'updated_at', 'updated_by']
};
var ENQUIRY_STATUSES = ['New', 'Contacted', 'Site visit', 'Quoted', 'Won', 'Closed'];

var DEFAULT_SETTINGS = {
  site_url: 'https://www.subhainfra.com',
  image_url_template: 'https://lh3.googleusercontent.com/d/{id}=w{w}',
  upload_max_px: '2400',
  webp_quality: '0.86',
  published_version: '0',
  published_at: '',
  published_by: '',
  notify_email: ''
};

var ALLOWED_MIME = { 'image/webp': '.webp', 'image/jpeg': '.jpg', 'image/png': '.png' };
var SESSION_SECONDS = 6 * 60 * 60;
var PROPS = PropertiesService.getScriptProperties();

/* =====================================================================
   WEB ENTRY POINTS
   ===================================================================== */
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.api === 'site') return json_(siteData_(p));
  if (p.api === 'health') return json_({ ok: true, version: VERSION, ready: !!PROPS.getProperty('DB_ID') });
  if (!PROPS.getProperty('DB_ID')) return HtmlService.createHtmlOutput(FIRST_RUN_HTML).setTitle('SUBHA INFRA · First-time setup').addMetaTag('viewport', 'width=device-width, initial-scale=1');
  return HtmlService.createTemplateFromFile('Admin').evaluate()
    .setTitle('SUBHA INFRA · Image CMS')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/* Website enquiries (contact form + pop-up). The site posts JSON as text/plain (no CORS pre-flight). */
function doPost(e) {
  var p = (e && e.parameter) || {};
  try {
    if (p.api !== 'enquiry') return json_({ ok: false, error: 'Unknown request' });
    var d = {};
    try { d = JSON.parse((e.postData && e.postData.contents) || '{}'); } catch (x) { d = p; }
    return json_(saveEnquiry_(d));
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

function include(name) { return HtmlService.createHtmlOutputFromFile(name).getContent(); }

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/* Public website data. Published version is cached; draft needs a valid admin session. */
function siteData_(p) {
  try {
    if (p.mode === 'draft') {
      if (!sessionUser_(p.token)) return { ok: false, error: 'Preview session expired' };
      var d = buildSnapshot_(); d.v = 'draft'; return d;
    }
    var cached = getBig_('published');
    if (cached) return JSON.parse(cached);
    var fid = PROPS.getProperty('PUB_FILE_ID');
    if (fid) { var s = DriveApp.getFileById(fid).getBlob().getDataAsString(); putBig_('published', s); return JSON.parse(s); }
    return { ok: true, v: 0, slots: {}, projects: {} };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

/* =====================================================================
   ADMIN RPC  — every admin call goes through here
   ===================================================================== */
function login(email, password) {
  email = String(email || '').trim().toLowerCase();
  var cache = CacheService.getScriptCache();
  var failKey = 'fail:' + email, fails = Number(cache.get(failKey) || 0);
  if (fails >= 5) return { ok: false, error: 'Too many failed attempts. Try again in 15 minutes.' };
  var admins = rows_('administrators');
  var a = admins.filter(function (x) { return x.email.toLowerCase() === email; })[0];
  if (!a || !truthy_(a.active) || hash_(a.salt, password) !== a.password_hash) {
    cache.put(failKey, String(fails + 1), 900);
    Utilities.sleep(400);
    return { ok: false, error: 'Incorrect email or password.' };
  }
  cache.remove(failKey);
  var token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
  var user = { email: a.email, name: a.name || a.email, role: a.role || 'editor' };
  cache.put('s:' + token, JSON.stringify(user), SESSION_SECONDS);
  a.last_login = now_(); saveRow_('administrators', a, 'email');
  audit_(user, 'login', '');
  return { ok: true, token: token, user: user };
}

function logout(token) { CacheService.getScriptCache().remove('s:' + token); return { ok: true }; }

function rpc(token, action, args) {
  try {
    var user = sessionUser_(token);
    if (!user) return { ok: false, error: 'AUTH', message: 'Your session has expired. Please log in again.' };
    var fn = ACTIONS[action];
    if (!fn) throw new Error('Unknown action ' + action);
    var result;
    if (READ_ONLY[action]) result = fn(user, args || {}, token);
    else {
      var lock = LockService.getScriptLock();
      if (!lock.tryLock(30000)) throw new Error('The CMS is busy with another change. Please try again.');
      try { result = fn(user, args || {}, token); _memo = {}; } finally { lock.releaseLock(); }
    }
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

var READ_ONLY = { bootstrap: 1, imageUsage: 1, downloadZip: 1, listAdmins: 1, auditLog: 1, listEnquiries: 1 };

var ACTIONS = {
  bootstrap: function (u) { return bootstrap_(u); },
  uploadImage: function (u, a) { return uploadImage_(u, a); },
  replaceImage: function (u, a) { return replaceImage_(u, a); },
  updateImage: function (u, a) { return bulkUpdate_(u, [a.image_id], a.fields, 'update'); },
  bulkUpdate: function (u, a) { return bulkUpdate_(u, a.ids, a.fields, 'bulk update'); },
  setOrder: function (u, a) { return setOrder_(u, a.ids); },
  imageUsage: function (u, a) { return usage_(a.image_id); },
  deleteImages: function (u, a) { return deleteImages_(u, a.ids, a.force); },
  assignSlot: function (u, a) { return assignSlot_(u, a.slot_key, a.image_id); },
  saveProject: function (u, a) { return saveProject_(u, a.project); },
  deleteProject: function (u, a) { return deleteProject_(u, a.project_no); },
  setProjectImages: function (u, a) { return setProjectImages_(u, a.project_no, a.items); },
  saveCategory: function (u, a) { return saveCategory_(u, a); },
  saveSubcategory: function (u, a) { return saveSubcategory_(u, a); },
  deleteSubcategory: function (u, a) { return deleteSubcategory_(u, a.id); },
  publish: function (u) { return publish_(u); },
  downloadZip: function (u, a) { return downloadZip_(a.ids); },
  saveSettings: function (u, a) { return saveSettings_(u, a); },
  listAdmins: function (u) { requireOwner_(u); return rows_('administrators').map(function (x) { return { email: x.email, name: x.name, role: x.role, active: truthy_(x.active), last_login: x.last_login }; }); },
  saveAdmin: function (u, a) { return saveAdmin_(u, a); },
  changePassword: function (u, a) { return changePassword_(u, a.current, a.next); },
  auditLog: function () { return rows_('audit_log').slice(-300).reverse(); },
  listEnquiries: function () { return rows_('enquiries').slice().reverse(); },
  updateEnquiry: function (u, a) { return updateEnquiry_(u, a); }
};

/* =====================================================================
   BOOTSTRAP — everything the admin UI needs in one call
   ===================================================================== */
function bootstrap_(user) {
  var settings = settings_();
  var images = rows_('images').filter(function (i) { return i.status !== 'deleted'; }).map(cleanImage_);
  var live = buildSnapshot_(), pub = publishedSnapshot_();
  return {
    user: user, version: VERSION, apiUrl: ScriptApp.getService().getUrl(),
    settings: settings, categories: rows_('image_categories'), subcategories: rows_('image_subcategories'),
    counters: rows_('counters'), images: images, slots: slotsWithAssignments_(), projects: rows_('projects'),
    projectImages: rows_('project_images'), pending: diff_(live, pub),
    enquiries: { total: rows_('enquiries').length, fresh: rows_('enquiries').filter(function (q) { return q.status === 'New'; }).length, statuses: ENQUIRY_STATUSES }
  };
}

function cleanImage_(i) {
  var o = {}; for (var k in i) if (k !== '_row') o[k] = i[k];
  o.width = Number(o.width) || 0; o.height = Number(o.height) || 0; o.bytes = Number(o.bytes) || 0; o.display_order = Number(o.display_order) || 0; o.seq = Number(o.seq) || 0;
  return o;
}

function slotsWithAssignments_() {
  var asg = index_(rows_('image_assignments'), 'slot_key');
  return rows_('website_sections').map(function (s) {
    var a = asg[s.slot_key] || {};
    return { slot_key: s.slot_key, page: s.page, page_url: s.page_url, section: s.section, label: s.label, recommended_w: Number(s.recommended_w), recommended_h: Number(s.recommended_h),
      sizes: s.sizes, sort: Number(s.sort), source_file: s.source_file, image_id: a.image_id || '', updated_at: a.updated_at || '', updated_by: a.updated_by || '' };
  }).sort(function (a, b) { return a.sort - b.sort; });
}

/* =====================================================================
   IMAGES
   ===================================================================== */
function uploadImage_(user, a) {
  var cat = category_(a.category_code);
  var blob = decodeUpload_(a);
  var seq = nextSeq_(cat.code);
  var id = formatId_(cat.code, seq);
  var file = storeFile_(cat.code, blob.setName(id + ALLOWED_MIME[a.mime]), a.name);
  var img = {
    uid: Utilities.getUuid(), image_id: id, prefix: cat.code, seq: seq, original_filename: a.name || '', display_name: a.display_name || stripExt_(a.name) || id,
    category_code: cat.code, subcategory: a.subcategory || '', project_no: a.project_no || '', source: 'drive', file_id: file.getId(), url: '',
    alt_text: a.alt_text || a.display_name || '', width: a.width || '', height: a.height || '', bytes: blob.getBytes().length, mime: a.mime,
    upload_date: now_(), updated_at: now_(), display_order: seq, status: a.status === 'inactive' ? 'inactive' : 'active', notes: ''
  };
  appendRow_('images', img);
  if (a.project_no && a.add_to_gallery) {
    var pi = rows_('project_images').filter(function (r) { return r.project_no === a.project_no; });
    appendRow_('project_images', { project_no: a.project_no, image_id: id, role: a.role || 'gallery', sort: pi.length + 1 });
  }
  audit_(user, 'upload', id + ' ' + (a.name || ''));
  return cleanImage_(img);
}

function replaceImage_(user, a) {
  var img = findImage_(a.image_id);
  var blob = decodeUpload_(a);
  var file = storeFile_(img.category_code, blob.setName(img.image_id + ALLOWED_MIME[a.mime]), a.name);
  if (img.source === 'drive' && img.file_id) { try { DriveApp.getFileById(img.file_id).setTrashed(true); } catch (e) { } }
  img.source = 'drive'; img.file_id = file.getId(); img.url = ''; img.original_filename = a.name || img.original_filename;
  img.width = a.width || ''; img.height = a.height || ''; img.bytes = blob.getBytes().length; img.mime = a.mime; img.updated_at = now_();
  if (/PLACEHOLDER/.test(img.notes)) img.notes = '';
  saveRow_('images', img, 'image_id');
  audit_(user, 'replace', img.image_id + ' <- ' + (a.name || ''));
  return cleanImage_(img);
}

function decodeUpload_(a) {
  if (!ALLOWED_MIME[a.mime]) throw new Error('Unsupported file type ' + a.mime + '. Use JPG, PNG or WebP.');
  var bytes = Utilities.base64Decode(String(a.data || '').replace(/^data:[^,]+,/, ''));
  if (bytes.length > 20 * 1024 * 1024) throw new Error('File is larger than 20 MB.');
  return Utilities.newBlob(bytes, a.mime);
}

function storeFile_(code, blob, originalName) {
  var file = categoryFolder_(code).createFile(blob);
  file.setDescription('SUBHA INFRA CMS · ' + (originalName || ''));
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); }
  catch (e) { throw new Error('Google Drive refused public link sharing for uploaded images (' + e.message + '). Use a personal Gmail account or allow link sharing in your Workspace admin settings.'); }
  return file;
}

function bulkUpdate_(user, ids, fields, label) {
  var allowed = ['display_name', 'alt_text', 'category_code', 'subcategory', 'project_no', 'status', 'notes'];
  if (fields.category_code) category_(fields.category_code);
  if (fields.status && ['active', 'inactive', 'archived'].indexOf(fields.status) < 0) throw new Error('Invalid status');
  var t = table_('images'), set = {}, n = 0;
  ids.forEach(function (id) { set[id] = 1; });
  t.rows.forEach(function (r) {
    if (!set[r.image_id] || r.status === 'deleted') return;
    allowed.forEach(function (k) { if (fields[k] !== undefined) r[k] = fields[k]; });
    r.updated_at = now_(); n++;
  });
  writeTable_(t);
  audit_(user, label, ids.join(', ') + ' ' + JSON.stringify(fields));
  return { updated: n };
}

function setOrder_(user, ids) {
  var t = table_('images'), pos = {};
  ids.forEach(function (id, k) { pos[id] = k + 1; });
  t.rows.forEach(function (r) { if (pos[r.image_id]) r.display_order = pos[r.image_id]; });
  writeTable_(t);
  audit_(user, 'reorder', ids.length + ' images');
  return { ok: true };
}

function usage_(imageId) {
  var slots = rows_('image_assignments').filter(function (a) { return a.image_id === imageId; }).map(function (a) { return a.slot_key; });
  var featured = rows_('projects').filter(function (p) { return p.featured_image_id === imageId; }).map(function (p) { return p.project_no + ' ' + p.name; });
  var gallery = rows_('project_images').filter(function (p) { return p.image_id === imageId; }).map(function (p) { return p.project_no + ' (' + p.role + ')'; });
  return { image_id: imageId, slots: slots, featured: featured, gallery: gallery, used: slots.length + featured.length + gallery.length };
}

function deleteImages_(user, ids, force) {
  var blocked = ids.map(usage_).filter(function (u) { return u.used > 0; });
  if (blocked.length && !force) return { needsConfirm: true, usage: blocked };
  var set = {}; ids.forEach(function (id) { set[id] = 1; });
  var ta = table_('image_assignments'); ta.rows.forEach(function (r) { if (set[r.image_id]) { r.image_id = ''; r.updated_at = now_(); r.updated_by = user.email; } }); writeTable_(ta);
  var tp = table_('projects'); tp.rows.forEach(function (r) { if (set[r.featured_image_id]) r.featured_image_id = ''; }); writeTable_(tp);
  var tpi = table_('project_images'); tpi.rows = tpi.rows.filter(function (r) { return !set[r.image_id]; }); writeTable_(tpi);
  var ti = table_('images');
  ti.rows.forEach(function (r) {
    if (!set[r.image_id]) return;
    if (r.source === 'drive' && r.file_id) { try { DriveApp.getFileById(r.file_id).setTrashed(true); } catch (e) { } }
    r.status = 'deleted'; r.updated_at = now_();   // row kept so the ID is never reused
  });
  writeTable_(ti);
  audit_(user, 'delete', ids.join(', ') + (blocked.length ? ' (was in use)' : ''));
  return { deleted: ids.length };
}

/* =====================================================================
   PLACEMENTS
   ===================================================================== */
function assignSlot_(user, key, imageId) {
  if (!rows_('website_sections').some(function (s) { return s.slot_key === key; })) throw new Error('Unknown placement ' + key);
  if (imageId) { var img = findImage_(imageId); if (img.status === 'deleted') throw new Error(imageId + ' is deleted'); }
  var t = table_('image_assignments');
  var r = t.rows.filter(function (x) { return x.slot_key === key; })[0];
  if (!r) { r = { slot_key: key }; t.rows.push(r); }
  r.image_id = imageId || ''; r.updated_at = now_(); r.updated_by = user.email;
  writeTable_(t);
  audit_(user, 'assign', key + ' -> ' + (imageId || '(built-in)'));
  return { slot_key: key, image_id: r.image_id, updated_at: r.updated_at, updated_by: r.updated_by };
}

/* =====================================================================
   PROJECTS
   ===================================================================== */
function saveProject_(user, p) {
  var t = table_('projects');
  var r = p.project_no ? t.rows.filter(function (x) { return x.project_no === p.project_no; })[0] : null;
  if (!r) {
    r = { project_no: formatId_('PRJ', nextSeq_('PRJ')), sort: t.rows.length + 1 };
    t.rows.push(r);
  }
  if (p.slug && t.rows.some(function (x) { return x !== r && x.slug === p.slug; })) throw new Error('Another project already uses the page address ' + p.slug);
  ['slug', 'name', 'category', 'location', 'description', 'featured_image_id', 'status', 'year'].forEach(function (k) { if (p[k] !== undefined) r[k] = p[k]; });
  if (p.featured !== undefined) r.featured = p.featured ? 'TRUE' : 'FALSE';
  if (p.published !== undefined) r.published = p.published ? 'TRUE' : 'FALSE';
  r.updated_at = now_();
  writeTable_(t);
  audit_(user, 'project', r.project_no + ' ' + (r.name || ''));
  return r;
}

function deleteProject_(user, no) {
  var t = table_('projects'); t.rows = t.rows.filter(function (r) { return r.project_no !== no; }); writeTable_(t);
  var tpi = table_('project_images'); tpi.rows = tpi.rows.filter(function (r) { return r.project_no !== no; }); writeTable_(tpi);
  audit_(user, 'delete project', no);
  return { ok: true };
}

function setProjectImages_(user, no, items) {
  var t = table_('project_images');
  t.rows = t.rows.filter(function (r) { return r.project_no !== no; });
  (items || []).forEach(function (it, k) { findImage_(it.image_id); t.rows.push({ project_no: no, image_id: it.image_id, role: it.role || 'gallery', sort: k + 1 }); });
  writeTable_(t);
  audit_(user, 'project photos', no + ': ' + (items || []).length + ' images');
  return rows_('project_images');
}

/* =====================================================================
   CATEGORIES
   ===================================================================== */
function saveCategory_(user, a) {
  var code = String(a.code || '').trim().toUpperCase();
  if (!/^[A-Z]{2,10}$/.test(code)) throw new Error('Category code must be 2–10 letters, e.g. LAND');
  if (code === 'PRJ') throw new Error('PRJ is reserved for project numbers');
  var t = table_('image_categories');
  var r = t.rows.filter(function (x) { return x.code === code; })[0];
  if (!r) {
    if (!a.isNew) throw new Error('Unknown category ' + code);
    r = { code: code, sort: t.rows.length + 1 }; t.rows.push(r);
    var tc = table_('counters'); if (!tc.rows.some(function (x) { return x.prefix === code; })) { tc.rows.push({ prefix: code, last_seq: 0 }); writeTable_(tc); }
  } else if (a.isNew) throw new Error('Category ' + code + ' already exists');
  r.name = a.name || r.name || code; r.group = a.group || r.group || ''; r.service_url = a.service_url || r.service_url || '';
  writeTable_(t);
  audit_(user, 'category', code + ' ' + r.name);
  return r;
}

function saveSubcategory_(user, a) {
  category_(a.category_code);
  var name = String(a.name || '').trim(); if (!name) throw new Error('Subcategory name is required');
  var t = table_('image_subcategories');
  var r = a.id ? t.rows.filter(function (x) { return x.id === a.id; })[0] : null;
  if (r && r.name !== name) {   // rename: keep images attached
    var ti = table_('images'); ti.rows.forEach(function (i) { if (i.category_code === r.category_code && i.subcategory === r.name) i.subcategory = name; }); writeTable_(ti);
  }
  if (!r) { r = { id: Utilities.getUuid().slice(0, 8), category_code: a.category_code, sort: t.rows.filter(function (x) { return x.category_code === a.category_code; }).length + 1 }; t.rows.push(r); }
  r.name = name;
  writeTable_(t);
  audit_(user, 'subcategory', r.category_code + ' › ' + name);
  return r;
}

function deleteSubcategory_(user, id) {
  var t = table_('image_subcategories');
  var r = t.rows.filter(function (x) { return x.id === id; })[0]; if (!r) return { ok: true };
  var n = rows_('images').filter(function (i) { return i.status !== 'deleted' && i.category_code === r.category_code && i.subcategory === r.name; }).length;
  if (n) throw new Error(n + ' image(s) still use "' + r.name + '". Move them to another subcategory first.');
  t.rows = t.rows.filter(function (x) { return x.id !== id; }); writeTable_(t);
  audit_(user, 'delete subcategory', r.category_code + ' › ' + r.name);
  return { ok: true };
}

/* =====================================================================
   PUBLISHING
   ===================================================================== */
function buildSnapshot_() {
  var s = settings_();
  var cats = index_(rows_('image_categories'), 'code');
  var imgs = {};
  rows_('images').forEach(function (i) { if (i.status === 'active') imgs[i.image_id] = i; });
  var slotSizes = index_(rows_('website_sections'), 'slot_key');
  var pack = function (id, extra) {
    var i = imgs[id]; if (!i) return null;
    var o = { i: i.image_id, w: Number(i.width) || 0, h: Number(i.height) || 0, a: i.alt_text || '', t: i.display_name || '', c: (cats[i.category_code] || {}).name || '' };
    if (i.source === 'drive') o.d = i.file_id; else o.u = i.url;
    for (var k in extra) if (extra[k]) o[k] = extra[k];
    return o;
  };
  var slots = {};
  rows_('image_assignments').forEach(function (a) {
    var m = a.image_id && pack(a.image_id, { s: (slotSizes[a.slot_key] || {}).sizes });
    if (m) slots[a.slot_key] = m;
  });
  var pi = rows_('project_images').sort(function (a, b) { return Number(a.sort) - Number(b.sort); });
  var projects = {};
  rows_('projects').forEach(function (p) {
    if (!p.slug) return;
    var gal = pi.filter(function (x) { return x.project_no === p.project_no; })
      .map(function (x) { return pack(x.image_id, { r: x.role === 'before' ? 'Before' : x.role === 'after' ? 'After' : '' }); })
      .filter(function (x) { return x; });
    projects[p.slug] = { no: p.project_no, pub: truthy_(p.published) ? 1 : 0, f: truthy_(p.featured) ? 1 : 0, img: pack(p.featured_image_id, {}), gal: gal, loc: p.location || '' };
  });
  return { ok: true, v: Number(s.published_version) || 0, at: s.published_at, tpl: s.image_url_template, slots: slots, projects: projects };
}

function publishedSnapshot_() {
  var c = getBig_('published'); if (c) return JSON.parse(c);
  var fid = PROPS.getProperty('PUB_FILE_ID');
  if (fid) { try { return JSON.parse(DriveApp.getFileById(fid).getBlob().getDataAsString()); } catch (e) { } }
  return { slots: {}, projects: {} };
}

function diff_(live, pub) {
  var slots = [], projects = [];
  var keys = {}; Object.keys(live.slots).concat(Object.keys(pub.slots || {})).forEach(function (k) { keys[k] = 1; });
  Object.keys(keys).forEach(function (k) { if (JSON.stringify(live.slots[k] || null) !== JSON.stringify((pub.slots || {})[k] || null)) slots.push(k); });
  var pk = {}; Object.keys(live.projects).concat(Object.keys(pub.projects || {})).forEach(function (k) { pk[k] = 1; });
  Object.keys(pk).forEach(function (k) { if (JSON.stringify(live.projects[k] || null) !== JSON.stringify((pub.projects || {})[k] || null)) projects.push(k); });
  return { slots: slots, projects: projects, settingsChanged: live.tpl !== pub.tpl, count: slots.length + projects.length };
}

function publish_(user) {
  var s = settings_();
  var v = (Number(s.published_version) || 0) + 1;
  setSetting_('published_version', v); setSetting_('published_at', now_()); setSetting_('published_by', user.email);
  var snap = buildSnapshot_();
  var str = JSON.stringify(snap);
  var fid = PROPS.getProperty('PUB_FILE_ID'), file;
  if (fid) { try { file = DriveApp.getFileById(fid); file.setContent(str); } catch (e) { file = null; } }
  if (!file) { file = rootFolder_().createFile('published.json', str, 'application/json'); PROPS.setProperty('PUB_FILE_ID', file.getId()); }
  putBig_('published', str);
  audit_(user, 'publish', 'v' + v + ': ' + Object.keys(snap.slots).length + ' placements, ' + Object.keys(snap.projects).length + ' projects');
  return { v: v, at: snap.at, slots: Object.keys(snap.slots).length };
}

/* =====================================================================
   DOWNLOAD
   ===================================================================== */
function downloadZip_(ids) {
  if (!ids || !ids.length) throw new Error('Select images first');
  if (ids.length > 40) throw new Error('Download up to 40 images at a time');
  var s = settings_(), blobs = [], total = 0;
  ids.forEach(function (id) {
    var i = findImage_(id), b;
    if (i.source === 'drive') b = DriveApp.getFileById(i.file_id).getBlob();
    else b = UrlFetchApp.fetch(s.site_url.replace(/\/$/, '') + i.url, { muteHttpExceptions: true }).getBlob();
    var ext = (b.getContentType() === 'image/webp') ? '.webp' : (b.getContentType() === 'image/png' ? '.png' : '.jpg');
    total += b.getBytes().length;
    blobs.push(b.setName(i.image_id + ' ' + String(i.display_name || '').replace(/[^\w\- ]+/g, '').slice(0, 60) + ext));
  });
  if (total > 35 * 1024 * 1024) throw new Error('Selection is too large for one download (over 35 MB). Select fewer images.');
  var zip = Utilities.zip(blobs, 'subha-infra-images.zip');
  return { name: 'subha-infra-images-' + Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyyMMdd-HHmm') + '.zip', data: Utilities.base64Encode(zip.getBytes()) };
}

/* =====================================================================
   SETTINGS & ADMINISTRATORS
   ===================================================================== */
function saveSettings_(user, a) {
  requireOwner_(user);
  ['site_url', 'image_url_template', 'upload_max_px', 'webp_quality', 'notify_email'].forEach(function (k) { if (a[k] !== undefined) setSetting_(k, String(a[k]).trim()); });
  audit_(user, 'settings', JSON.stringify(a));
  return settings_();
}

function saveAdmin_(user, a) {
  requireOwner_(user);
  var email = String(a.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter a valid email');
  var t = table_('administrators');
  var r = t.rows.filter(function (x) { return x.email.toLowerCase() === email; })[0];
  if (!r) { if (!a.password) throw new Error('Set a password for the new administrator'); r = { email: email, created_at: now_() }; t.rows.push(r); }
  r.name = a.name || r.name || ''; r.role = a.role === 'owner' ? 'owner' : 'editor'; r.active = a.active === false ? 'FALSE' : 'TRUE';
  if (a.password) { checkPassword_(a.password); r.salt = Utilities.getUuid(); r.password_hash = hash_(r.salt, a.password); }
  if (!t.rows.some(function (x) { return x.role === 'owner' && truthy_(x.active); })) throw new Error('At least one active owner is required');
  writeTable_(t);
  audit_(user, 'administrator', email + ' ' + r.role + (r.active === 'FALSE' ? ' (disabled)' : ''));
  return { ok: true };
}

function changePassword_(user, current, next) {
  var t = table_('administrators');
  var r = t.rows.filter(function (x) { return x.email === user.email; })[0];
  if (!r || hash_(r.salt, current) !== r.password_hash) throw new Error('Current password is incorrect');
  checkPassword_(next);
  r.salt = Utilities.getUuid(); r.password_hash = hash_(r.salt, next);
  writeTable_(t);
  audit_(user, 'password changed', '');
  return { ok: true };
}

function checkPassword_(p) { if (String(p).length < 10) throw new Error('Password must be at least 10 characters'); }
function requireOwner_(u) { if (u.role !== 'owner') throw new Error('Only an owner can do this'); }

/* =====================================================================
   SETUP  (run once from the editor)
   ===================================================================== */
/* First-time setup from the browser: the person who deployed the script creates the owner account.
   Only works once (before the database exists) and only for the Google account that owns the script. */
function firstRunSetup(email, password) {
  try {
    if (PROPS.getProperty('DB_ID')) return { ok: false, error: 'Already set up. Reload the page and sign in.' };
    email = String(email || '').trim().toLowerCase();
    var owner = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
    if (owner && email !== owner) return { ok: false, error: 'Use the Google account that deployed this script (' + owner.replace(/^(.).*(@.*)$/, '$1•••$2') + ').' };
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'Enter a valid email address.' };
    checkPassword_(password);
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return { ok: false, error: 'Setup is already running. Wait a minute and reload.' };
    try { setup(email, password); } finally { lock.releaseLock(); }
    return { ok: true };
  } catch (err) { return { ok: false, error: String(err.message || err) }; }
}

var FIRST_RUN_HTML = '<!DOCTYPE html><html><head><base target="_top"><meta charset="utf-8"><style>'
  + 'body{margin:0;min-height:100vh;display:grid;place-items:center;background:#101D2B;font:14px/1.5 Inter,Segoe UI,Arial,sans-serif;padding:20px}'
  + 'form{background:#fff;border-radius:14px;width:min(420px,100%);overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.4)}'
  + '.h{background:#101D2B;border-bottom:3px solid #B69A70;padding:24px 26px;color:#fff}.h b{letter-spacing:.2em;font-size:20px}.h small{display:block;color:#E5CF9F;letter-spacing:.3em;font-size:10px;margin-top:6px}'
  + '.b{padding:22px 26px;display:grid;gap:12px}h1{margin:0;font-size:19px;color:#101D2B}p{margin:0;color:#6B7480;font-size:13px}'
  + 'label{display:grid;gap:4px;font-size:12px;font-weight:600;color:#6B7480}input{border:1px solid #D8D2C6;border-radius:8px;padding:10px 12px;font:inherit}'
  + 'button{background:#101D2B;color:#fff;border:0;border-radius:8px;padding:12px;font-family:inherit;font-weight:600;font-size:14px;cursor:pointer}button[disabled]{opacity:.6}'
  + '.e{background:#FBE9EA;color:#B4232C;border-radius:8px;padding:10px 12px;font-size:13px}.ok{background:#E8F3EE;color:#2F7D5B}'
  + '</style></head><body><form id="f"><div class="h"><b>SUBHA INFRA</b><small>IMAGE CMS · FIRST-TIME SETUP</small></div><div class="b">'
  + '<h1>Create the admin account</h1><p>This creates the database (Google Sheet), the image folder (Google Drive) and your owner login. It takes about a minute and happens only once.</p>'
  + '<div id="m" class="e" hidden></div>'
  + '<label>Username (your Google email that deployed this script)<input name="email" type="email" required autocomplete="username"></label>'
  + '<label>Password (min 10 characters)<input name="p1" type="password" minlength="10" required autocomplete="new-password"></label>'
  + '<label>Confirm password<input name="p2" type="password" minlength="10" required autocomplete="new-password"></label>'
  + '<button id="go">Create account &amp; set up</button></div></form><script>'
  + 'var f=document.getElementById("f"),m=document.getElementById("m"),g=document.getElementById("go");'
  + 'function msg(t,ok){m.hidden=false;m.className=ok?"e ok":"e";m.textContent=t;}'
  + 'f.onsubmit=function(e){e.preventDefault();if(f.p1.value!==f.p2.value)return msg("The passwords do not match.");'
  + 'g.disabled=true;g.textContent="Setting up… (about 1 minute)";'
  + 'google.script.run.withSuccessHandler(function(r){if(r.ok){msg("Done! Opening the sign-in page…",true);setTimeout(function(){window.top.location.reload();},1500);}else{msg(r.error);g.disabled=false;g.textContent="Create account & set up";}})'
  + '.withFailureHandler(function(err){msg(err.message);g.disabled=false;g.textContent="Create account & set up";}).firstRunSetup(f.email.value,f.p1.value);};'
  + '</script></body></html>';

function setup(ownerEmail, ownerPassword) {
  if (PROPS.getProperty('DB_ID')) {   // already done: report status instead of failing
    var st = settings_();
    Logger.log('================ SUBHA INFRA CMS IS ALREADY SET UP ================');
    Logger.log('Nothing was changed. Setup only runs once.');
    Logger.log('Database  : ' + db_().getUrl());
    Logger.log('Admins    : ' + rows_('administrators').map(function (a) { return a.email + ' (' + a.role + ')'; }).join(', '));
    Logger.log('Images    : ' + rows_('images').filter(function (i) { return i.status !== 'deleted'; }).length + ' · placements: ' + rows_('website_sections').length + ' · projects: ' + rows_('projects').length);
    Logger.log('Published : v' + st.published_version + ' at ' + st.published_at);
    Logger.log('Website   : ' + st.site_url);
    Logger.log('Admin URL : ' + (ScriptApp.getService().getUrl() || '(deploy as a web app first)'));
    Logger.log('Forgot the password? Run resetOwnerPassword.');
    return;
  }
  var ss = SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null;
  if (!ss) ss = SpreadsheetApp.create('SUBHA INFRA CMS Database');
  PROPS.setProperty('DB_ID', ss.getId());
  var folder = DriveApp.createFolder('SUBHA INFRA CMS Images');
  PROPS.setProperty('FOLDER_ID', folder.getId());
  try { DriveApp.getFileById(ss.getId()).moveTo(folder); } catch (e) { }

  Object.keys(TABLES).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    sh.clear();
    sh.getRange(1, 1, sh.getMaxRows(), TABLES[name].length).setNumberFormat('@');
    sh.getRange(1, 1, 1, TABLES[name].length).setValues([TABLES[name]]).setFontWeight('bold').setBackground('#101D2B').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  });
  ss.getSheets().forEach(function (sh) { if (!TABLES[sh.getName()]) { try { ss.deleteSheet(sh); } catch (e) { } } });

  var t = now_();
  bulkAppend_('image_categories', SEED.categories);
  var subSeq = {};
  bulkAppend_('image_subcategories', SEED.subcategories.map(function (s) { subSeq[s.category_code] = (subSeq[s.category_code] || 0) + 1; return { id: s.category_code + '-' + ('0' + subSeq[s.category_code]).slice(-2), category_code: s.category_code, name: s.name, sort: s.sort }; }));
  bulkAppend_('images', SEED.images.map(function (i) {
    return { uid: Utilities.getUuid(), image_id: i.image_id, prefix: i.prefix, seq: i.seq, original_filename: i.original_filename, display_name: i.display_name, category_code: i.category_code,
      subcategory: i.subcategory, project_no: '', source: 'site', file_id: '', url: i.url, alt_text: i.alt_text, width: i.width, height: i.height, bytes: i.bytes, mime: i.mime || 'image/jpeg',
      upload_date: t, updated_at: t, display_order: i.display_order, status: 'active', notes: i.notes };
  }));
  bulkAppend_('website_sections', SEED.slots);
  bulkAppend_('image_assignments', SEED.slots.map(function (s) { return { slot_key: s.slot_key, image_id: SEED.assignments[s.slot_key] || '', updated_at: t, updated_by: 'setup' }; }));
  bulkAppend_('projects', SEED.projects.map(function (p) { p.featured = p.featured ? 'TRUE' : 'FALSE'; p.published = p.published ? 'TRUE' : 'FALSE'; p.updated_at = t; return p; }));
  var prjByImg = {}; SEED.projects.forEach(function (p) { prjByImg[p.featured_image_id] = p.project_no; });
  // link each project photo to its project
  var ti = table_('images'); ti.rows.forEach(function (r) { if (prjByImg[r.image_id]) r.project_no = prjByImg[r.image_id]; }); writeTable_(ti);
  bulkAppend_('counters', Object.keys(SEED.counters).map(function (k) { return { prefix: k, last_seq: SEED.counters[k] }; }));
  bulkAppend_('website_settings', Object.keys(DEFAULT_SETTINGS).map(function (k) { return { key: k, value: DEFAULT_SETTINGS[k] }; }));

  var fromEditor = typeof ownerEmail !== 'string';   // the editor's Run button passes an event object
  var email = (!fromEditor && ownerEmail) || Session.getEffectiveUser().getEmail() || 'admin@subhainfra.com';
  var pwd = (!fromEditor && ownerPassword) || tempPassword_(), salt = Utilities.getUuid();
  appendRow_('administrators', { email: email.toLowerCase(), name: 'Owner', role: 'owner', salt: salt, password_hash: hash_(salt, pwd), active: 'TRUE', last_login: '', created_at: t });
  _memo = {};
  publish_({ email: 'setup' });
  Logger.log('================ SUBHA INFRA CMS READY ================');
  Logger.log('Database : ' + ss.getUrl());
  Logger.log('Images   : ' + folder.getUrl());
  Logger.log('Login    : ' + email);
  Logger.log('Password : ' + pwd + '   (temporary - change it in Settings after first login)');
  Logger.log('Next     : Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone)');
}

/* Run from the editor if the owner password is lost. Prints a new temporary password. */
function resetOwnerPassword() {
  var t = table_('administrators');
  var me = Session.getEffectiveUser().getEmail().toLowerCase();
  var r = t.rows.filter(function (x) { return x.email.toLowerCase() === me; })[0] || t.rows.filter(function (x) { return x.role === 'owner'; })[0];
  if (!r) throw new Error('No owner account found');
  var pwd = tempPassword_(); r.salt = Utilities.getUuid(); r.password_hash = hash_(r.salt, pwd); r.active = 'TRUE'; r.role = 'owner';
  writeTable_(t);
  CacheService.getScriptCache().remove('fail:' + r.email);
  Logger.log('Login: ' + r.email + '   New temporary password: ' + pwd);
}

/* Run from the editor after pasting a newer Seed.gs (it comes with every website update).
   - adds new images (matched by their website file), placements, categories and subcategories
   - points every placement that nobody has changed in the admin panel to its new image
   - keeps every choice made in the admin panel (placements you changed, your uploads, projects)
   - retires old built-in images that are no longer on the website and are not used
   - publishes, so the live website shows the result straight away */
function syncWebsite() {
  if (!PROPS.getProperty('DB_ID')) throw new Error('Run setup first.');
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    _memo = {};
    var t = now_(), log = [];
    // 1. categories & subcategories
    var tc = table_('image_categories'), haveCat = index_(tc.rows, 'code'), nc = 0;
    SEED.categories.forEach(function (c) { if (!haveCat[c.code]) { tc.rows.push(c); nc++; } });
    if (nc) writeTable_(tc);
    var ts = table_('image_subcategories'), nsub = 0, seen = {}, usedSubId = {};
    ts.rows.forEach(function (r) { seen[r.category_code + '|' + r.name] = 1; usedSubId[r.id] = 1; });
    SEED.subcategories.forEach(function (s) {
      if (seen[s.category_code + '|' + s.name]) return;
      var n = ts.rows.filter(function (r) { return r.category_code === s.category_code; }).length + 1, id;
      do { id = s.category_code + '-' + ('0' + n).slice(-2); n++; } while (usedSubId[id]);
      usedSubId[id] = 1; seen[s.category_code + '|' + s.name] = 1;
      ts.rows.push({ id: id, category_code: s.category_code, name: s.name, sort: s.sort }); nsub++;
    });
    if (nsub) writeTable_(ts);
    log.push('Categories added: ' + nc + ', subcategories added: ' + nsub);

    // 2. images (matched by website file path)
    var ti = table_('images'), byUrl = {}, ids = {}, maxSeq = {}, idMap = {}, added = [], refreshed = 0;
    ti.rows.forEach(function (r) { ids[r.image_id] = 1; if (r.url && r.status !== 'deleted') byUrl[r.url] = r; maxSeq[r.prefix] = Math.max(maxSeq[r.prefix] || 0, Number(r.seq) || 0); });
    var tcount = table_('counters'), cnt = index_(tcount.rows, 'prefix');
    Object.keys(cnt).forEach(function (k) { maxSeq[k] = Math.max(maxSeq[k] || 0, Number(cnt[k].last_seq) || 0); });
    var seedUrls = {};
    SEED.images.forEach(function (si) {
      seedUrls[si.url] = 1;
      var r = byUrl[si.url];
      if (r) {
        idMap[si.image_id] = r.image_id;
        var untouched = !r.updated_at || r.updated_at === r.upload_date;
        r.width = si.width; r.height = si.height; r.bytes = si.bytes; r.mime = si.mime || r.mime;
        if (/PLACEHOLDER/.test(r.notes) || untouched) r.notes = si.notes || '';
        if (untouched) { r.display_name = si.display_name; r.alt_text = si.alt_text; r.subcategory = si.subcategory; }
        refreshed++;
        return;
      }
      var id = si.image_id, seq = si.seq;
      if (ids[id]) { seq = (maxSeq[si.prefix] || 0) + 1; id = formatId_(si.prefix, seq); }
      maxSeq[si.prefix] = Math.max(maxSeq[si.prefix] || 0, seq);
      ids[id] = 1; idMap[si.image_id] = id;
      ti.rows.push({ uid: Utilities.getUuid(), image_id: id, prefix: si.prefix, seq: seq, original_filename: si.original_filename, display_name: si.display_name, category_code: si.category_code,
        subcategory: si.subcategory, project_no: '', source: 'site', file_id: '', url: si.url, alt_text: si.alt_text, width: si.width, height: si.height, bytes: si.bytes, mime: si.mime || 'image/jpeg',
        upload_date: t, updated_at: t, display_order: seq, status: 'active', notes: si.notes || '' });
      added.push(id + ' ' + si.display_name);
    });
    Object.keys(maxSeq).forEach(function (k) { if (!cnt[k]) { cnt[k] = { prefix: k, last_seq: 0 }; tcount.rows.push(cnt[k]); } cnt[k].last_seq = Math.max(Number(cnt[k].last_seq) || 0, maxSeq[k]); });
    writeTable_(tcount);
    log.push('Images added: ' + added.length + (added.length ? ' (' + added.join(', ') + ')' : '') + ' · built-in images refreshed: ' + refreshed);

    // 3. placements
    var tw = table_('website_sections'), haveSlot = index_(tw.rows, 'slot_key'), seedKeys = {}, newSlots = [];
    SEED.slots.forEach(function (s) { seedKeys[s.slot_key] = 1; if (haveSlot[s.slot_key]) { for (var k in s) haveSlot[s.slot_key][k] = s[k]; } else { tw.rows.push(s); newSlots.push(s.slot_key); } });
    var gone = tw.rows.filter(function (r) { return !seedKeys[r.slot_key]; }).map(function (r) { return r.slot_key; });
    tw.rows = tw.rows.filter(function (r) { return seedKeys[r.slot_key]; });
    writeTable_(tw);
    var imgById = index_(ti.rows, 'image_id');
    var ta = table_('image_assignments'), asg = index_(ta.rows, 'slot_key'), changed = [], kept = [], swappedOut = [];
    SEED.slots.forEach(function (s) {
      var target = SEED.assignments[s.slot_key] ? (idMap[SEED.assignments[s.slot_key]] || '') : '';
      var a = asg[s.slot_key];
      if (!a) { ta.rows.push({ slot_key: s.slot_key, image_id: target, updated_at: t, updated_by: 'sync' }); if (target) changed.push(s.slot_key); return; }
      if (a.image_id === target) return;
      if (a.updated_by === 'setup' || a.updated_by === 'sync') {
        var cur = imgById[a.image_id];
        if (cur && cur.source === 'drive') swappedOut.push(s.slot_key + ' (was ' + a.image_id + ')');
        a.image_id = target; a.updated_at = t; a.updated_by = 'sync'; changed.push(s.slot_key);
      } else kept.push(s.slot_key + ' = ' + a.image_id);
    });
    ta.rows = ta.rows.filter(function (r) { return seedKeys[r.slot_key]; });
    writeTable_(ta);
    log.push('Placements added: ' + newSlots.length + ' · removed (no longer on the website): ' + gone.length + (gone.length ? ' (' + gone.join(', ') + ')' : ''));
    log.push('Placements updated to the new website images: ' + changed.length);
    if (kept.length) log.push('Kept your own choices: ' + kept.join(', '));
    if (swappedOut.length) log.push('These spots now show the new website image instead of a photo uploaded earlier (the photo is still in the library — pick it again in the admin panel if you want it back): ' + swappedOut.join(', '));

    // 4. retire old built-in images that are no longer part of the website and unused
    var usedIds = {};
    ta.rows.forEach(function (r) { if (r.image_id) usedIds[r.image_id] = 1; });
    rows_('projects').forEach(function (p) { if (p.featured_image_id) usedIds[p.featured_image_id] = 1; });
    rows_('project_images').forEach(function (p) { usedIds[p.image_id] = 1; });
    var retired = [];
    ti.rows.forEach(function (r) {
      if (r.source === 'site' && r.status !== 'deleted' && r.url && !seedUrls[r.url] && !usedIds[r.image_id]) { r.status = 'deleted'; r.notes = 'Retired by syncWebsite ' + t.slice(0, 10) + ': file no longer on the website.'; retired.push(r.image_id); }
    });
    writeTable_(ti);
    if (retired.length) log.push('Retired old placeholder images: ' + retired.join(', '));

    // 5. publish
    _memo = {};
    var pub = publish_({ email: 'syncWebsite' });
    log.push('Published v' + pub.v + ' — the website now shows the result.');
    audit_({ email: 'syncWebsite' }, 'sync website', log.join(' | ').slice(0, 1000));
    Logger.log('================ SUBHA INFRA CMS — WEBSITE SYNC ================');
    log.forEach(function (l) { Logger.log(l); });
  } finally { lock.releaseLock(); }
}
/* Older name, kept so existing instructions still work. */
function syncPlacements() { syncWebsite(); }

/* =====================================================================
   ENQUIRIES (website contact form + pop-up)
   ===================================================================== */
function clean_(v, max) {
  var s = String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max || 200);
  return /^[=@]/.test(s) ? ' ' + s : s;   // never let a value act as a spreadsheet formula
}
function saveEnquiry_(d) {
  if (!PROPS.getProperty('DB_ID')) return { ok: false, error: 'The CMS is not set up yet.' };
  if (d.website) return { ok: true };                        // honeypot filled: a bot — pretend success
  if (Number(d.t) > 0 && Number(d.t) < 1500) return { ok: true }; // submitted faster than a person can type
  var q = { name: clean_(d.name, 80), phone: clean_(d.phone, 20), email: clean_(d.email, 120).toLowerCase(), service: clean_(d.service, 80), location: clean_(d.location, 80),
    message: clean_(d.message, 2000), source: clean_(d.source, 60), page: clean_(d.page, 200) };
  var digits = q.phone.replace(/\D/g, '');
  if (!q.name) return { ok: false, error: 'Please enter your name.' };
  if (digits.length < 10 || digits.length > 13) return { ok: false, error: 'Please enter a valid mobile number.' };
  if (q.email && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(q.email)) return { ok: false, error: 'Please enter a valid email address.' };
  var cache = CacheService.getScriptCache();
  var gk = 'enq:min:' + Math.floor(Date.now() / 60000), pk = 'enq:ph:' + digits.slice(-10);
  if (Number(cache.get(gk) || 0) >= 20) return { ok: false, error: 'Too many enquiries right now. Please call us instead.' };
  if (Number(cache.get(pk) || 0) >= 3) return { ok: true, duplicate: true };
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var tcount = table_('counters'), c = tcount.rows.filter(function (x) { return x.prefix === 'ENQ'; })[0];
    if (!c) { c = { prefix: 'ENQ', last_seq: 0 }; tcount.rows.push(c); }
    c.last_seq = (Number(c.last_seq) || 0) + 1; writeTable_(tcount);
    q.id = 'ENQ-' + ('000' + c.last_seq).slice(-4); q.time = now_(); q.status = 'New'; q.notes = ''; q.updated_at = q.time; q.updated_by = 'website';
    appendRow_('enquiries', q);
  } finally { lock.releaseLock(); }
  cache.put(gk, String(Number(cache.get(gk) || 0) + 1), 120);
  cache.put(pk, String(Number(cache.get(pk) || 0) + 1), 3600);
  try { notifyEnquiry_(q); } catch (e) { audit_({ email: 'website' }, 'enquiry email failed', e.message); }
  return { ok: true, id: q.id };
}
function enquiryRecipients_() {
  var s = settings_(), list = String(s.notify_email || '').split(/[,;\s]+/).filter(function (x) { return /@/.test(x); });
  if (!list.length) list = rows_('administrators').filter(function (a) { return a.role === 'owner' && truthy_(a.active); }).map(function (a) { return a.email; });
  return list;
}
function notifyEnquiry_(q) {
  var to = enquiryRecipients_(); if (!to.length) return;
  var e = function (s) { return String(s || '—').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var wa = 'https://wa.me/' + q.phone.replace(/\D/g, '').replace(/^(\d{10})$/, '91$1');
  var row = function (k, v) { return '<tr><td style="padding:6px 14px 6px 0;color:#6B7480;white-space:nowrap">' + k + '</td><td style="padding:6px 0;color:#101D2B"><b>' + v + '</b></td></tr>'; };
  var html = '<div style="font-family:Arial,sans-serif;max-width:560px"><div style="background:#101D2B;color:#fff;padding:18px 22px;border-bottom:3px solid #B69A70"><b style="letter-spacing:.18em">SUBHA INFRA</b><div style="color:#E5CF9F;font-size:12px;letter-spacing:.2em;margin-top:4px">NEW WEBSITE ENQUIRY · ' + e(q.id) + '</div></div>'
    + '<div style="padding:18px 22px;border:1px solid #e6e2da;border-top:0"><table style="font-size:14px;border-collapse:collapse">' + row('Name', e(q.name)) + row('Mobile', '<a href="tel:' + e(q.phone) + '">' + e(q.phone) + '</a> · <a href="' + wa + '">WhatsApp</a>') + row('Email', q.email ? '<a href="mailto:' + e(q.email) + '">' + e(q.email) + '</a>' : '—')
    + row('Service', e(q.service)) + row('Location', e(q.location)) + row('From', e(q.source) + ' · ' + e(q.page)) + '</table>'
    + '<div style="margin-top:14px;padding:12px 14px;background:#F5F3EE;color:#101D2B;font-size:14px;white-space:pre-wrap">' + e(q.message || '(no message)') + '</div>'
    + '<p style="font-size:12px;color:#6B7480;margin-top:14px">All enquiries: admin panel → Enquiries.</p></div></div>';
  MailApp.sendEmail({ to: to.join(','), subject: 'New enquiry ' + q.id + ' — ' + q.name + (q.service ? ' (' + q.service + ')' : ''), htmlBody: html, replyTo: q.email || undefined, name: 'SUBHA INFRA Website' });
}
function updateEnquiry_(user, a) {
  var t = table_('enquiries'), r = t.rows.filter(function (x) { return x.id === a.id; })[0];
  if (!r) throw new Error('Enquiry ' + a.id + ' not found');
  if (a.status !== undefined) { if (ENQUIRY_STATUSES.indexOf(a.status) < 0) throw new Error('Invalid status'); r.status = a.status; }
  if (a.notes !== undefined) r.notes = clean_(a.notes, 1000);
  r.updated_at = now_(); r.updated_by = user.email;
  writeTable_(t);
  audit_(user, 'enquiry', r.id + ' ' + r.status);
  return r;
}
/* Run from the editor to check that enquiry emails arrive (authorises email sending the first time). */
function testEnquiryEmail() {
  notifyEnquiry_({ id: 'ENQ-TEST', name: 'Test visitor', phone: '+91 90000 00000', email: '', service: 'Architectural design', location: 'Bengaluru', message: 'This is a test enquiry from testEnquiryEmail().', source: 'Test', page: '/' });
  Logger.log('Test email sent to: ' + enquiryRecipients_().join(', '));
}
/* Run from the editor: Preview / "Open page" links and original-photo thumbnails use your local test server. */
function useLocalSite() { setSetting_('site_url', 'http://localhost:9090'); Logger.log('Website address is now http://localhost:9090'); }

/* Run from the editor when the site is live again. */
function useLiveSite() { setSetting_('site_url', 'https://www.subhainfra.com'); Logger.log('Website address is now https://www.subhainfra.com'); }

/* Run from the editor to rebuild the live website data from the sheet (e.g. after editing the sheet by hand). */
function republish() { _memo = {}; Logger.log(JSON.stringify(publish_({ email: Session.getEffectiveUser().getEmail() || 'editor' }))); }

/* =====================================================================
   DATA LAYER (Google Sheets)
   ===================================================================== */
var _memo = {};
function db_() { if (!_memo.ss) _memo.ss = SpreadsheetApp.openById(PROPS.getProperty('DB_ID')); return _memo.ss; }

function table_(name) {
  var sh = ensureSheet_(name);
  var head = TABLES[name];
  var last = sh.getLastRow();
  var vals = last > 1 ? sh.getRange(2, 1, last - 1, head.length).getValues() : [];
  var rows = vals.filter(function (v) { return v.join('') !== ''; }).map(function (v) {
    var o = {}; head.forEach(function (h, k) { o[h] = v[k] instanceof Date ? v[k].toISOString() : String(v[k]); }); return o;
  });
  return { name: name, sh: sh, head: head, rows: rows, lastRow: last };
}

function rows_(name) { if (!_memo['t:' + name]) _memo['t:' + name] = table_(name); return _memo['t:' + name].rows; }

function writeTable_(t) {
  var data = t.rows.map(function (r) { return t.head.map(function (h) { return r[h] == null ? '' : String(r[h]); }); });
  var needed = Math.max(t.lastRow - 1, data.length);
  if (needed > 0) {
    var range = t.sh.getRange(2, 1, needed, t.head.length);
    range.setNumberFormat('@');
    var blank = t.head.map(function () { return ''; });
    while (data.length < needed) data.push(blank);
    range.setValues(data);
  }
  delete _memo['t:' + t.name];
}

/* Returns the sheet for a table, creating it (with its header row) if a newer version added the table. */
function ensureSheet_(name) {
  var ss = db_(), sh = ss.getSheetByName(name);
  if (sh) return sh;
  if (!TABLES[name]) throw new Error('Unknown table ' + name);
  sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, TABLES[name].length).setValues([TABLES[name]]).setFontWeight('bold').setBackground('#101D2B').setFontColor('#ffffff');
  sh.getRange(1, 1, sh.getMaxRows(), TABLES[name].length).setNumberFormat('@');
  sh.setFrozenRows(1);
  return sh;
}

function appendRow_(name, obj) {
  var sh = ensureSheet_(name);
  var r = sh.getLastRow() + 1;
  sh.getRange(r, 1, 1, TABLES[name].length).setNumberFormat('@').setValues([TABLES[name].map(function (h) { return obj[h] == null ? '' : String(obj[h]); })]);
  delete _memo['t:' + name];
}

function bulkAppend_(name, list) {
  if (!list.length) return;
  var sh = ensureSheet_(name), head = TABLES[name];
  sh.getRange(sh.getLastRow() + 1, 1, list.length, head.length).setNumberFormat('@')
    .setValues(list.map(function (o) { return head.map(function (h) { return o[h] == null ? '' : String(o[h]); }); }));
  delete _memo['t:' + name];
}

function saveRow_(name, obj, key) {
  var t = table_(name);
  var r = t.rows.filter(function (x) { return x[key] === obj[key]; })[0];
  if (!r) throw new Error(name + ': ' + obj[key] + ' not found');
  t.head.forEach(function (h) { if (obj[h] !== undefined) r[h] = obj[h]; });
  writeTable_(t);
}

function index_(list, key) { var o = {}; list.forEach(function (r) { o[r[key]] = r; }); return o; }

function findImage_(id) {
  var i = rows_('images').filter(function (x) { return x.image_id === id; })[0];
  if (!i) throw new Error('Image ' + id + ' not found');
  return JSON.parse(JSON.stringify(i));
}

function category_(code) {
  var c = rows_('image_categories').filter(function (x) { return x.code === code; })[0];
  if (!c) throw new Error('Choose a category');
  return c;
}

/* Permanent numbering: max(counter, highest existing) + 1. Never reset, never reused. */
function nextSeq_(prefix) {
  var t = table_('counters');
  var r = t.rows.filter(function (x) { return x.prefix === prefix; })[0];
  if (!r) { r = { prefix: prefix, last_seq: 0 }; t.rows.push(r); }
  var maxUsed = 0;
  if (prefix === 'PRJ') rows_('projects').forEach(function (p) { maxUsed = Math.max(maxUsed, Number(String(p.project_no).split('-')[1]) || 0); });
  else rows_('images').forEach(function (i) { if (i.prefix === prefix) maxUsed = Math.max(maxUsed, Number(i.seq) || 0); });
  var next = Math.max(Number(r.last_seq) || 0, maxUsed) + 1;
  r.last_seq = next;
  writeTable_(t);
  return next;
}
function formatId_(prefix, seq) { var s = String(seq); while (s.length < 3) s = '0' + s; return prefix + '-' + s; }

function settings_() {
  var o = {}; for (var k in DEFAULT_SETTINGS) o[k] = DEFAULT_SETTINGS[k];
  rows_('website_settings').forEach(function (r) { o[r.key] = r.value; });
  return o;
}
function setSetting_(k, v) {
  var t = table_('website_settings');
  var r = t.rows.filter(function (x) { return x.key === k; })[0];
  if (!r) { r = { key: k }; t.rows.push(r); }
  r.value = String(v); writeTable_(t);
}

function rootFolder_() { return DriveApp.getFolderById(PROPS.getProperty('FOLDER_ID')); }
function categoryFolder_(code) {
  var key = 'FOLDER_' + code, id = PROPS.getProperty(key);
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { } }
  var it = rootFolder_().getFoldersByName(code);
  var f = it.hasNext() ? it.next() : rootFolder_().createFolder(code);
  PROPS.setProperty(key, f.getId());
  return f;
}

/* =====================================================================
   HELPERS
   ===================================================================== */
function sessionUser_(token) {
  if (!token) return null;
  var c = CacheService.getScriptCache(), v = c.get('s:' + token);
  if (!v) return null;
  c.put('s:' + token, v, SESSION_SECONDS);
  return JSON.parse(v);
}
function hash_(salt, pwd) {
  var s = String(salt) + '|' + String(pwd), d;
  for (var k = 0; k < 200; k++) { d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8); s = Utilities.base64Encode(d) + String(salt); }
  return Utilities.base64Encode(d);
}
function tempPassword_() { var c = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789', s = ''; for (var k = 0; k < 14; k++) s += c.charAt(Math.floor(Math.random() * c.length)); return s; }
function truthy_(v) { return v === true || String(v).toUpperCase() === 'TRUE' || v === '1'; }
function now_() { return new Date().toISOString(); }
function stripExt_(n) { return String(n || '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim(); }
function audit_(user, action, details) {
  try { appendRow_('audit_log', { time: now_(), user: user.email || '', action: action, details: String(details || '').slice(0, 1000) }); } catch (e) { }
}
/* CacheService stores at most 100 KB per key, so large JSON is split into chunks. */
function putBig_(key, str) {
  var c = CacheService.getScriptCache(), size = 90000, n = Math.ceil(str.length / size), o = {};
  for (var k = 0; k < n; k++) o[key + ':' + k] = str.substr(k * size, size);
  o[key + ':n'] = String(n);
  c.putAll(o, 21600);
}
function getBig_(key) {
  var c = CacheService.getScriptCache(), n = Number(c.get(key + ':n') || 0);
  if (!n) return null;
  var keys = []; for (var k = 0; k < n; k++) keys.push(key + ':' + k);
  var got = c.getAll(keys), s = '';
  for (var j = 0; j < n; j++) { if (got[keys[j]] == null) return null; s += got[keys[j]]; }
  return s;
}
