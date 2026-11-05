import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const shell = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/sh';
const enabled = fs.existsSync(shell);

function fixture(t) {
  fs.mkdirSync(path.join(root, 'work'), { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, 'work', 'backup-contract-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const bin = path.join(directory, 'bin'); fs.mkdirSync(bin);
  const log = path.join(directory, 'docker.log');
  const envFile = path.join(directory, 'fixture.env'); fs.writeFileSync(envFile, 'FIXTURE=1\n');
  const posix = file => file.replaceAll('\\', '/').replace(/^([a-z]):\//i, (_, drive) => `/${drive.toLowerCase()}/`);
  // This is a command contract fixture, not an actual database/object-store test.
  fs.writeFileSync(path.join(bin, 'docker'), `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_DOCKER_LOG"
case " $* " in
  *' up --help '*) [ "$FAKE_DOCKER_MODE" = unsupported-compose ] || printf '%s\\n' '--no-deps --no-recreate --wait --wait-timeout';;
  *' create --no-deps '*) printf 'unknown flag: --no-deps\\n' >&2; exit 16;;
  *' ps --status running --services '*) printf 'api\\nworker\\nscheduler\\npostgres\\nminio\\n';;
  *' pg_dump '*) [ "$FAKE_DOCKER_MODE" != fail-dump ] || exit 7; printf 'fixture-database';;
  *' pg_restore '*) cat >/dev/null;;
  *'scripts/recovery-manifest.mjs capture '*) [ "$FAKE_DOCKER_MODE" != fail-manifest ] || exit 8; printf '{"format":"daylight-recovery-manifest-v1","tables":[],"sequences":[],"objects":[]}';;
  *'scripts/recovery-manifest.mjs verify '*) cat >/dev/null; [ "$FAKE_DOCKER_MODE" != fail-verify ] || exit 9; printf '{"ok":true}';;
  *' config --images '*) printf 'minio/minio:fixture\\npostgres:17\\n';;
  *' ps -aq minio '*) printf 'fixture-minio-id\\n';;
  *' inspect fixture-minio-id '*) printf 'minio/minio:fixture\\n';;
  *' label=com.docker.compose.project='*) [ "$FAKE_DOCKER_MODE" != existing-target ] || printf 'existing-resource\\n';;
  *' cp fixture-minio-id:/data/. - '*) printf 'fixture-cold-objects';;
  *' cp - '*) cat >/dev/null;;
esac
`, { mode: 0o755 });
  const env = { ...process.env, DAYLIGHT_ENV_FILE: posix(envFile), DAYLIGHT_PROJECT: 'fixture-source', FAKE_DOCKER_LOG: posix(log) };
  function run(script, argument, mode = '', project = 'fixture-source', activate = false) {
    // Set POSIX PATH inside sh so Git Bash and Linux both resolve the fixture before Docker.
    return spawnSync(shell, ['-c', 'PATH="$1:$PATH"; export PATH; if [ "$4" = activate ]; then sh "$2" --activate "$3"; else sh "$2" "$3"; fi', '--', posix(bin), posix(path.join(root, 'deploy', script)), posix(argument), activate ? 'activate' : ''], {
      cwd: root, env: { ...env, FAKE_DOCKER_MODE: mode, DAYLIGHT_PROJECT: project }, encoding: 'utf8', windowsHide: true, timeout: 20000,
    });
  }
  return { directory, run, log: () => fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '', clear: () => fs.writeFileSync(log, '') };
}

test('backup resumes only its original application roles and marks complete payloads', { skip: !enabled }, t => {
  const f = fixture(t);
  const result = f.run('backup.sh', path.join(f.directory, 'backups'));
  assert.equal(result.status, 0, result.stderr);
  const backup = path.join(f.directory, 'backups', fs.readdirSync(path.join(f.directory, 'backups'))[0]);
  assert.ok(fs.existsSync(path.join(backup, 'COMPLETE')));
  assert.match(f.log(), /stop -t 90 api scheduler worker\n/);
  assert.match(f.log(), /stop -t 90 minio\n/);
  assert.ok(f.log().indexOf('stop -t 90 api scheduler worker') < f.log().indexOf('stop -t 90 minio'));
  assert.match(f.log(), /up -d --no-deps --no-recreate --wait --wait-timeout 180 minio\n/);
  assert.match(f.log(), /up -d --no-deps --no-recreate --wait --wait-timeout 180 api scheduler worker\n/);
  assert.equal(fs.readFileSync(path.join(backup, 'COMPLETE'), 'utf8').trim(), 'daylight-compose-backup-v2');
  assert.equal(fs.readFileSync(path.join(backup, 'SHA256SUMS'), 'utf8').trim().split('\n').length, 5);
  assert.doesNotMatch(f.log(), /down|--volumes/);
});

test('a failed database dump resumes paused writers and never marks a backup complete', { skip: !enabled }, t => {
  const f = fixture(t);
  const result = f.run('backup.sh', path.join(f.directory, 'backups'), 'fail-dump');
  assert.equal(result.status, 7, result.stderr);
  assert.match(f.log(), /up -d --no-deps --no-recreate --wait --wait-timeout 180 minio\n/);
  assert.match(f.log(), /up -d --no-deps --no-recreate --wait --wait-timeout 180 api scheduler worker\n/);
  const backup = path.join(f.directory, 'backups', fs.readdirSync(path.join(f.directory, 'backups'))[0]);
  assert.equal(fs.existsSync(path.join(backup, 'COMPLETE')), false);
});

test('unsupported Compose health flags stop backup before any service is paused', { skip: !enabled }, t => {
  const f = fixture(t);
  const result = f.run('backup.sh', path.join(f.directory, 'backups'), 'unsupported-compose');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Compose up must support/);
  assert.doesNotMatch(f.log(), / stop | pg_dump |recovery-manifest.mjs/);
});

test('restore refuses any existing target before creating or changing its services', { skip: !enabled }, t => {
  const f = fixture(t);
  assert.equal(f.run('backup.sh', path.join(f.directory, 'backups')).status, 0);
  const backup = path.join(f.directory, 'backups', fs.readdirSync(path.join(f.directory, 'backups'))[0]);
  f.clear();
  const result = f.run('restore.sh', backup, 'existing-target', 'fixture-restore');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /already has containers or volumes/);
  assert.doesNotMatch(f.log(), /up -d|create minio|pg_restore| cp /);
});

test('restore rejects modified backup bytes before any Docker invocation', { skip: !enabled }, t => {
  const f = fixture(t);
  assert.equal(f.run('backup.sh', path.join(f.directory, 'backups')).status, 0);
  const backup = path.join(f.directory, 'backups', fs.readdirSync(path.join(f.directory, 'backups'))[0]);
  fs.appendFileSync(path.join(backup, 'database.dump'), 'tampered'); f.clear();
  assert.notEqual(f.run('restore.sh', backup, '', 'fixture-restore').status, 0);
  assert.equal(f.log(), '');
});

test('a verified backup restores and checks data while application roles remain stopped by default', { skip: !enabled }, t => {
  const f = fixture(t);
  assert.equal(f.run('backup.sh', path.join(f.directory, 'backups')).status, 0);
  const backup = path.join(f.directory, 'backups', fs.readdirSync(path.join(f.directory, 'backups'))[0]);
  f.clear();
  const result = f.run('restore.sh', backup, '', 'fixture-restore');
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(f.log(), /-p fixture-source|down|--volumes/);
  assert.match(f.log(), /pg_restore --exit-on-error/);
  assert.match(f.log(), /create minio\n/);
  assert.ok(f.log().indexOf('cp - fixture-minio-id:/data') < f.log().indexOf('recovery-manifest.mjs verify'));
  assert.doesNotMatch(f.log(), /up -d --wait --wait-timeout 600/);
});

test('a failed inventory capture resumes writers and leaves no completed backup', { skip: !enabled }, t => {
  const f = fixture(t);
  assert.equal(f.run('backup.sh', path.join(f.directory, 'backups'), 'fail-manifest').status, 8);
  const backup = path.join(f.directory, 'backups', fs.readdirSync(path.join(f.directory, 'backups'))[0]);
  assert.equal(fs.existsSync(path.join(backup, 'COMPLETE')), false);
  assert.match(f.log(), /up -d --no-deps --no-recreate --wait --wait-timeout 180 api scheduler worker/);
});

test('activation follows successful content verification and stops on verification failure', { skip: !enabled }, t => {
  const f = fixture(t);
  assert.equal(f.run('backup.sh', path.join(f.directory, 'backups')).status, 0);
  const backup = path.join(f.directory, 'backups', fs.readdirSync(path.join(f.directory, 'backups'))[0]);
  f.clear();
  assert.equal(f.run('restore.sh', backup, 'fail-verify', 'fixture-restore', true).status, 9);
  assert.doesNotMatch(f.log(), /up -d --wait --wait-timeout 600/);
  f.clear();
  assert.equal(f.run('restore.sh', backup, '', 'fixture-restore', true).status, 0);
  assert.ok(f.log().indexOf('recovery-manifest.mjs verify') < f.log().indexOf('up -d --wait --wait-timeout 600'));
});

test('legacy v1 backup remains importable without starting applications', { skip: !enabled }, t => {
  const f = fixture(t);
  assert.equal(f.run('backup.sh', path.join(f.directory, 'backups')).status, 0);
  const backup = path.join(f.directory, 'backups', fs.readdirSync(path.join(f.directory, 'backups'))[0]);
  const sums = fs.readFileSync(path.join(backup, 'SHA256SUMS'), 'utf8').split('\n').filter(line => !line.includes('recovery-manifest.json')).join('\n');
  fs.writeFileSync(path.join(backup, 'SHA256SUMS'), sums);
  fs.writeFileSync(path.join(backup, 'COMPLETE'), 'daylight-compose-backup-v1\n');
  f.clear();
  assert.equal(f.run('restore.sh', backup, '', 'fixture-restore').status, 0);
  assert.doesNotMatch(f.log(), /recovery-manifest.mjs verify|up -d --wait --wait-timeout 600/);
});
