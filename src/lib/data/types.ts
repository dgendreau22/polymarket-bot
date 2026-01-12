/**
 * Data Recorder Types
 */

export type RecorderState = 'idle' | 'discovering' | 'recording' | 'error';

export interface CurrentSession {
  id: string;
  marketId: string;
  marketName: string;
  tickCount: number;
  snapshotCount: number;
  startTime: string;
  endTime: string;
}

export interface RecorderStatus {
  state: RecorderState;
  currentSession?: CurrentSession;
  error?: string;
}

export type RecorderEventType =
  | 'STATE_CHANGED'
  | 'SESSION_STARTED'
  | 'SESSION_ENDED'
  | 'TICK_RECORDED'
  | 'SNAPSHOT_SAVED'
  | 'ERROR';

export interface BaseRecorderEvent {
  type: RecorderEventType;
  timestamp: string;
}

export interface StateChangedEvent extends BaseRecorderEvent {
  type: 'STATE_CHANGED';
  state: RecorderState;
  previousState: RecorderState;
}

export interface SessionStartedEvent extends BaseRecorderEvent {
  type: 'SESSION_STARTED';
  sessionId: string;
  marketId: string;
  marketName: string;
}

export interface SessionEndedEvent extends BaseRecorderEvent {
  type: 'SESSION_ENDED';
  sessionId: string;
  tickCount: number;
  snapshotCount: number;
}

export interface TickRecordedEvent extends BaseRecorderEvent {
  type: 'TICK_RECORDED';
  outcome: 'YES' | 'NO';
  price: string;
  size: string;
  side: 'BUY' | 'SELL';
}

export interface SnapshotSavedEvent extends BaseRecorderEvent {
  type: 'SNAPSHOT_SAVED';
  combinedCost?: string;
  spread?: string;
}

export interface ErrorEvent extends BaseRecorderEvent {
  type: 'ERROR';
  error: string;
}

export type RecorderEvent =
  | StateChangedEvent
  | SessionStartedEvent
  | SessionEndedEvent
  | TickRecordedEvent
  | SnapshotSavedEvent
  | ErrorEvent;

export type RecorderEventHandler = (event: RecorderEvent) => void;
