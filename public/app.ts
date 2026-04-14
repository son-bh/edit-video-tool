(function () {
  const subtitleForm = document.getElementById('subtitle-form') as HTMLFormElement | null;
  const videoForm = document.getElementById('video-form') as HTMLFormElement | null;
  const subtitleStatus = document.getElementById('subtitle-status') as HTMLElement | null;
  const videoStatus = document.getElementById('video-status') as HTMLElement | null;
  const scriptDownload = document.getElementById('script-download') as HTMLAnchorElement | null;
  const transcriptDownload = document.getElementById('transcript-download') as HTMLAnchorElement | null;
  const segmentsDownload = document.getElementById('segments-download') as HTMLAnchorElement | null;
  const finalDownload = document.getElementById('final-download') as HTMLAnchorElement | null;
  const finalAudioDownload = document.getElementById('final-audio-download') as HTMLAnchorElement | null;
  const finalSubtitleDownload = document.getElementById('final-subtitle-download') as HTMLAnchorElement | null;
  const subtitleDownloads = document.getElementById('subtitle-downloads') as HTMLElement | null;
  const videoDownloads = document.getElementById('video-downloads') as HTMLElement | null;
  const videoSubmit = document.getElementById('video-submit') as HTMLButtonElement | null;
  const subtitleProgressBar = document.getElementById('subtitle-progress-bar') as HTMLElement | null;
  const videoProgressBar = document.getElementById('video-progress-bar') as HTMLElement | null;
  const subtitleProgressText = document.getElementById('subtitle-progress-text') as HTMLElement | null;
  const videoProgressText = document.getElementById('video-progress-text') as HTMLElement | null;
  const subtitlePhasePill = document.getElementById('subtitle-phase-pill') as HTMLElement | null;
  const videoPhasePill = document.getElementById('video-phase-pill') as HTMLElement | null;
  const subtitleJobFolder = document.getElementById('subtitle-job-folder') as HTMLElement | null;
  const videoJobFolder = document.getElementById('video-job-folder') as HTMLElement | null;
  const clearButtons = document.querySelectorAll<HTMLElement>('[data-clear-input]');
  const videoScriptInput = document.querySelector('input[name="scriptSrt"]') as HTMLInputElement | null;
  const videoFilesInput = document.querySelector('input[name="videos"]') as HTMLInputElement | null;
  const aspectRatioSelect = document.getElementById('aspect-ratio-select') as HTMLSelectElement | null;

  if (!subtitleForm || !videoForm || !subtitleStatus || !videoStatus || !scriptDownload || !transcriptDownload ||
    !segmentsDownload || !finalDownload || !finalAudioDownload || !finalSubtitleDownload || !subtitleDownloads ||
    !videoDownloads || !videoSubmit || !subtitleProgressBar || !videoProgressBar || !subtitleProgressText ||
    !videoProgressText || !subtitlePhasePill || !videoPhasePill || !subtitleJobFolder || !videoJobFolder) {
    return;
  }

  const scriptDownloadEl = scriptDownload;
  const transcriptDownloadEl = transcriptDownload;
  const segmentsDownloadEl = segmentsDownload;
  const finalDownloadEl = finalDownload;
  const finalAudioDownloadEl = finalAudioDownload;
  const finalSubtitleDownloadEl = finalSubtitleDownload;
  const subtitleStatusEl = subtitleStatus;
  const videoStatusEl = videoStatus;
  const subtitleDownloadsEl = subtitleDownloads;
  const videoDownloadsEl = videoDownloads;
  const videoSubmitEl = videoSubmit;
  const subtitleProgressBarEl = subtitleProgressBar;
  const videoProgressBarEl = videoProgressBar;
  const subtitleProgressTextEl = subtitleProgressText;
  const videoProgressTextEl = videoProgressText;
  const subtitlePhasePillEl = subtitlePhasePill;
  const videoPhasePillEl = videoPhasePill;
  const subtitleJobFolderEl = subtitleJobFolder;
  const videoJobFolderEl = videoJobFolder;

  let currentJobId: string | null = null;
  let pollTimer: number | null = null;

  const renderLabels: Record<string, string> = {
    '16:9': '2K',
    '9:16': '1080p'
  };

  function setStatus(element: HTMLElement, text: string, isError: boolean): void {
    element.textContent = text;
    element.classList.remove('hidden');
    element.classList.toggle('error', Boolean(isError));
  }

  function setProgress(progressBar: HTMLElement, progressText: HTMLElement, phasePill: HTMLElement, percent: number, message: string, status: string): void {
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

  function setJobFolder(element: HTMLElement, folderName?: string | null): void {
    if (!folderName) {
      element.textContent = '';
      element.classList.add('hidden');
      return;
    }

    element.textContent = `Job folder: ${folderName}`;
    element.classList.remove('hidden');
  }

  function clearPoll(): void {
    if (pollTimer !== null) {
      window.clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  function getSelectedAspectRatio(): string {
    return aspectRatioSelect && aspectRatioSelect.value ? aspectRatioSelect.value : '16:9';
  }

  function getRenderLabel(aspectRatio: string): string {
    return renderLabels[aspectRatio] || renderLabels['16:9'];
  }

  function updateVideoDownloadLabels(aspectRatio: string): void {
    const renderLabel = getRenderLabel(aspectRatio);
    finalDownloadEl.textContent = `Download final video (${renderLabel})`;
    finalAudioDownloadEl.textContent = `Download final video + audio (${renderLabel})`;
    finalSubtitleDownloadEl.textContent = `Download final video + audio + subtitles (${renderLabel})`;
  }

  function clearFileInput(button: HTMLElement): void {
    const name = button.getAttribute('data-clear-input');
    const scope = button.closest('form') || document;
    const input = name ? scope.querySelector(`input[name="${name}"]`) as HTMLInputElement | null : null;

    if (!input) {
      return;
    }

    input.value = '';
    refreshVideoAvailability();
  }

  function refreshVideoAvailability(): void {
    const hasCurrentScript = Boolean(currentJobId);
    const hasUploadedScript = Boolean(videoScriptInput && videoScriptInput.files && videoScriptInput.files.length > 0);
    videoSubmitEl.disabled = !(hasCurrentScript || hasUploadedScript);
  }

  async function fetchJob(jobId: string): Promise<any> {
    const response = await fetch(`/api/jobs/${jobId}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to fetch job status.');
    }

    return data.job;
  }

  function updateUi(job: any): void {
    if (!job) {
      return;
    }

    if (job.phase === 'subtitle' || job.completedPhases.subtitle) {
      const subtitleStatusText = `${job.stage}: ${job.percent}%${job.message ? ` - ${job.message}` : ''}`;
      setStatus(subtitleStatusEl, subtitleStatusText, job.status === 'failed');
      setJobFolder(subtitleJobFolderEl, job.folderName);
      setProgress(
        subtitleProgressBarEl,
        subtitleProgressTextEl,
        subtitlePhasePillEl,
        job.percent,
        job.message || 'Subtitle job in progress.',
        job.completedPhases.subtitle ? 'completed' : job.status
      );
    }

    if (job.completedPhases.subtitle && job.outputs.hasScriptSrt) {
      refreshVideoAvailability();
      scriptDownloadEl.href = `/download/${job.id}/script`;
      if (job.outputs.hasTranscriptSrt) {
        transcriptDownloadEl.href = `/download/${job.id}/transcript`;
        transcriptDownloadEl.classList.remove('hidden');
      } else {
        transcriptDownloadEl.classList.add('hidden');
      }
      subtitleDownloadsEl.classList.remove('hidden');
      if (job.phase !== 'video' && !job.completedPhases.video) {
        setProgress(
          videoProgressBarEl,
          videoProgressTextEl,
          videoPhasePillEl,
          0,
          'Subtitle output ready. Upload videos to start the next stage.',
          'ready'
        );
      }
    }

    if (job.phase === 'video' || job.completedPhases.video) {
      const videoStatusText = `${job.stage}: ${job.percent}%${job.message ? ` - ${job.message}` : ''}`;
      setStatus(videoStatusEl, videoStatusText, job.status === 'failed');
      setJobFolder(videoJobFolderEl, job.folderName);
      setProgress(
        videoProgressBarEl,
        videoProgressTextEl,
        videoPhasePillEl,
        job.percent,
        job.message || 'Video job in progress.',
        job.completedPhases.video ? 'completed' : job.status
      );
    }

    if (job.completedPhases.video && job.outputs.hasSegmentZip && job.outputs.hasFinalVideo) {
      updateVideoDownloadLabels(job.aspectRatio || getSelectedAspectRatio());
      segmentsDownloadEl.href = `/download/${job.id}/segments`;
      finalDownloadEl.href = `/download/${job.id}/final-video`;
      if (job.outputs.hasFinalVideoWithAudio) {
        finalAudioDownloadEl.href = `/download/${job.id}/final-video-with-audio`;
        finalAudioDownloadEl.classList.remove('hidden');
      } else {
        finalAudioDownloadEl.classList.add('hidden');
      }
      if (job.outputs.hasFinalVideoWithAudioSubtitles) {
        finalSubtitleDownloadEl.href = `/download/${job.id}/final-video-with-audio-subtitles`;
        finalSubtitleDownloadEl.classList.remove('hidden');
      } else {
        finalSubtitleDownloadEl.classList.add('hidden');
      }
      videoDownloadsEl.classList.remove('hidden');
    }
  }

  async function pollJob(jobId: string): Promise<void> {
    clearPoll();

    try {
      const job = await fetchJob(jobId);
      updateUi(job);

      if (job.status === 'running' || job.stage === 'queued') {
        pollTimer = window.setTimeout(function () {
          void pollJob(jobId);
        }, 1500);
      }
    } catch (error) {
      if (jobId === currentJobId) {
        const message = error instanceof Error ? error.message : String(error);
        setStatus(videoStatusEl, message, true);
        setProgress(videoProgressBarEl, videoProgressTextEl, videoPhasePillEl, 0, message, 'failed');
      }
    }
  }

  subtitleForm.addEventListener('submit', async function (event) {
    event.preventDefault();
    clearPoll();
    subtitleDownloadsEl.classList.add('hidden');
    videoDownloadsEl.classList.add('hidden');
    videoSubmitEl.disabled = true;

    const formData = new FormData(subtitleForm);
    setStatus(subtitleStatus, 'Uploading subtitle inputs...', false);
    setProgress(subtitleProgressBarEl, subtitleProgressTextEl, subtitlePhasePillEl, 4, 'Uploading subtitle inputs...', 'running');
    setProgress(videoProgressBarEl, videoProgressTextEl, videoPhasePillEl, 0, 'Waiting for subtitle output.', 'locked');

    const response = await fetch('/api/jobs/subtitles', {
      method: 'POST',
      body: formData
    });
    const data = await response.json();

    if (!response.ok) {
      setStatus(subtitleStatus, data.error || 'Subtitle generation failed to start.', true);
      setProgress(subtitleProgressBarEl, subtitleProgressTextEl, subtitlePhasePillEl, 0, data.error || 'Subtitle generation failed to start.', 'failed');
      return;
    }

    currentJobId = data.job.id;
    updateUi(data.job);
    refreshVideoAvailability();
    if (currentJobId) {
      await pollJob(currentJobId);
    }
  });

  videoForm.addEventListener('submit', async function (event) {
    event.preventDefault();

    clearPoll();
    videoDownloadsEl.classList.add('hidden');
    const formData = new FormData(videoForm);
    updateVideoDownloadLabels(getSelectedAspectRatio());
    const uploadedScript = formData.get('scriptSrt');
    const hasUploadedScript = uploadedScript instanceof File && uploadedScript.size > 0;
    const endpoint = currentJobId && !hasUploadedScript
      ? `/api/jobs/${currentJobId}/videos`
      : '/api/jobs/videos';

    if (!currentJobId && !hasUploadedScript) {
      setStatus(videoStatus, 'Upload script.srt or create subtitles first.', true);
      setProgress(videoProgressBarEl, videoProgressTextEl, videoPhasePillEl, 0, 'Upload script.srt or create subtitles first.', 'failed');
      return;
    }

    setStatus(videoStatus, 'Uploading source videos...', false);
    setProgress(videoProgressBarEl, videoProgressTextEl, videoPhasePillEl, 48, 'Uploading source videos...', 'running');

    const response = await fetch(endpoint, {
      method: 'POST',
      body: formData
    });
    const data = await response.json();

    if (!response.ok) {
      setStatus(videoStatus, data.error || 'Video generation failed to start.', true);
      setProgress(videoProgressBarEl, videoProgressTextEl, videoPhasePillEl, 0, data.error || 'Video generation failed to start.', 'failed');
      return;
    }

    currentJobId = data.job.id;
    updateUi(data.job);
    refreshVideoAvailability();
    if (currentJobId) {
      await pollJob(currentJobId);
    }
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
