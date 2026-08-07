import previewOverlay from './preview-overlay';

/**
 * Plugin middlewares. Registered always and INERT without a valid signed preview token — and inert
 * regardless while `preview.enabled` is false, which is the default.
 *
 * A consuming project adds it to the content-API pipeline in `config/middlewares.ts`:
 *   'plugin::ai-content-studio.preview-overlay'
 */
export default {
  'preview-overlay': previewOverlay,
};
