/**
 * Plugin config. The runtime configuration (provider, model, API keys) lives in the plugin store
 * and is managed from the Settings page. The only static option is a debug flag:
 *
 *   showProviderErrorDetails — when true, the chat stream surfaces the REAL provider error message
 *   (redacted of anything key-like) to the UI instead of a generic message. Useful for debugging;
 *   keep it OFF in production.
 *
 * Configure it via env (`AI_STUDIO_SHOW_ERROR_DETAILS=true`) or per consumer in config/plugins.ts:
 *   'ai-content-studio': { enabled: true, config: { showProviderErrorDetails: true } }
 */
export default {
  default: {
    showProviderErrorDetails: process.env.AI_STUDIO_SHOW_ERROR_DETAILS === 'true',
  },
  validator() {},
};
