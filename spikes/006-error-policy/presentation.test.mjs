import test from 'node:test';
import assert from 'node:assert/strict';
let presentation;
try { ({presentation} = await import('./presentation.mjs')); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }

test('authentication failure points to the credential relevant to the mode', () => {
  assert.equal(typeof presentation, 'function', 'Error policy must exist');
  const local = presentation({code:'unauthorized'}, {mode:'local',stage:'setup'});
  assert.equal(local.placement, 'inline');
  assert.equal(local.action.id, 'edit_key');
  assert.equal(local.automaticRetry, false);
  const cloud = presentation({code:'unauthorized'}, {mode:'cloud',stage:'conversation'});
  assert.equal(cloud.placement, 'banner');
  assert.equal(cloud.action.id, 'reauthenticate');
  assert.equal(cloud.preserveDraft, true);
});
test('stale discovery completion cannot raise a new visible error', () => {
  const result = presentation({code:'stale_discovery'});
  assert.equal(result.placement, 'none');
  assert.equal(result.action, null);
});
test('mode-specific recovery never creates a paid agent or requests irrelevant credentials', () => {
  assert.equal(presentation({code:'no_agents'}, {mode:'cloud',stage:'setup'}).action.id, 'choose_mode');
  assert.equal(presentation({code:'no_agents'}, {mode:'cloud',stage:'setup'}).placement, 'empty');
  assert.equal(presentation({code:'unauthorized'}, {mode:'ssh',stage:'setup',authTarget:'ssh'}).action.id, 'edit_ssh_credentials');
  assert.equal(presentation({code:'unauthorized'}, {mode:'ssh',stage:'setup'}).action.id, 'reauthenticate');
  assert.equal(presentation({code:'quota_exceeded'}, {mode:'local',stage:'conversation'}).action.id, 'check_provider');
  assert.equal(presentation({code:'permission_denied'}, {mode:'local',stage:'conversation'}).action.id, 'review_permissions');
});
test('a changed SSH identity requires explicit verification, not a retry', () => {
  const result = presentation({code:'host_key_changed'}, {mode:'ssh',stage:'setup'});
  assert.equal(result.placement, 'dialog');
  assert.equal(result.action.id, 'verify_identity');
  assert.equal(result.announcement, 'assertive');
  assert.equal(result.automaticRetry, false);
});
test('remote error details never become text, translation keys or actions', () => {
  for (const code of ['unauthorized','__proto__','constructor','secret-token-private-url',null]) {
    const result = presentation({code,message:'PRIVATE_BODY',url:'PRIVATE_URL',token:'PRIVATE_TOKEN',cause:'PRIVATE_CAUSE'});
    const serialized = JSON.stringify(result);
    assert.equal(/PRIVATE|secret-token|__proto__|constructor/.test(serialized), false);
    assert.equal(result.preserveDraft, true);
    assert.equal(result.automaticRetry, false);
  }
});
test('connection failures give contextual recovery without modal spam', () => {
  const cases = [
    ['invalid_url','edit_url','inline'], ['invalid_options','inspect','screen'],
    ['invalid_input','edit_input','inline'], ['capabilities_required','check_connection','banner'],
    ['unsupported_capability','choose_mode','banner'], ['unsupported_runtime','update_app','screen'],
    ['forbidden','check_access','banner'], ['unsupported_transport','edit_url','banner'],
    ['conflict','check_status','banner'], ['session_not_found','open_conversations','banner'],
    ['http_error','check_connection','banner'], ['timeout','check_connection','banner'],
    ['unreachable','check_connection','banner'], ['response_too_large','check_connection','banner'],
    ['invalid_json','check_connection','banner'], ['invalid_contract','edit_url','banner'],
    ['insecure_auth','secure_connection','screen'], ['invalid_session_contract','check_connection','banner'],
  ];
  for (const [code,action,placement] of cases) {
    const result = presentation({code}, {mode:'instance',stage:'setup'});
    assert.equal(result.titleKey, `errors.${code}.title`, code);
    assert.equal(result.action.id, action, code);
    assert.equal(result.placement, placement, code);
    assert.equal(result.automaticRetry, false);
  }
  assert.equal(presentation({code:'unreachable'}, {stage:'launch'}).placement, 'screen');
});
test('wire errors have explicit classifications and security outranks uncertainty', () => {
  for (const code of ['redirect_blocked','frame_too_large']) {
    const result = presentation({code});
    assert.equal(result.titleKey, `errors.${code}.title`);
    assert.equal(result.action.id, 'check_connection');
  }
  const result = presentation({code:'insecure_auth'}, {delivery:'unknown',stage:'conversation'});
  assert.equal(result.action.id, 'secure_connection');
  assert.equal(result.placement, 'screen');
  assert.equal(result.announcement, 'assertive');
  assert.equal(result.automaticRetry, false);
});
test('a write with unknown acknowledgement never offers blind resend', () => {
  for (const code of ['timeout','unreachable','http_error','unknown_future_error']) {
    const result = presentation({code}, {mode:'instance',stage:'conversation',delivery:'unknown'});
    assert.equal(result.placement, 'message');
    assert.equal(result.messageKey, 'errors.unconfirmed.message');
    assert.equal(result.action.id, 'check_status');
    assert.equal(result.automaticRetry, false);
  }
});
