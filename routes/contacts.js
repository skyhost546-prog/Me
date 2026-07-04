const express = require('express');
const router  = express.Router();
const Contact = require('../models/Contact');

const MAX        = parseInt(process.env.MAX_CONTACTS) || 500;
const ADMIN_PHONE = (process.env.ADMIN_PHONE || '554488138425').replace(/\D/g, '');


function normalizePhone(p) {
  return String(p || '').replace(/\D/g, '');
}

function escapeRegex(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token || '';
  const clean = normalizePhone(token);
  if (clean === ADMIN_PHONE) return next();
  return res.status(401).json({ error: 'UNAUTHORIZED' });
}


router.get('/status', async (req, res) => {
  try {
    const count = await Contact.countDocuments();
    res.json({ count, max: MAX, full: count >= MAX, slotsLeft: Math.max(0, MAX - count) });
  } catch { res.status(500).json({ error: 'Server error' }); }
});


router.post('/register', async (req, res) => {
  try {
    const { name, phone } = req.body;
    if (!name || !phone) return res.status(400).json({ error: 'MISSING_FIELDS' });

    const normalized = normalizePhone(phone);
    const trimmedName = name.trim();

    const existingPhone = await Contact.findOne({ phoneNorm: normalized });
    if (existingPhone) {
      return res.status(409).json({
        error: 'DUPLICATE_PHONE',
        existing: { name: existingPhone.name, registeredAt: existingPhone.registeredAt },
      });
    }

    const existingName = await Contact.findOne({ name: { $regex: `^${escapeRegex(trimmedName)}$`, $options: 'i' } });
    if (existingName) {
      return res.status(409).json({ error: 'DUPLICATE_NAME' });
    }

    const isAdmin = normalized === ADMIN_PHONE;
    const contact = new Contact({
      name: trimmedName,
      phone: phone.trim(),
      phoneNorm: normalized,
      isAdmin,
    });
    await contact.save();

    const newCount = await Contact.countDocuments();
    const listFull = newCount >= MAX;
    res.status(201).json({
      success: true,
      count: newCount,
      full: listFull,
      isAdmin,
    });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'DUPLICATE_PHONE' });
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/check-phone', async (req, res) => {
  try {
    const phone = normalizePhone(req.query.phone || '');
    if (!phone) return res.status(400).json({ error: 'MISSING_FIELDS' });
    const existing = await Contact.findOne({ phoneNorm: phone });
    res.json({ exists: !!existing, name: existing ? existing.name : null });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.get('/check-name', async (req, res) => {
  try {
    const name = String(req.query.name || '').trim();
    if (!name) return res.status(400).json({ error: 'MISSING_FIELDS' });
    const existing = await Contact.findOne({ name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' } });
    res.json({ exists: !!existing });
  } catch { res.status(500).json({ error: 'Server error' }); }
});


router.get('/download', async (req, res) => {
  try {
    const count = await Contact.countDocuments();
    if (count < MAX) {
      return res.status(403).json({ error: 'NOT_READY', count, max: MAX });
    }

    
    const rawPhone = String(req.query.phone || '').replace(/\D/g, '');
    const rawName  = String(req.query.name  || '').trim().toLowerCase();

    if (!rawPhone && !rawName) {
      return res.status(401).json({ error: 'VERIFY_REQUIRED' });
    }

    let contact = null;
    if (rawPhone) {
      contact = await Contact.findOne({ phoneNorm: rawPhone });
    }
    if (!contact && rawName) {
      contact = await Contact.findOne({ name: { $regex: `^${escapeRegex(rawName)}$`, $options: 'i' } });
    }

    if (!contact) {
      return res.status(403).json({ error: 'NOT_REGISTERED' });
    }

    const contacts = await Contact.find({}, 'name phone').lean();
    const vcf = contacts.map(c =>
      `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:${c.name}\r\nTEL;TYPE=CELL:${c.phone}\r\nEND:VCARD`
    ).join('\r\n\r\n');
    res.setHeader('Content-Type', 'text/vcard; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="INCONNU_BOY_TECH_contacts.vcf"');
    res.send(vcf);
  } catch { res.status(500).json({ error: 'Server error' }); }
});


router.post('/check-admin', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'MISSING_FIELDS' });
  const clean = normalizePhone(phone);
  if (clean !== ADMIN_PHONE) return res.status(403).json({ error: 'NOT_ADMIN' });
  // Vérifie qu'il est bien inscrit
  const contact = await Contact.findOne({ phoneNorm: clean });
  if (!contact) return res.status(403).json({ error: 'NOT_REGISTERED' });
  res.json({ success: true, token: ADMIN_PHONE });
});


router.get('/admin/contacts', requireAdmin, async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const search = req.query.search || '';

    const query = search
      ? { $or: [
          { name:  { $regex: search, $options: 'i' } },
          { phone: { $regex: search, $options: 'i' } },
        ]}
      : {};

    const total    = await Contact.countDocuments(query);
    const contacts = await Contact.find(query, 'name phone isAdmin registeredAt')
      .sort({ registeredAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    res.json({ contacts, total, page, pages: Math.ceil(total / limit), max: MAX });
  } catch { res.status(500).json({ error: 'Server error' }); }
});


router.delete('/admin/contacts/:id', requireAdmin, async (req, res) => {
  try {
    await Contact.findByIdAndDelete(req.params.id);
    const count = await Contact.countDocuments();
    res.json({ success: true, count });
  } catch { res.status(500).json({ error: 'Server error' }); }
});


router.get('/admin/download', requireAdmin, async (req, res) => {
  try {
    const contacts = await Contact.find({}, 'name phone').lean();
    const vcf = contacts.map(c =>
      `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:${c.name}\r\nTEL;TYPE=CELL:${c.phone}\r\nEND:VCARD`
    ).join('\r\n\r\n');
    res.setHeader('Content-Type', 'text/vcard; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="INCONNU_BOY_TECH_admin_contacts.vcf"');
    res.send(vcf);
  } catch { res.status(500).json({ error: 'Server error' }); }
});


router.delete('/admin/contacts-all', requireAdmin, async (req, res) => {
  try {
    await Contact.deleteMany({});
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
