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
  const subtitleProgressBar = document.getElementById('subtitle-progress-bar');
  const videoProgressBar = document.getElementById('video-progress-bar');
  const subtitleProgressText = document.getElementById('subtitle-progress-text');
  const videoProgressText = document.getElementById('video-progress-text');
  const subtitlePhasePill = document.getElementById('subtitle-phase-pill');
  const videoPhasePill = document.getElementById('video-phase-pill');
  const subtitleJobFolder = document.getElementById('subtitle-job-folder');
  const videoJobFolder = document.getElementById('video-job-folder');

  let currentJobId = null;
  let pollTimer = null;

  function setStatus(element, text, isError) {
    element.textContent = text;
    element.classList.remove('hidden');
    element.classList.toggle('error', Boolean(isError));
  }

  function setProgress(progressBar, progressText, phasePill, percent, message, status) {
    const normalizedPercent = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
    progressBar.style.width = normalizedPercent + '%';
    progressText.textContent = message;

    phasePill.textContent = status;
    phasePill.classList.remove('running', 'success', 'error');

    if (status === 'failed') {
      phasePill.classList.add('error');
    } else if (status === 'completed') {
      phasePill.classList.add('success');
    } else if (status === 'running') {
      phasePill.classList.add('running');
    }
  }

  function setJobFolder(element, folderName) {
    if (!folderName) {
      element.textContent = '';
      element.classList.add('hidden');
      return;
    }

    element.textContent = `Job folder: ${folderName}`;
    element.classList.remove('hidden');
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
      const subtitleStatusText = `${job.stage}: ${job.percent}%${job.message ? ` - ${job.message}` : ''}`;
      setStatus(subtitleStatus, subtitleStatusText, job.status === 'failed');
      setJobFolder(subtitleJobFolder, job.folderName);
      setProgress(
        subtitleProgressBar,
        subtitleProgressText,
        subtitlePhasePill,
        job.percent,
        job.message || 'Subtitle job in progress.',
        job.completedPhases.subtitle ? 'completed' : job.status
      );
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
      if (job.phase !== 'video' && !job.completedPhases.video) {
        setProgress(
          videoProgressBar,
          videoProgressText,
          videoPhasePill,
          0,
          'Subtitle output ready. Upload videos to start the next stage.',
          'ready'
        );
      }
    }

    if (job.phase === 'video' || job.completedPhases.video) {
      const videoStatusText = `${job.stage}: ${job.percent}%${job.message ? ` - ${job.message}` : ''}`;
      setStatus(videoStatus, videoStatusText, job.status === 'failed');
      setJobFolder(videoJobFolder, job.folderName);
      setProgress(
        videoProgressBar,
        videoProgressText,
        videoPhasePill,
        job.percent,
        job.message || 'Video job in progress.',
        job.completedPhases.video ? 'completed' : job.status
      );
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
        }, 2500);
      }
    } catch (error) {
      if (jobId === currentJobId) {
        setStatus(videoStatus, error.message, true);
        setProgress(videoProgressBar, videoProgressText, videoPhasePill, 0, error.message, 'failed');
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
    setProgress(subtitleProgressBar, subtitleProgressText, subtitlePhasePill, 4, 'Uploading subtitle inputs...', 'running');
    setProgress(videoProgressBar, videoProgressText, videoPhasePill, 0, 'Waiting for subtitle output.', 'locked');

    const response = await fetch('/api/jobs/subtitles', {
      method: 'POST',
      body: formData
    });
    const data = await response.json();

    if (!response.ok) {
      setStatus(subtitleStatus, data.error || 'Subtitle generation failed to start.', true);
      setProgress(subtitleProgressBar, subtitleProgressText, subtitlePhasePill, 0, data.error || 'Subtitle generation failed to start.', 'failed');
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
      setProgress(videoProgressBar, videoProgressText, videoPhasePill, 0, 'Create subtitles first.', 'failed');
      return;
    }

    clearPoll();
    videoDownloads.classList.add('hidden');
    const formData = new FormData(videoForm);
    setStatus(videoStatus, 'Uploading source videos...', false);
    setProgress(videoProgressBar, videoProgressText, videoPhasePill, 48, 'Uploading source videos...', 'running');

    const response = await fetch(`/api/jobs/${currentJobId}/videos`, {
      method: 'POST',
      body: formData
    });
    const data = await response.json();

    if (!response.ok) {
      setStatus(videoStatus, data.error || 'Video generation failed to start.', true);
      setProgress(videoProgressBar, videoProgressText, videoPhasePill, 0, data.error || 'Video generation failed to start.', 'failed');
      return;
    }

    updateUi(data.job);
    pollJob(currentJobId);
  });
}());
