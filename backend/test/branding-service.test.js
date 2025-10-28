import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { BrandingService, DEFAULT_BRANDING } from '../src/services/branding-service.js';
import { OrganizationService } from '../src/services/organization-service.js';

describe('BrandingService', () => {
  let organizationService;
  let service;
  let org;

  beforeEach(async () => {
    organizationService = new OrganizationService({
      idGenerator: (() => {
        let counter = 0;
        return () => `id-${counter++}`;
      })()
    });
    org = await organizationService.createOrganization({ name: 'Acme', slug: 'acme' });
    service = new BrandingService({ organizationService });
  });

  it('returns default branding when none configured', async () => {
    const branding = await service.getBranding(org.id);
    assert.deepEqual(branding, DEFAULT_BRANDING);
    // ensure caller cannot mutate internal state
    branding.tokens.brand = 'blue';
    const second = await service.getBranding(org.id);
    assert.equal(second.tokens.brand, undefined);
  });

  it('throws for missing organization', async () => {
    const result = await service.getBranding('missing-org');
    assert.equal(result, null);
    await assert.rejects(service.updateBranding('missing-org', {}), {
      code: 'BRANDING_ORG_NOT_FOUND'
    });
  });

  it('updates branding with validation and metadata', async () => {
    const updated = await service.updateBranding(
      org.id,
      {
        logoUrl: 'https://cdn.example.com/logo.png',
        primaryColor: '#123abc',
        secondaryColor: '#abcdef',
        accentColor: '#fff',
        notificationTemplates: {
          emailSubject: 'Hello {{recipientName}}',
          smsBody: 'Short notice'
        },
        tokens: {
          heroIllustration: 'https://cdn.example.com/hero.png'
        }
      },
      { updatedBy: 'admin-1' }
    );

    assert.equal(updated.logoUrl, 'https://cdn.example.com/logo.png');
    assert.equal(updated.primaryColor, '#123abc');
    assert.equal(updated.secondaryColor, '#abcdef');
    assert.equal(updated.accentColor, '#fff');
    assert.equal(updated.notificationTemplates.emailSubject, 'Hello {{recipientName}}');
    assert.equal(updated.notificationTemplates.emailBody, DEFAULT_BRANDING.notificationTemplates.emailBody);
    assert.equal(updated.notificationTemplates.smsBody, 'Short notice');
    assert.equal(updated.tokens.heroIllustration, 'https://cdn.example.com/hero.png');
    assert.equal(updated.updatedBy, 'admin-1');
    assert.ok(updated.updatedAt);

    const stored = await service.getBranding(org.id);
    assert.equal(stored.tokens.heroIllustration, 'https://cdn.example.com/hero.png');
  });

  it('validates color formats', async () => {
    await assert.rejects(
      service.updateBranding(org.id, {
        primaryColor: 'red'
      }),
      { code: 'BRANDING_INVALID_COLOR' }
    );
  });

  it('resets tokens and templates when null is provided', async () => {
    await service.updateBranding(org.id, {
      notificationTemplates: {
        emailBody: 'Updated body'
      },
      tokens: {
        welcome: 'Hello'
      }
    });

    const cleared = await service.updateBranding(org.id, {
      notificationTemplates: null,
      tokens: null
    });

    assert.deepEqual(cleared.notificationTemplates, DEFAULT_BRANDING.notificationTemplates);
    assert.deepEqual(cleared.tokens, {});
  });
});
