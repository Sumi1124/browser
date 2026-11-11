import test from 'node:test';
import assert from 'node:assert/strict';
import {validateProviderConfig, redactSensitive, prepareRequest, buildPayload, ConsentBroker, labelGeneratedText,
  ACADEMIC_NOTICE} from '../aster/ai/consent.mjs';
import {createBackup, readBackup, planRetention, backupFileName, BACKUP_VERSION} from '../aster/storage/backup.mjs';
import {ResearchLibrary} from '../aster/research/library.mjs';
import {Planner} from '../aster/study/planner.mjs';
import {FlashcardCollection} from '../aster/study/flashcards.mjs';

const provider = {id: 'claude', name: 'Example AI', endpoint: 'https://api.example.com/v1/messages', model: 'model-1',
  credential: {keychainRef: 'aster-ai/claude'}};

test('provider configuration never holds secrets', () => {
  assert.equal(validateProviderConfig(provider).endpoint, 'https://api.example.com/v1/messages');
  assert.throws(() => validateProviderConfig({...provider, endpoint: 'http://api.example.com'}), /HTTPS/);
  assert.throws(() => validateProviderConfig({...provider, endpoint: 'https://u:p@api.example.com'}), /HTTPS/);
  assert.throws(() => validateProviderConfig({...provider, endpoint: 'https://api.example.com/?api_key=abc'}), /keychain/);
  assert.throws(() => validateProviderConfig({...provider, credential: 'sk-live-123'}), /keychain reference/);
  assert.throws(() => validateProviderConfig({...provider, credential: {keychainRef: 'aster-ai/x', value: 'secret'}}), /keychain reference/);
});

test('redaction removes keys and contact details but keeps ordinary numbers', () => {
  const input = 'Mail ada@example.com or call +44 20 7946 0958. Key sk-abcdefghijklmnopqrstu. Card 4111 1111 1111 1111. '
    + 'Order 1234 5678 9012 3456. Date 2026-11-11 10:30. Population 8,000,000.';
  const {text, redactions} = redactSensitive(input);
  assert.ok(!text.includes('ada@example.com'));
  assert.ok(!text.includes('sk-abc'));
  assert.ok(!text.includes('4111 1111'));
  assert.ok(!text.includes('7946'));
  assert.ok(text.includes('1234 5678 9012 3456'), 'non-Luhn number kept');
  assert.ok(text.includes('2026-11-11 10:30'));
  assert.ok(text.includes('8,000,000'));
  assert.deepEqual(redactions.map(item => item.kind).sort(), ['api_key', 'card_number', 'email', 'phone']);
});

test('consent is bound to the exact previewed payload, single use and short lived', async () => {
  let now = Date.parse('2026-11-11T12:00:00Z');
  const broker = new ConsentBroker({now: () => now, ttlMs: 60000});
  const request = {requestId: 'r1', provider, purpose: 'feedback', instructions: 'Check my thesis statement.',
    items: [{label: 'Draft', text: 'My thesis... email me at kid@school.org', origin: 'https://docs.example.com/d/1'}]};
  await assert.rejects(prepareRequest({...request, offTheRecord: true}), /private windows/);
  const preview = await prepareRequest(request);
  assert.equal(preview.provider.host, 'api.example.com');
  assert.ok(!preview.items[0].text.includes('kid@school.org'));
  assert.equal(preview.items[0].origin, 'https://docs.example.com');
  assert.ok(preview.warnings.includes(ACADEMIC_NOTICE));
  assert.ok(!JSON.stringify(preview).includes('aster-ai/claude'), 'credential reference is not part of the preview');
  const payload = buildPayload(preview);
  const grant = broker.approve(preview);
  await assert.rejects(broker.authorizeSend(grant.grantId, {...payload, instructions: 'Write my essay.'}), /changed after consent/);
  // A rejected attempt consumes the grant.
  await assert.rejects(broker.authorizeSend(grant.grantId, payload), /No consent/);
  const second = broker.approve(preview);
  assert.deepEqual(await broker.authorizeSend(second.grantId, structuredClone(payload)), {requestId: 'r1'});
  await assert.rejects(broker.authorizeSend(second.grantId, payload), /No consent/);
  const third = broker.approve(preview);
  now += 61000;
  await assert.rejects(broker.authorizeSend(third.grantId, payload), /expired/);
  broker.deny(preview);
  assert.deepEqual(broker.log.map(entry => entry.decision), ['approved', 'approved', 'approved', 'denied']);
  assert.ok(!JSON.stringify(broker.log).includes('thesis'), 'log holds no content');
  const labelled = labelGeneratedText('Consider narrowing the claim.', {provider: 'Example AI', model: 'model-1', generatedAt: '2026-11-11T12:00:00Z'});
  assert.equal(labelled.provenance.generatedBy, 'ai');
});

