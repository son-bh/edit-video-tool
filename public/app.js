(function () {
  const subtitleForm = document.getElementById('subtitle-form');
  const videoForm = document.getElementById('video-form');
  const subtitleStatus = document.getElementById('subtitle-status');
  const videoStatus = document.getElementById('video-status');
  const scriptDownload = document.getElementById('script-download');
  const transcriptDownload = document.getElementById('transcript-download');
  const segmentsDownload = document.getElementById('segments-download');
  const finalDownload = document.getElementById('final-download');
  const finalAudioDownload = document.getElementById('final-audio-download');
  const finalSubtitleDownload = document.getElementById('final-subtitle-download');
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
  const clearButtons = document.querySelectorAll('[data-clear-input]');
  const videoScriptInput = document.querySelector('input[name="scriptSrt"]');
  const videoFilesInput = document.querySelector('input[name="videos"]');
  const aspectRatioSelect = document.getElementById('aspect-ratio-select');

  let currentJobId = null;
  let pollTimer = null;

  const renderLabels = {
    '16:9': '2K',
    '9:16': '1080p'
  };

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

  function getSelectedAspectRatio() {
    return aspectRatioSelect && aspectRatioSelect.value ? aspectRatioSelect.value : '16:9';
  }

  function getRenderLabel(aspectRatio) {
    return renderLabels[aspectRatio] || renderLabels['16:9'];
  }

  function updateVideoDownloadLabels(aspectRatio) {
    const renderLabel = getRenderLabel(aspectRatio);
    finalDownload.textContent = `Download final video (${renderLabel})`;
    finalAudioDownload.textContent = `Download final video + audio (${renderLabel})`;
    finalSubtitleDownload.textContent = `Download final video + audio + subtitles (${renderLabel})`;
  }

  function clearFileInput(button) {
    const name = button.getAttribute('data-clear-input');
    const scope = button.closest('form') || document;
    const input = scope.querySelector(`input[name="${name}"]`);

    if (!input) {
      return;
    }

    input.value = '';
    refreshVideoAvailability();
  }

  function refreshVideoAvailability() {
    const hasCurrentScript = Boolean(currentJobId);
    const hasUploadedScript = Boolean(videoScriptInput && videoScriptInput.files && videoScriptInput.files.length > 0);
    videoSubmit.disabled = !(hasCurrentScript || hasUploadedScript);
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
      refreshVideoAvailability();
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
      updateVideoDownloadLabels(job.aspectRatio || getSelectedAspectRatio());
      segmentsDownload.href = `/download/${job.id}/segments`;
      finalDownload.href = `/download/${job.id}/final-video`;
      if (job.outputs.hasFinalVideoWithAudio) {
        finalAudioDownload.href = `/download/${job.id}/final-video-with-audio`;
        finalAudioDownload.classList.remove('hidden');
      } else {
        finalAudioDownload.classList.add('hidden');
      }
      if (job.outputs.hasFinalVideoWithAudioSubtitles) {
        finalSubtitleDownload.href = `/download/${job.id}/final-video-with-audio-subtitles`;
        finalSubtitleDownload.classList.remove('hidden');
      } else {
        finalSubtitleDownload.classList.add('hidden');
      }
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
        }, 1500);
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
    refreshVideoAvailability();
    pollJob(currentJobId);
  });

  videoForm.addEventListener('submit', async function (event) {
    event.preventDefault();

    clearPoll();
    videoDownloads.classList.add('hidden');
    const formData = new FormData(videoForm);
    updateVideoDownloadLabels(getSelectedAspectRatio());
    const uploadedScript = formData.get('scriptSrt');
    const hasUploadedScript = uploadedScript instanceof File && uploadedScript.size > 0;
    const endpoint = currentJobId && !hasUploadedScript
      ? `/api/jobs/${currentJobId}/videos`
      : '/api/jobs/videos';

    if (!currentJobId && !hasUploadedScript) {
      setStatus(videoStatus, 'Upload script.srt or create subtitles first.', true);
      setProgress(videoProgressBar, videoProgressText, videoPhasePill, 0, 'Upload script.srt or create subtitles first.', 'failed');
      return;
    }

    setStatus(videoStatus, 'Uploading source videos...', false);
    setProgress(videoProgressBar, videoProgressText, videoPhasePill, 48, 'Uploading source videos...', 'running');

    const response = await fetch(endpoint, {
      method: 'POST',
      body: formData
    });
    const data = await response.json();

    if (!response.ok) {
      setStatus(videoStatus, data.error || 'Video generation failed to start.', true);
      setProgress(videoProgressBar, videoProgressText, videoPhasePill, 0, data.error || 'Video generation failed to start.', 'failed');
      return;
    }

    currentJobId = data.job.id;
    updateUi(data.job);
    refreshVideoAvailability();
    pollJob(currentJobId);
  });

  clearButtons.forEach(function (button) {
    button.addEventListener('click', function () {
      clearFileInput(button);
    });
  });

  if (videoScriptInput) {
    videoScriptInput.addEventListener('change', refreshVideoAvailability);
  }

  if (videoFilesInput) {
    videoFilesInput.addEventListener('change', refreshVideoAvailability);
  }

  if (aspectRatioSelect) {
    aspectRatioSelect.addEventListener('change', function () {
      updateVideoDownloadLabels(getSelectedAspectRatio());
    });
  }

  updateVideoDownloadLabels(getSelectedAspectRatio());
  refreshVideoAvailability();
}());
