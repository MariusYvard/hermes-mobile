// Pure presentation policy, no view, network, storage, dependency or auto action.
// Output contains translation keys, never server messages or credentials.
const rules = {
  invalid_url: ['edit_url','inline'], invalid_options: ['inspect','screen'],
  invalid_input: ['edit_input','inline'], capabilities_required: ['check_connection','banner'],
  unsupported_capability: ['choose_mode','banner'], unsupported_runtime: ['update_app','screen'],
  unauthorized: ['reauthenticate','banner'], forbidden: ['check_access','banner'],
  unsupported_transport: ['edit_url','banner'], conflict: ['check_status','banner'],
  session_not_found: ['open_conversations','banner'], http_error: ['check_connection','banner'],
  timeout: ['check_connection','banner'], unreachable: ['check_connection','banner'],
  response_too_large: ['check_connection','banner'], invalid_json: ['check_connection','banner'],
  redirect_blocked: ['check_connection','banner'], frame_too_large: ['check_connection','banner'],
  invalid_contract: ['edit_url','banner'], insecure_auth: ['secure_connection','screen'],
  invalid_session_contract: ['check_connection','banner'],
  host_key_changed: ['verify_identity','dialog'], unconfirmed: ['check_status','message'],
  no_agents: ['choose_mode','empty'], quota_exceeded: ['check_provider','banner'],
  permission_denied: ['review_permissions','banner'],
  unknown: ['inspect','banner'],
};
export function presentation(error, { mode = 'instance', stage = 'setup', delivery = 'none', authTarget = 'agent' } = {}) {
  if (error?.code === 'stale_discovery') return {
    placement: 'none', titleKey: null, messageKey: null, action: null,
    preserveDraft: true, automaticRetry: false, announcement: 'off',
  };
  const security = error?.code === 'host_key_changed' || error?.code === 'insecure_auth';
  const code = security ? error.code : delivery === 'unknown' ? 'unconfirmed' :
    typeof error?.code === 'string' && Object.hasOwn(rules, error.code) ? error.code : 'unknown';
  let [actionId, placement] = rules[code];
  if (code === 'unauthorized') {
    actionId = mode === 'local' ? 'edit_key' : mode === 'ssh' && authTarget === 'ssh' ? 'edit_ssh_credentials' : 'reauthenticate';
    placement = stage === 'setup' ? 'inline' : 'banner';
  }
  if (stage === 'launch' && placement !== 'dialog' && placement !== 'message') placement = 'screen';
  return {
    placement,
    titleKey: `errors.${code}.title`, messageKey: `errors.${code}.message`,
    action: { id: actionId, labelKey: `actions.${actionId}` },
    preserveDraft: true, automaticRetry: false, announcement: security ? 'assertive' : 'polite',
  };
}
