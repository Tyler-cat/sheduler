import { URL } from 'node:url';

const DEFAULT_BRANDING = Object.freeze({
  logoUrl: null,
  primaryColor: '#2563eb',
  secondaryColor: '#1d4ed8',
  accentColor: '#f97316',
  notificationTemplates: {
    emailSubject: 'Schedule update from {{organizationName}}',
    emailBody: 'Hello {{recipientName}}, your schedule has changed. {{details}}',
    smsBody: 'Schedule updated for {{organizationName}}. {{details}}'
  },
  tokens: {},
  updatedAt: null,
  updatedBy: null
});

function cloneBranding(branding = DEFAULT_BRANDING) {
  const source = branding && typeof branding === 'object' ? branding : DEFAULT_BRANDING;
  return {
    logoUrl: source.logoUrl ?? null,
    primaryColor: source.primaryColor ?? DEFAULT_BRANDING.primaryColor,
    secondaryColor: source.secondaryColor ?? DEFAULT_BRANDING.secondaryColor,
    accentColor: source.accentColor ?? DEFAULT_BRANDING.accentColor,
    notificationTemplates: {
      emailSubject:
        source.notificationTemplates?.emailSubject ??
        DEFAULT_BRANDING.notificationTemplates.emailSubject,
      emailBody:
        source.notificationTemplates?.emailBody ??
        DEFAULT_BRANDING.notificationTemplates.emailBody,
      smsBody:
        source.notificationTemplates?.smsBody ??
        DEFAULT_BRANDING.notificationTemplates.smsBody
    },
    tokens: { ...(source.tokens || {}) },
    updatedAt: source.updatedAt ?? null,
    updatedBy: source.updatedBy ?? null
  };
}

function validateColor(value, field) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    const error = new Error(`${field} must be a string`);
    error.code = 'BRANDING_INVALID_COLOR';
    error.field = field;
    throw error;
  }
  const trimmed = value.trim();
  if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(trimmed)) {
    const error = new Error(`${field} must be a hex color (e.g. #1d4ed8)`);
    error.code = 'BRANDING_INVALID_COLOR';
    error.field = field;
    throw error;
  }
  return trimmed.toLowerCase();
}

function validateLogoUrl(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    const error = new Error('logoUrl must be a string');
    error.code = 'BRANDING_INVALID_LOGO_URL';
    throw error;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length > 2048) {
    const error = new Error('logoUrl is too long');
    error.code = 'BRANDING_INVALID_LOGO_URL';
    throw error;
  }
  try {
    // eslint-disable-next-line no-new
    new URL(trimmed);
    return trimmed;
  } catch (error) {
    const err = new Error('logoUrl must be a valid URL');
    err.code = 'BRANDING_INVALID_LOGO_URL';
    throw err;
  }
}

function validateTemplates(templates) {
  if (templates === null || templates === undefined) {
    return null;
  }
  if (typeof templates !== 'object' || Array.isArray(templates)) {
    const error = new Error('notificationTemplates must be an object');
    error.code = 'BRANDING_INVALID_NOTIFICATION_TEMPLATE';
    throw error;
  }
  const current = {};
  for (const key of ['emailSubject', 'emailBody', 'smsBody']) {
    if (!(key in templates)) {
      continue;
    }
    const value = templates[key];
    if (value === null || value === undefined) {
      current[key] = null;
      continue;
    }
    if (typeof value !== 'string') {
      const error = new Error(`${key} must be a string`);
      error.code = 'BRANDING_INVALID_NOTIFICATION_TEMPLATE';
      error.field = key;
      throw error;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      current[key] = null;
    } else {
      current[key] = trimmed.slice(0, 5000);
    }
  }
  return current;
}

function validateTokens(tokens) {
  if (tokens === null || tokens === undefined) {
    return null;
  }
  if (typeof tokens !== 'object' || Array.isArray(tokens)) {
    const error = new Error('tokens must be an object map of string values');
    error.code = 'BRANDING_INVALID_TOKENS';
    throw error;
  }
  const result = {};
  const entries = Object.entries(tokens);
  if (entries.length > 64) {
    const error = new Error('tokens must contain 64 entries or fewer');
    error.code = 'BRANDING_INVALID_TOKENS';
    throw error;
  }
  for (const [key, value] of entries) {
    if (typeof key !== 'string' || !key.trim()) {
      const error = new Error('token keys must be non-empty strings');
      error.code = 'BRANDING_INVALID_TOKENS';
      throw error;
    }
    if (typeof value !== 'string') {
      const error = new Error(`token ${key} must be a string`);
      error.code = 'BRANDING_INVALID_TOKENS';
      error.field = key;
      throw error;
    }
    const trimmedKey = key.trim().slice(0, 128);
    const trimmedValue = value.trim().slice(0, 5000);
    result[trimmedKey] = trimmedValue;
  }
  return result;
}

class BrandingService {
  constructor({ organizationService } = {}) {
    if (!organizationService) {
      throw new Error('organizationService is required');
    }
    this.organizationService = organizationService;
  }

  async getBranding(orgId) {
    if (!orgId) {
      const error = new Error('orgId is required');
      error.code = 'BRANDING_INVALID_ARGUMENT';
      throw error;
    }
    const organization = await this.organizationService.getOrganization(orgId);
    if (!organization) {
      return null;
    }
    return cloneBranding(organization.branding);
  }

  async updateBranding(orgId, updates, { updatedBy } = {}) {
    if (!orgId) {
      const error = new Error('orgId is required');
      error.code = 'BRANDING_INVALID_ARGUMENT';
      throw error;
    }
    const organization = await this.organizationService.getOrganization(orgId);
    if (!organization) {
      const error = new Error('Organization not found');
      error.code = 'BRANDING_ORG_NOT_FOUND';
      throw error;
    }
    const current = cloneBranding(organization.branding);
    const next = cloneBranding(organization.branding);

    if (updates && typeof updates === 'object') {
      if (Object.prototype.hasOwnProperty.call(updates, 'logoUrl')) {
        next.logoUrl = validateLogoUrl(updates.logoUrl);
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'primaryColor')) {
        next.primaryColor = validateColor(updates.primaryColor, 'primaryColor');
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'secondaryColor')) {
        next.secondaryColor = validateColor(updates.secondaryColor, 'secondaryColor');
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'accentColor')) {
        next.accentColor = validateColor(updates.accentColor, 'accentColor');
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'notificationTemplates')) {
        const templateUpdates = validateTemplates(updates.notificationTemplates);
        if (templateUpdates) {
          next.notificationTemplates = {
            ...current.notificationTemplates,
            ...templateUpdates
          };
        } else {
          next.notificationTemplates = cloneBranding(DEFAULT_BRANDING).notificationTemplates;
        }
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'tokens')) {
        const sanitizedTokens = validateTokens(updates.tokens);
        if (sanitizedTokens) {
          next.tokens = sanitizedTokens;
        } else {
          next.tokens = {};
        }
      }
    } else if (updates !== undefined) {
      const error = new Error('updates must be an object');
      error.code = 'BRANDING_INVALID_ARGUMENT';
      throw error;
    }

    const now = new Date().toISOString();
    next.updatedAt = now;
    next.updatedBy = updatedBy || null;

    await this.organizationService.updateBranding(orgId, next);
    return cloneBranding(next);
  }
}

export { BrandingService, cloneBranding, DEFAULT_BRANDING };
