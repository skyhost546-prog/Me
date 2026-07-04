const mongoose = require('mongoose');

const contactSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    maxlength: [60, 'Name too long'],
  },
  phone: {
    type: String,
    required: [true, 'Phone is required'],
    trim: true,
    maxlength: [25, 'Phone too long'],
  },
  phoneNorm: {
    type: String,
    required: true,
    unique: true,
    maxlength: [20],
  },
  isAdmin: {
    type: Boolean,
    default: false,
  },
  registeredAt: {
    type: Date,
    default: Date.now,
  },
  lastDownloadAt: {
    type: Date,
    default: null,
  },
});

module.exports = mongoose.model('Contact', contactSchema);
