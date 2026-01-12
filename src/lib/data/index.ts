/**
 * Data Module
 *
 * Exports data recording functionality for market analysis.
 */

export { DataRecorder, getDataRecorder } from './DataRecorder';
export type {
  RecorderStatus,
  RecorderState,
  RecorderEvent,
  RecorderEventHandler,
  CurrentSession,
  RecorderEventType,
  StateChangedEvent,
  SessionStartedEvent,
  SessionEndedEvent,
  TickRecordedEvent,
  SnapshotSavedEvent,
  ErrorEvent,
} from './types';
