'use server'

import { WorkflowService } from '@/lib/services/WorkflowService';
import { 
  getVideos, manualEdit, updateVideoStatus, getVideoById,
  getSpaces, addSpace, updateSpace, deleteSpace,
  getYouTubeChannels, addYouTubeChannel, deleteYouTubeChannel
} from '@/lib/db/sqlite';
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

// --- YouTube Channel Actions (Top-Level Tabs) ---

export async function fetchYouTubeChannels() {
  try {
    return getYouTubeChannels();
  } catch (error) {
    console.error('[Action] Failed to fetch channels:', error.message);
    return [];
  }
}

export async function createYouTubeChannel(channelId, name) {
  try {
    addYouTubeChannel(channelId, name);
    revalidatePath('/');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function removeYouTubeChannel(id) {
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
  try {
    return getSpaces(youtubeChannelId);
  } catch (error) {
    console.error('[Action] Failed to fetch spaces:', error.message);
    return [];
  }
}

export async function createSpace(youtubeChannelId, spaceId, name) {
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
    await service.execute();
    revalidatePath('/');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function triggerSpecificVideo(videoId) {
  try {
    const video = await getVideoById(videoId);
    if (!video) throw new Error('Video not found');
    
    // Explicitly using the spaceId associated with the video
    const service = new WorkflowService(video.space_id);
    console.log(`[Action] Manually triggering upload for Video ID ${videoId}...`);
    
    // We'll run this in the background or await it? 
    // Manual trigger usually wants immediate feedback but can take while.
    // For now, let's await it to provide status.
    await service.processSpecificVideo(video, true); // force = true
    
    revalidatePath('/');
    return { success: true };
  } catch (error) {
    console.error('[Action] Manual upload failed:', error.message);
    return { success: false, error: error.message };
  }
}

export async function triggerContinuousWorkflow(spaceId) {
  const service = new WorkflowService(spaceId);
  try {
    service.runWithRetry(); 
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function startupCheck() {
  try {
    await WorkflowService.checkAllDueUploads();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