async function sampleModules() {
  const library = new ResearchLibrary();
  library.addSource({id: 's1', metadata: {title: 'Railways and trade in 1850', doi: '10.1234/x'}, addedAt: '2026-11-11T10:00:00Z'});
  const planner = new Planner();
  planner.add({id: 't1', title: 'Read', due: '2026-11-12', recurrence: {freq: 'weekly'}});
  const cards = new FlashcardCollection();
  cards.add({id: 'c1', front: 'Q', back: 'A', created: '2026-11-11'});
  return {library, planner, flashcards: cards};
}

test('backups round-trip, detect tampering and refuse newer formats', async () => {
  const modules = await sampleModules();
  const text = await createBackup({modules, createdAt: '2026-11-11T12:00:00Z', appVersion: '0.2.0', label: 'Before exams'});
  const restored = await readBackup(text);
  assert.equal(restored.migratedFrom, null);
  assert.equal(restored.label, 'Before exams');
  assert.deepEqual(restored.modules.library.toJSON(), modules.library.toJSON());
  assert.deepEqual(restored.modules.planner.toJSON(), modules.planner.toJSON());
  assert.deepEqual(restored.modules.flashcards.toJSON(), modules.flashcards.toJSON());
  const tampered = JSON.parse(text);
  tampered.modules.planner.tasks[0].title = 'Changed';
  await assert.rejects(readBackup(JSON.stringify(tampered)), /damaged or was modified/);
  const reordered = JSON.parse(text);
  await assert.doesNotReject(readBackup(JSON.stringify({checksum: reordered.checksum, ...reordered})));
  await assert.rejects(readBackup(text, {currentVersion: 0}), /newer version/);
  await assert.rejects(readBackup('{"format":"other"}'), /Not an Aster backup/);
  await assert.rejects(readBackup('not json'), /valid JSON/);
  await assert.rejects(createBackup({modules: {planner: {tasks: []}}, createdAt: '2026-11-11T12:00:00Z', appVersion: '0.2.0'}), /schema/);
  assert.equal(backupFileName('2026-11-11T12:00:00Z'), 'aster-backup-20261111T120000Z.json');
});

test('backup migrations run in order and unknown modules are preserved', async () => {
  const text = await createBackup({modules: {planner: new Planner(), notes: {schema: 3, items: ['x']}},
    createdAt: '2026-11-11T12:00:00Z', appVersion: '0.2.0'});
  const migrations = [{from: BACKUP_VERSION, to: BACKUP_VERSION + 1, migrate(envelope) {
    envelope.version += 1;
    envelope.modules.planner.tasks.push({id: 'm', title: 'Migrated', due: '2026-12-01'});
    return envelope;
  }}];
  const result = await readBackup(text, {migrations, currentVersion: BACKUP_VERSION + 1});
  assert.equal(result.migratedFrom, BACKUP_VERSION);
  assert.equal(result.modules.planner.get('m').title, 'Migrated');
  assert.deepEqual(result.unknownModules, {notes: {schema: 3, items: ['x']}});
  assert.equal(result.warnings.length, 1);
  await assert.rejects(readBackup(text, {currentVersion: BACKUP_VERSION + 1}), /No migration/);
});

test('retention keeps recent, daily, weekly and monthly backups', () => {
  const backups = [];
  for (let day = 0; day < 90; day++) {
    for (const hour of ['08', '20']) {
      const date = new Date(Date.UTC(2026, 7, 14 + day));
      backups.push({id: `${date.toISOString().slice(0, 10)}T${hour}`, createdAt: `${date.toISOString().slice(0, 10)}T${hour}:00:00Z`});
    }
  }
  const {keep, remove} = planRetention(backups, {keepLast: 3, keepDaily: 4, keepWeekly: 3, keepMonthly: 3});
  assert.equal(keep.length + remove.length, backups.length);
  assert.deepEqual(keep.slice(0, 5), ['2026-11-11T20', '2026-11-11T08', '2026-11-10T20', '2026-11-09T20', '2026-11-08T20']);
  assert.ok(keep.includes('2026-11-01T20'), 'newest backup of the previous ISO week (Mon 26 Oct – Sun 1 Nov)');
  assert.ok(keep.includes('2026-10-31T20'), 'newest backup of October');
  assert.ok(keep.includes('2026-09-30T20'), 'newest backup of September');
  assert.equal(keep.length, 8);
  assert.throws(() => planRetention(backups, {keepLast: 0, keepDaily: 0, keepWeekly: 0, keepMonthly: 0}), /every backup/);
  assert.throws(() => planRetention([{id: 'a', createdAt: 'yesterday'}]), /createdAt/);
});
