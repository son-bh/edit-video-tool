export type JobPhase = 'subtitle' | 'video' | null;
export type JobStatus = 'created' | 'running' | 'completed' | 'failed';

export interface WorkspacePaths {
  folderName: string;
  root: string;
  inputs: string;
  videos: string;
  outputs: string;
  segments: string;
}

export interface JobFiles {
  audioPath?: string | null;
  jsonPath?: string | null;
  transcriptPath?: string | null;
}

export interface JobOutputs {
  transcriptSrt?: string;
  scriptSrt?: string;
  segmentZip?: string;
  finalVideo?: string;
  finalVideoWithAudio?: string;
  finalVideoWithAudioSubtitles?: string;
  segmentsDir?: string;
}

export interface CompletedPhases {
  subtitle: boolean;
  video: boolean;
}

export interface JobRecord {
  id: string;
  folderName: string | null;
  ownerUsername: string | null;
  ownerKey: string | null;
  aspectRatio?: string;
  renderLabel?: string;
  phase: JobPhase;
  status: JobStatus;
  stage: string;
  percent: number;
  message: string;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  workspace: WorkspacePaths | null;
  files: JobFiles;
  outputs: JobOutputs;
  completedPhases: CompletedPhases;
}

export interface JobSeed extends Partial<JobRecord> {
  id?: string;
}

export interface AuthSession {
  id: string;
  username: string;
  workspaceKey: string;
  createdAt: string;
}

export interface ProgressPayload {
  stage: string;
  percent: number;
  message: string;
}

export interface WorkerProgressMessage extends ProgressPayload {
  type: 'progress';
}

export interface WorkerLogMessage {
  type: 'log';
  message: string;
}

export interface WorkerCompletedMessage {
  type: 'completed';
  outputs: JobOutputs;
}

export interface WorkerFailedMessage {
  type: 'failed';
  error: string;
}

export type WorkerMessage =
  | WorkerProgressMessage
  | WorkerLogMessage
  | WorkerCompletedMessage
  | WorkerFailedMessage;
