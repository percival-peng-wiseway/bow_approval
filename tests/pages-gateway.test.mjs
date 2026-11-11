import test from 'node:test';
import assert from 'node:assert/strict';
import gateway from '../pages-gateway/public/_worker.js';
import { sameOrigin } from '../cloud/http.mjs';

test('old OA links redirect to the new hostname without forwarding mutations', async () => {
  const env = { BOW: { fetch() { assert.fail('Old hostname must not call backend'); } } };
  const response = await gateway.fetch(new Request('https://oa.wiseway.ai/?view=requests'), env);
  assert.equal(response.status, 308);
  assert.equal(response.headers.get('Location'), 'https://bowoa.wiseway.ai/?view=requests');
  assert.equal((await gateway.fetch(new Request('https://oa.wiseway.ai/api/auth/login', { method: 'POST' }), env)).status, 410);
});

test('Pages forwards original origin, private cookies and request body to BOW', async () => {
  const request = new Request('https://bowoa.wiseway.ai/api/auth/login', {
    method: 'POST', headers: { Origin: 'https://bowoa.wiseway.ai',
      'X-Requested-With': 'ApprovalWorkspace', 'Content-Type': 'application/json',
      Cookie: 'approval_session=test-token' }, body: '{"test":true}',
  });
  const response = await gateway.fetch(request, { BOW: { async fetch(forwarded) {
    assert.equal(forwarded, request);
    sameOrigin(forwarded);
    assert.equal(forwarded.headers.get('Cookie'), 'approval_session=test-token');
    assert.deepEqual(await forwarded.json(), { test: true });
    return new Response('ok', { headers: { 'Set-Cookie': 'approval_session=new; Secure; HttpOnly; Path=/', 'Cache-Control': 'no-store' } });
  } } });
  assert.match(response.headers.get('Set-Cookie'), /Secure; HttpOnly/);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('Pages does not rewrite a foreign Origin to bypass the backend CSRF check', async () => {
  const request = new Request('https://bowoa.wiseway.ai/api/workspace/command', {
    method: 'POST', headers: { Origin: 'https://untrusted.example',
      'X-Requested-With': 'ApprovalWorkspace', 'Content-Type': 'application/json' }, body: '{}',
  });
  await assert.rejects(gateway.fetch(request, { BOW: { fetch(forwarded) { sameOrigin(forwarded); } } }), { status: 403 });
});

test('Pages preserves private-file denial and does not expose production through preview hosts', async () => {
  const denied = await gateway.fetch(new Request('https://bow-oa.pages.dev/api/files/missing'), {
    BOW: { fetch: () => new Response('Sign in', { status: 401, headers: { 'Cache-Control': 'no-store' } }) },
  });
  assert.equal(denied.status, 401);
  const preview = await gateway.fetch(new Request('https://preview.bow-oa.pages.dev/'), {
    BOW: { fetch() { assert.fail('Preview must not call production'); } },
  });
  assert.equal(preview.status, 404);
  assert.equal((await gateway.fetch(new Request('https://bowoa.wiseway.ai/'), {})).status, 503);
});
