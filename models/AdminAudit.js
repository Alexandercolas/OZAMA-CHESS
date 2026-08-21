'use strict';

const mongoose = require('mongoose');

const AdminAuditSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    action: { type: String, required: true, trim: true, maxlength: 80 },
    targetType: { type: String, trim: true, maxlength: 40, default: 'system' },
    targetId: { type: String, trim: true, maxlength: 120, default: '' },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    ip: { type: String, trim: true, maxlength: 64, default: '' },
    userAgent: { type: String, trim: true, maxlength: 240, default: '' },
  },
  { timestamps: true }
);

AdminAuditSchema.index({ createdAt: -1 });
AdminAuditSchema.index({ actor: 1, createdAt: -1 });
AdminAuditSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

module.exports = mongoose.model('AdminAudit', AdminAuditSchema);
