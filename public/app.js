(function () {
  const subtitleForm = document.getElementById('subtitle-form');
  const videoForm = document.getElementById('video-form');
  const subtitleStatus = document.getElementById('subtitle-status');
  const videoStatus = document.getElementById('video-status');
  const scriptDownload = document.getElementById('script-download');
  const transcriptDownload = document.getElementById('transcript-download');
  const segmentsDownload = document.getElementById('segments-download');
  const finalDownload = document.getElementById('final-download');
  const subtitleDownloads = document.getElementById('subtitle-downloads');
  const videoDownloads = document.getElementById('video-downloads');
  const videoSubmit = document.getElementById('video-submit');

  let currentJobId = null;
  let pollTimer = null;

  function setStatus(element, text, isError) {
    element.textContent = text;
    element.classList.remove('hidden');
    element.classList.toggle('error', Boolean(isError));
  }

  function clearPoll() {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  async function fetchJob(jobId) {
    const response = await fetch(`/api/jobs/${jobId}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to fetch job status.');
    }

    return data.job;
  }

  function updateUi(job) {
    if (!job) {
      return;
    }

    if (job.phase === 'subtitle' || job.completedPhases.subtitle) {
      setStatus(subtitleStatus, `${job.stage}: ${job.percent}% - ${job.message || job.status}`, job.status === 'failed');
    }

    if (job.completedPhases.subtitle && job.outputs.hasScriptSrt) {
      videoSubmit.disabled = false;
      scriptDownload.href = `/download/${job.id}/script`;
      if (job.outputs.hasTranscriptSrt) {
        transcriptDownload.href = `/download/${job.id}/transcript`;
        transcriptDownload.classList.remove('hidden');
      } else {
        transcriptDownload.classList.add('hidden');
      }
      subtitleDownloads.classList.remove('hidden');
    }

    if (job.phase === 'video' || job.completedPhases.video) {
      setStatus(videoStatus, `${job.stage}: ${job.percent}% - ${job.message || job.status}`, job.status === 'failed');
    }

    if (job.completedPhases.video && job.outputs.hasSegmentZip && job.outputs.hasFinalVideo) {
      segmentsDownload.href = `/download/${job.id}/segments`;
      finalDownload.href = `/download/${job.id}/final-video`;
      videoDownloads.classList.remove('hidden');
    }
  }

  async function pollJob(jobId) {
    clearPoll();

    try {
      const job = await fetchJob(jobId);
      updateUi(job);

      if (job.status === 'running' || job.stage === 'queued') {
        pollTimer = setTimeout(function () {
          pollJob(jobId);
        }, 1000);
      }
    } catch (error) {
      if (jobId === currentJobId) {
        setStatus(videoStatus, error.message, true);
      }
    }
  }

  subtitleForm.addEventListener('submit', async function (event) {
    event.preventDefault();
    clearPoll();
    subtitleDownloads.classList.add('hidden');
    videoDownloads.classList.add('hidden');
    videoSubmit.disabled = true;

    const formData = new FormData(subtitleForm);
    setStatus(subtitleStatus, 'Uploading subtitle inputs...', false);

    const response = await fetch('/api/jobs/subtitles', {
      method: 'POST',
      body: formData
    });
    const data = await response.json();

    if (!response.ok) {
      setStatus(subtitleStatus, data.error || 'Subtitle generation failed to start.', true);
      return;
    }

    currentJobId = data.job.id;
    updateUi(data.job);
    pollJob(currentJobId);
  });

  videoForm.addEventListener('submit', async function (event) {
    event.preventDefault();

    if (!currentJobId) {
      setStatus(videoStatus, 'Create subtitles first.', true);
      return;
    }

    clearPoll();
    videoDownloads.classList.add('hidden');
    const formData = new FormData(videoForm);
    setStatus(videoStatus, 'Uploading source videos...', false);

    const response = await fetch(`/api/jobs/${currentJobId}/videos`, {
      method: 'POST',
      body: formData
    });
    const data = await response.json();

    if (!response.ok) {
      setStatus(videoStatus, data.error || 'Video generation failed to start.', true);
      return;
    }

    updateUi(data.job);
    pollJob(currentJobId);
  });
}());
