const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { slugifyUsername } = require('../src/web/auth');
const { createApp } = require('../src/web/app');
const { createJobStore } = require('../src/web/job-store');
const { createJobWorkspace } = require('../src/web/workspace');

async function withTempDir(callback) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-ui-test-'));

  try {
    return await callback(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function withServer(app, callback) {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });

  try {
    const address = server.address();
    const baseUrl = `http://${address.address}:${address.port}`;
    return await callback(baseUrl);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

function createSubtitleForm(language = 'en') {
  const form = new FormData();
  form.append('audio', new Blob(['audio bytes']), 'sample.mp3');
  form.append('scriptJson', new Blob([JSON.stringify([{ text: 'Hello world' }])], { type: 'application/json' }), 'script.json');
  form.append('language', language);
  return form;
}

function createSubtitleTxtForm(language = 'en') {
  const form = new FormData();
  form.append('audio', new Blob(['audio bytes']), 'sample.mp3');
  form.append('scriptJson', new Blob(['Hello world\nSecond line\n'], { type: 'text/plain' }), 'script.txt');
  form.append('language', language);
  return form;
}

function createTranscriptOnlyForm() {
  const form = new FormData();
  form.append('scriptJson', new Blob([JSON.stringify([{ text: 'Hello world' }])], { type: 'application/json' }), 'script.json');
  form.append('transcriptSrt', new Blob(['1\n00:00:00,000 --> 00:00:01,000\nHello world\n']), 'script.whisper.srt');
  return form;
}

function createVideoForm() {
  const form = new FormData();
  form.append('videos', new Blob(['video one']), 'video-1.mp4');
  form.append('videos', new Blob(['video two']), 'video-2.mp4');
  return form;
}

function createStandaloneVideoForm() {
  const form = createVideoForm();
  form.append('scriptSrt', new Blob(['1\n00:00:00,000 --> 00:00:01,000\nHello world\n']), 'script.srt');
  return form;
}

async function login(baseUrl, username = 'Logan', password = 'Waebox2026@') {
  const response = await fetch(baseUrl + '/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ username, password }),
    redirect: 'manual'
  });

  return {
    response,
    cookie: response.headers.get('set-cookie')?.split(';')[0] || ''
  };
}

function withAuth(cookie) {
  return cookie ? { cookie } : {};
}

test('web UI root redirects unauthenticated users to login', async () => withTempDir(async (workspaceRoot) => {
  const app = createApp({
    workspaceRoot,
    jobStore: createJobStore(),
    jobRunner: {
      startSubtitleJob() {},
      startVideoJob() {}
    }
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(baseUrl + '/', { redirect: 'manual' });

    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/login');
  });
}));

test('login page renders allowed usernames', async () => withTempDir(async (workspaceRoot) => {
  const app = createApp({
    workspaceRoot,
    jobStore: createJobStore(),
    jobRunner: {
      startSubtitleJob() {},
      startVideoJob() {}
    }
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(baseUrl + '/login');
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(body, /Sign in/);
    assert.match(body, /<option value="Logan"/);
  });
}));

test('login rejects invalid credentials', async () => withTempDir(async (workspaceRoot) => {
  const app = createApp({
    workspaceRoot,
    jobStore: createJobStore(),
    jobRunner: {
      startSubtitleJob() {},
      startVideoJob() {}
    }
  });

  await withServer(app, async (baseUrl) => {
    const { response } = await login(baseUrl, 'Logan', 'wrong-password');
    const body = await response.text();

    assert.equal(response.status, 401);
    assert.match(body, /Invalid username or password/i);
  });
}));

test('login succeeds and renders the main page', async () => withTempDir(async (workspaceRoot) => {
  const app = createApp({
    workspaceRoot,
    jobStore: createJobStore(),
    jobRunner: {
      startSubtitleJob() {},
      startVideoJob() {}
    }
  });

  await withServer(app, async (baseUrl) => {
    const { response, cookie } = await login(baseUrl);

    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/');
    assert.ok(cookie);

    const pageResponse = await fetch(baseUrl + '/', {
      headers: withAuth(cookie)
    });
    const body = await pageResponse.text();

    assert.equal(pageResponse.status, 200);
    assert.match(body, /User: Logan/);
  });
}));

test('logout clears the session and returns the user to login', async () => withTempDir(async (workspaceRoot) => {
  const app = createApp({
    workspaceRoot,
    jobStore: createJobStore(),
    jobRunner: {
      startSubtitleJob() {},
      startVideoJob() {}
    }
  });

  await withServer(app, async (baseUrl) => {
    const { cookie } = await login(baseUrl);

    const logoutResponse = await fetch(baseUrl + '/logout', {
      method: 'POST',
      headers: withAuth(cookie),
      redirect: 'manual'
    });

    assert.equal(logoutResponse.status, 302);
    assert.equal(logoutResponse.headers.get('location'), '/login');

    const pageResponse = await fetch(baseUrl + '/', {
      headers: withAuth(cookie),
      redirect: 'manual'
    });

    assert.equal(pageResponse.status, 302);
    assert.equal(pageResponse.headers.get('location'), '/login');
  });
}));

test('protected APIs reject unauthenticated access', async () => withTempDir(async (workspaceRoot) => {
  const app = createApp({
    workspaceRoot,
    jobStore: createJobStore(),
    jobRunner: {
      startSubtitleJob() {},
      startVideoJob() {}
    }
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(baseUrl + '/api/jobs/missing');
    const data = await response.json();

    assert.equal(response.status, 401);
    assert.match(data.error, /Authentication required/i);
  });
}));

test('web UI exposes a downloadable script.json example after login', async () => withTempDir(async (workspaceRoot) => {
  const app = createApp({
    workspaceRoot,
    jobStore: createJobStore(),
    jobRunner: {
      startSubtitleJob() {},
      startVideoJob() {}
    }
  });

  await withServer(app, async (baseUrl) => {
    const { cookie } = await login(baseUrl);
    const response = await fetch(baseUrl + '/download/script-json-example', {
      headers: withAuth(cookie)
    });
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /application\/json/i);
    assert.match(body, /"text": "First subtitle text\."|\"text\": \"First subtitle text\.\"/);
  });
}));

test('subtitle route rejects missing required files', async () => withTempDir(async (workspaceRoot) => {
  const app = createApp({
    workspaceRoot,
    jobStore: createJobStore(),
    jobRunner: {
      startSubtitleJob() {},
      startVideoJob() {}
    }
  });

  await withServer(app, async (baseUrl) => {
    const { cookie } = await login(baseUrl);
    const form = new FormData();
    form.append('audio', new Blob(['audio bytes']), 'sample.mp3');

    const response = await fetch(baseUrl + '/api/jobs/subtitles', {
      method: 'POST',
      body: form,
      headers: withAuth(cookie)
    });
    const data = await response.json();

    assert.equal(response.status, 400);
    assert.match(data.error, /scriptJson and either audio or transcriptSrt are required/);
  });
}));

test('subtitle route starts a job, exposes status, and allows script download', async () => withTempDir(async (workspaceRoot) => {
  const jobStore = createJobStore();
  const app = createApp({
    workspaceRoot,
    jobStore,
    jobRunner: {
      startSubtitleJob(job, payload) {
        assert.equal(payload.language, 'en');
        assert.equal(job.ownerUsername, 'Logan');
        assert.match(payload.workspace.root, new RegExp(`\\\\${slugifyUsername('Logan')}\\\\jobs\\\\`));
        fs.writeFileSync(path.join(payload.workspace.outputs, 'script.whisper.srt'), '1\n00:00:00,000 --> 00:00:01,000\nHello world\n');
        fs.writeFileSync(path.join(payload.workspace.outputs, 'script.srt'), '1\n00:00:00,000 --> 00:00:01,000\nHello world\n');
        jobStore.markCompleted(job.id, 'subtitle', {
          transcriptSrt: path.join(payload.workspace.outputs, 'script.whisper.srt'),
          scriptSrt: path.join(payload.workspace.outputs, 'script.srt')
        }, {
          phase: 'subtitle',
          message: 'Subtitle generation complete'
        });
      },
      startVideoJob() {}
    }
  });

  await withServer(app, async (baseUrl) => {
    const { cookie } = await login(baseUrl);
    const response = await fetch(baseUrl + '/api/jobs/subtitles', {
      method: 'POST',
      body: createSubtitleForm(),
      headers: withAuth(cookie)
    });
    const data = await response.json();

    assert.equal(response.status, 202);
    assert.equal(data.job.completedPhases.subtitle, true);
    assert.match(data.job.folderName, /^\d{8}-\d{6}-/);

    const statusResponse = await fetch(baseUrl + `/api/jobs/${data.job.id}`, {
      headers: withAuth(cookie)
    });
    const statusData = await statusResponse.json();
    assert.equal(statusResponse.status, 200);
    assert.equal(statusData.job.outputs.hasScriptSrt, true);
    assert.equal(statusData.job.folderName, data.job.folderName);

    const downloadResponse = await fetch(baseUrl + `/download/${data.job.id}/script`, {
      headers: withAuth(cookie)
    });
    const downloadBody = await downloadResponse.text();
    assert.equal(downloadResponse.status, 200);
    assert.match(downloadBody, /Hello world/);

    const transcriptResponse = await fetch(baseUrl + `/download/${data.job.id}/transcript`, {
      headers: withAuth(cookie)
    });
    assert.equal(transcriptResponse.status, 200);
    assert.match(await transcriptResponse.text(), /Hello world/);
  });
}));

test('subtitle route rejects unsupported language selection', async () => withTempDir(async (workspaceRoot) => {
  const app = createApp({
    workspaceRoot,
    jobStore: createJobStore(),
    jobRunner: {
      startSubtitleJob() {},
      startVideoJob() {}
    }
  });

  await withServer(app, async (baseUrl) => {
    const { cookie } = await login(baseUrl);
    const response = await fetch(baseUrl + '/api/jobs/subtitles', {
      method: 'POST',
      body: createSubtitleForm('jp'),
      headers: withAuth(cookie)
    });
    const data = await response.json();

    assert.equal(response.status, 400);
    assert.match(data.error, /language must be one of: auto, en, vi/i);
  });
}));

test('subtitle route accepts uploaded .txt script files', async () => withTempDir(async (workspaceRoot) => {
  const jobStore = createJobStore();
  const app = createApp({
    workspaceRoot,
    jobStore,
    jobRunner: {
      startSubtitleJob(job, payload) {
        assert.equal(payload.language, 'en');
        assert.match(payload.jsonPath, /script\.txt$/);
        fs.writeFileSync(path.join(payload.workspace.outputs, 'script.whisper.srt'), '1\n00:00:00,000 --> 00:00:01,000\nHello world\n');
        fs.writeFileSync(path.join(payload.workspace.outputs, 'script.srt'), '1\n00:00:00,000 --> 00:00:01,000\nHello world\n');
        jobStore.markCompleted(job.id, 'subtitle', {
          transcriptSrt: path.join(payload.workspace.outputs, 'script.whisper.srt'),
          scriptSrt: path.join(payload.workspace.outputs, 'script.srt')
        }, {
          phase: 'subtitle',
          message: 'Subtitle generation complete'
        });
      },
      startVideoJob() {}
    }
  });

  await withServer(app, async (baseUrl) => {
    const { cookie } = await login(baseUrl);
    const response = await fetch(baseUrl + '/api/jobs/subtitles', {
      method: 'POST',
      body: createSubtitleTxtForm(),
      headers: withAuth(cookie)
    });
    const data = await response.json();

    assert.equal(response.status, 202);
    assert.equal(data.job.completedPhases.subtitle, true);
  });
}));

test('subtitle route rejects unsupported script file types', async () => withTempDir(async (workspaceRoot) => {
  const app = createApp({
    workspaceRoot,
    jobStore: createJobStore(),
    jobRunner: {
      startSubtitleJob() {},
      startVideoJob() {}
    }
  });

  await withServer(app, async (baseUrl) => {
    const { cookie } = await login(baseUrl);
    const form = new FormData();
    form.append('audio', new Blob(['audio bytes']), 'sample.mp3');
    form.append('scriptJson', new Blob(['hello'], { type: 'text/csv' }), 'script.csv');

    const response = await fetch(baseUrl + '/api/jobs/subtitles', {
      method: 'POST',
      body: form,
      headers: withAuth(cookie)
    });
    const data = await response.json();

    assert.equal(response.status, 400);
    assert.match(data.error, /\.json or \.txt/i);
  });
}));

test('subtitle route accepts uploaded transcript and skips audio upload', async () => withTempDir(async (workspaceRoot) => {
  const jobStore = createJobStore();
  const app = createApp({
    workspaceRoot,
    jobStore,
    jobRunner: {
      startSubtitleJob(job, payload) {
        assert.equal(Boolean(payload.audioPath), false);
        assert.match(payload.transcriptPath, /script\.whisper\.srt$/);
        fs.writeFileSync(path.join(payload.workspace.outputs, 'script.srt'), '1\n00:00:00,000 --> 00:00:01,000\nHello world\n');
        jobStore.markCompleted(job.id, 'subtitle', {
          transcriptSrt: payload.transcriptPath,
          scriptSrt: path.join(payload.workspace.outputs, 'script.srt')
        }, {
          phase: 'subtitle',
          message: 'Subtitle generation complete'
        });
      },
      startVideoJob() {}
    }
  });

  await withServer(app, async (baseUrl) => {
    const { cookie } = await login(baseUrl);
    const response = await fetch(baseUrl + '/api/jobs/subtitles', {
      method: 'POST',
      body: createTranscriptOnlyForm(),
      headers: withAuth(cookie)
    });
    const data = await response.json();

    assert.equal(response.status, 202);
    assert.equal(data.job.completedPhases.subtitle, true);

    const transcriptResponse = await fetch(baseUrl + `/download/${data.job.id}/transcript`, {
      headers: withAuth(cookie)
    });
    assert.equal(transcriptResponse.status, 200);
    assert.match(await transcriptResponse.text(), /Hello world/);
  });
}));

test('video route rejects generation before subtitle success', async () => withTempDir(async (workspaceRoot) => {
  const jobStore = createJobStore();
  const job = jobStore.create({
    ownerUsername: 'Logan',
    ownerKey: slugifyUsername('Logan'),
    workspace: createJobWorkspace('job-pre-video', workspaceRoot, {
      username: slugifyUsername('Logan')
    })
  });

  const app = createApp({
    workspaceRoot,
    jobStore,
    jobRunner: {
      startSubtitleJob() {},
      startVideoJob() {}
    }
  });

  await withServer(app, async (baseUrl) => {
    const { cookie } = await login(baseUrl);
    const response = await fetch(baseUrl + `/api/jobs/${job.id}/videos`, {
      method: 'POST',
      body: createVideoForm(),
      headers: withAuth(cookie)
    });
    const data = await response.json();

    assert.equal(response.status, 400);
    assert.match(data.error, /Subtitle generation must complete successfully/);
  });
}));

test('video route starts a job and exposes segment and final video downloads', async () => withTempDir(async (workspaceRoot) => {
  const jobStore = createJobStore();
  const workspace = createJobWorkspace('job-video-ready', workspaceRoot, {
    username: slugifyUsername('Logan')
  });
  const job = jobStore.create({
    ownerUsername: 'Logan',
    ownerKey: slugifyUsername('Logan'),
    folderName: workspace.folderName,
    workspace,
    outputs: {
      scriptSrt: path.join(workspace.outputs, 'script.srt')
    }
  });

  fs.writeFileSync(job.outputs.scriptSrt, '1\n00:00:00,000 --> 00:00:01,000\nHello world\n');
  jobStore.markCompleted(job.id, 'subtitle', {
    scriptSrt: job.outputs.scriptSrt
  }, {
    phase: 'subtitle',
    message: 'Subtitle generation complete'
  });

  const app = createApp({
    workspaceRoot,
    jobStore,
    jobRunner: {
      startSubtitleJob() {},
      startVideoJob(currentJob, payload) {
        const segmentZip = path.join(payload.workspace.outputs, 'segments.zip');
        const finalVideo = path.join(payload.workspace.outputs, 'final-video.mp4');
        fs.writeFileSync(segmentZip, 'zip bytes');
        fs.writeFileSync(finalVideo, 'video bytes');
        jobStore.markCompleted(currentJob.id, 'video', {
          segmentZip,
          finalVideo,
          segmentsDir: payload.workspace.segments
        }, {
          phase: 'video',
          message: 'Video generation complete'
        });
      }
    }
  });

  await withServer(app, async (baseUrl) => {
    const { cookie } = await login(baseUrl);
    const response = await fetch(baseUrl + `/api/jobs/${job.id}/videos`, {
      method: 'POST',
      body: createVideoForm(),
      headers: withAuth(cookie)
    });
    const data = await response.json();

    assert.equal(response.status, 202);
    assert.equal(data.job.completedPhases.video, true);

    const zipResponse = await fetch(baseUrl + `/download/${job.id}/segments`, {
      headers: withAuth(cookie)
    });
    assert.equal(zipResponse.status, 200);
    assert.equal(await zipResponse.text(), 'zip bytes');

    const finalResponse = await fetch(baseUrl + `/download/${job.id}/final-video`, {
      headers: withAuth(cookie)
    });
    assert.equal(finalResponse.status, 200);
    assert.equal(await finalResponse.text(), 'video bytes');
  });
}));

test('standalone video route accepts uploaded script.srt and starts a fresh video job', async () => withTempDir(async (workspaceRoot) => {
  const jobStore = createJobStore();
  const app = createApp({
    workspaceRoot,
    jobStore,
    jobRunner: {
      startSubtitleJob() {},
      startVideoJob(currentJob, payload) {
        assert.match(payload.scriptSrtPath, /script\.srt$/);
        const segmentZip = path.join(payload.workspace.outputs, 'segments.zip');
        const finalVideo = path.join(payload.workspace.outputs, 'final-video.mp4');
        fs.writeFileSync(segmentZip, 'zip bytes');
        fs.writeFileSync(finalVideo, 'video bytes');
        jobStore.markCompleted(currentJob.id, 'video', {
          segmentZip,
          finalVideo,
          segmentsDir: payload.workspace.segments
        }, {
          phase: 'video',
          message: 'Video generation complete'
        });
      }
    }
  });

  await withServer(app, async (baseUrl) => {
    const { cookie } = await login(baseUrl);
    const response = await fetch(baseUrl + '/api/jobs/videos', {
      method: 'POST',
      body: createStandaloneVideoForm(),
      headers: withAuth(cookie)
    });
    const data = await response.json();

    assert.equal(response.status, 202);
    assert.equal(data.job.completedPhases.subtitle, true);
    assert.equal(data.job.completedPhases.video, true);
    assert.match(data.job.folderName, /^\d{8}-\d{6}-/);

    const finalResponse = await fetch(baseUrl + `/download/${data.job.id}/final-video`, {
      headers: withAuth(cookie)
    });
    assert.equal(finalResponse.status, 200);
    assert.equal(await finalResponse.text(), 'video bytes');
  });
}));

test('standalone video route rejects missing script.srt upload', async () => withTempDir(async (workspaceRoot) => {
  const app = createApp({
    workspaceRoot,
    jobStore: createJobStore(),
    jobRunner: {
      startSubtitleJob() {},
      startVideoJob() {}
    }
  });

  await withServer(app, async (baseUrl) => {
    const { cookie } = await login(baseUrl);
    const response = await fetch(baseUrl + '/api/jobs/videos', {
      method: 'POST',
      body: createVideoForm(),
      headers: withAuth(cookie)
    });
    const data = await response.json();

    assert.equal(response.status, 400);
    assert.match(data.error, /scriptSrt is required/i);
  });
}));

test('job status is isolated by authenticated username', async () => withTempDir(async (workspaceRoot) => {
  const jobStore = createJobStore();
  const app = createApp({
    workspaceRoot,
    jobStore,
    jobRunner: {
      startSubtitleJob(currentJob, payload) {
        fs.writeFileSync(path.join(payload.workspace.outputs, 'script.srt'), '1\n00:00:00,000 --> 00:00:01,000\nHello world\n');
        jobStore.markCompleted(currentJob.id, 'subtitle', {
          scriptSrt: path.join(payload.workspace.outputs, 'script.srt')
        });
      },
      startVideoJob() {}
    }
  });

  await withServer(app, async (baseUrl) => {
    const { cookie: loganCookie } = await login(baseUrl, 'Logan');
    const { cookie: sangCookie } = await login(baseUrl, 'Sang');

    const createResponse = await fetch(baseUrl + '/api/jobs/subtitles', {
      method: 'POST',
      body: createTranscriptOnlyForm(),
      headers: withAuth(loganCookie)
    });
    const createData = await createResponse.json();

    assert.equal(createResponse.status, 202);

    const deniedResponse = await fetch(baseUrl + `/api/jobs/${createData.job.id}`, {
      headers: withAuth(sangCookie)
    });
    const deniedData = await deniedResponse.json();

    assert.equal(deniedResponse.status, 403);
    assert.match(deniedData.error, /Access denied/i);
  });
}));
