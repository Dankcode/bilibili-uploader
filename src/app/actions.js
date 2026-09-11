'use server'

import { headers } from 'next/headers';
import { operatorGuard } from '../lib/agent/auth.js';
function assertOperatorAction() {
 const request = { headers: headers(), method: 'GET' };
 if (operatorGuard(request)) throw new Error('Operator authentication required');
}

import { WorkflowService } from '@/lib/services/WorkflowService';
import { 
  getVideos, manualEdit, updateVideoStatus, getVideoById,
  getSpaces, addSpace, updateSpace, deleteSpace,
  getYouTubeChannels, addYouTubeChannel, deleteYouTubeChannel
} from '@/lib/db/sqlite';
import { revalidatePath } from 'next/cache';

// --- Video Actions ---

export async function fetchVideos(spaceId = null) {
  assertOperatorAction();
  try {
    return getVideos(spaceId);
  } catch (error) {
    console.error('[Action] Failed to fetch videos:', error.message);
    return [];
  }
}

export async function updateVideo(id, data) {
  assertOperatorAction();
  try {
    manualEdit(id, data);
    revalidatePath('/');
    return { success: true };
  } catch (error) {
    console.error('[Action] Failed to update video:', error.message);
    return { success: false, error: error.message };
  }
}

// --- YouTube Channel Actions (Top-Level Tabs) ---

export async function fetchYouTubeChannels() {
  assertOperatorAction();
  try {
    return getYouTubeChannels();
  } catch (error) {
    console.error('[Action] Failed to fetch channels:', error.message);
    return [];
  }
}

export async function createYouTubeChannel(channelId, name) {
  assertOperatorAction();
  try {
    addYouTubeChannel(channelId, name);
    revalidatePath('/');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function removeYouTubeChannel(id) {
  assertOperatorAction();
  try {
    deleteYouTubeChannel(id);
    revalidatePath('/');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// --- Bilibili Space Actions (Sub-Tabs) ---

export async function fetchSpaces(youtubeChannelId = null) {
  assertOperatorAction();
  try {
    return getSpaces(youtubeChannelId);
  } catch (error) {
    console.error('[Action] Failed to fetch spaces:', error.message);
    return [];
  }
}

export async function createSpace(youtubeChannelId, spaceId, name) {
  assertOperatorAction();
  try {
    addSpace(youtubeChannelId, spaceId, name);
    revalidatePath('/');
    return { success: true };
  } catch (error) {
    console.error('[Action] Failed to create space:', error.message);
    return { success: false, error: error.message };
  }
}

export async function removeSpace(id) {
  assertOperatorAction();
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
  assertOperatorAction();
  const service = new WorkflowService(spaceId);
  try {
    await service.execute();
    revalidatePath('/');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function triggerSpecificVideo(videoId) {
  assertOperatorAction();
  try {
    const video = await getVideoById(videoId);
    if (!video) throw new Error('Video not found');
    
    // Explicitly using the spaceId associated with the video
    const service = new WorkflowService(video.space_id);
    console.log(`[Action] Manually triggering upload for Video ID ${videoId}...`);
    
    const job = await service.processSpecificVideo(video, true);
    
    revalidatePath('/');
    return { success: true, job };
  } catch (error) {
    console.error('[Action] Manual upload failed:', error.message);
    return { success: false, error: error.message };
  }
}

export async function triggerContinuousWorkflow(spaceId) {
  assertOperatorAction();
  const service = new WorkflowService(spaceId);
  try {
    const job = await service.execute();
    return { success: true, job };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function startupCheck() {
  assertOperatorAction();
  try {
    await WorkflowService.checkAllDueUploads();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
