import type { Core } from '@strapi/strapi';

/**
 * Fail fast: validate the encryption key at boot so a misconfigured AI_STUDIO_ENC_KEY
 * aborts startup with a clear message (no secret material logged) rather than failing
 * later at first encrypt/decrypt.
 */
const register = ({ strapi }: { strapi: Core.Strapi }) => {
  strapi.plugin('ai-content-studio').service('crypto').assertConfigured();
};

export default register;
