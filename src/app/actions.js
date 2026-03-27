'use server'

import { WorkflowService } from '@/lib/services/WorkflowService';
import { getVideos, manualEdit, updateVideoStatus, getSpaces, addSpace, updateSpace, deleteSpace } from '@/lib/db/sqlite';
import { revalidatePath } from 'next/cache';

// --- Video Actions ---

export async function fetchVideos(spaceId = null) {
  try {
    return getVideos(spaceId);
  } catch (error) {
    console.error('[Action] Failed to fetch videos:', error.message);
    return [];
  }
}

export async function updateVideo(id, data) {
  try {
    manualEdit(id, data);
    revalidatePath('/');
    return { success: true };
  } catch (error) {
    console.error('[Action] Failed to update video:', error.message);
    return { success: false, error: error.message };
  }
}

// --- Space Actions (Tabs) ---

export async function fetchSpaces() {
  try {
    return getSpaces();
  } catch (error) {
    console.error('[Action] Failed to fetch spaces:', error.message);
    return [];
  }
}

export async function createSpace(spaceId, name) {
  try {
    addSpace(spaceId, name);
    revalidatePath('/');
    return { success: true };
  } catch (error) {
    console.error('[Action] Failed to create space:', error.message);
    return { success: false, error: error.message };
  }
}

export async function modifySpace(id, spaceId, name) {
  try {
    updateSpace(id, spaceId, name);
    revalidatePath('/');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function removeSpace(id) {
  try {
    deleteSpace(id);
    revalidatePath('/');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// --- Workflow Actions ---

export async function triggerWorkflow(spaceId) {
  const service = new WorkflowService(spaceId);
  try {
    console.log(`[Action] Triggering workflow for Space ${spaceId}...`);
    await service.execute();
    revalidatePath('/');
    return { success: true, message: 'Workflow completed successfully.' };
  } catch (error) {
    console.error(`[Action] Workflow failed for Space ${spaceId}:`, error.message);
    return { success: false, error: error.message };
  }
}

export async function triggerContinuousWorkflow(spaceId) {
  const service = new WorkflowService(spaceId);
  try {
    console.log(`[Action] Triggering continuous loop for Space ${spaceId}...`);
    service.runWithRetry(); 
    return { success: true, message: 'Continuous loop started.' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Triggered on app load to check for due uploads.
 */
export async function startupCheck() {
  try {
    await WorkflowService.checkAllDueUploads();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
