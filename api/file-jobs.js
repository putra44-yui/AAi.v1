export const maxDuration = 300;

import { createClient } from '@supabase/supabase-js';
import * as chatFiles from './_lib/chat-files.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function selectJobQuery() {
  return 'id, message_id, session_id, user_id, status, source_text, pending_text, processed_text, error_text, file_count, attempt_count, started_at, completed_at, created_at, updated_at';
}

async function fetchJob(jobId) {
  const { data, error } = await supabase
    .from('file_generation_jobs')
    .select(selectJobQuery())
    .eq('id', jobId)
    .single();

  if (error) throw error;
  return data;
}

function buildJobPayload(job = {}) {
  return {
    id: job.id,
    message_id: job.message_id,
    session_id: job.session_id,
    user_id: job.user_id || null,
    status: job.status,
    file_count: Number(job.file_count || 0),
    attempt_count: Number(job.attempt_count || 0),
    error_text: job.error_text || null,
    content: job.status === 'ready' || job.status === 'failed'
      ? (job.processed_text || job.pending_text || '')
      : (job.pending_text || ''),
    started_at: job.started_at || null,
    completed_at: job.completed_at || null,
    created_at: job.created_at || null,
    updated_at: job.updated_at || null
  };
}

async function markJobFailed(job = {}, errorMessage = '') {
  const failureContent = chatFiles.buildFailedFileReply(job.pending_text, errorMessage);
  const completedAt = new Date().toISOString();

  await supabase
    .from('messages')
    .update({ content: failureContent })
    .eq('id', job.message_id);

  const { data, error } = await supabase
    .from('file_generation_jobs')
    .update({
      status: 'failed',
      processed_text: failureContent,
      error_text: String(errorMessage || 'Unknown error').slice(0, 400),
      completed_at: completedAt
    })
    .eq('id', job.id)
    .select(selectJobQuery())
    .single();

  if (error) throw error;
  return data;
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const { job_id, session_id, active_only = 'true' } = req.query;

    if (!job_id && !session_id) {
      return res.status(400).json({ error: 'job_id atau session_id wajib' });
    }

    try {
      if (job_id) {
        const job = await fetchJob(job_id);
        return res.status(200).json({ success: true, job: buildJobPayload(job) });
      }

      let query = supabase
        .from('file_generation_jobs')
        .select(selectJobQuery())
        .eq('session_id', session_id)
        .order('created_at', { ascending: false })
        .limit(20);

      if (String(active_only).toLowerCase() !== 'false') {
        query = query.in('status', ['pending', 'processing']);
      }

      const { data, error } = await query;
      if (error) throw error;

      return res.status(200).json({
        success: true,
        jobs: Array.isArray(data) ? data.map(buildJobPayload) : []
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { job_id } = req.body || {};
  if (!job_id) return res.status(400).json({ error: 'job_id wajib' });

  let currentJob = null;

  try {
    currentJob = await fetchJob(job_id);
    if (currentJob.status === 'ready' || currentJob.status === 'failed') {
      return res.status(200).json({ success: true, job: buildJobPayload(currentJob) });
    }

    if (currentJob.status === 'processing') {
      return res.status(202).json({ success: true, job: buildJobPayload(currentJob) });
    }

    const startedAt = new Date().toISOString();
    const nextAttemptCount = Number(currentJob.attempt_count || 0) + 1;
    const { data: claimedJob, error: claimError } = await supabase
      .from('file_generation_jobs')
      .update({
        status: 'processing',
        started_at: startedAt,
        completed_at: null,
        error_text: null,
        attempt_count: nextAttemptCount
      })
      .eq('id', job_id)
      .in('status', ['pending', 'failed'])
      .select(selectJobQuery())
      .maybeSingle();

    if (claimError) throw claimError;
    if (!claimedJob) {
      const latestJob = await fetchJob(job_id);
      return res.status(latestJob.status === 'processing' ? 202 : 200).json({
        success: true,
        job: buildJobPayload(latestJob)
      });
    }

    currentJob = claimedJob;
    const result = await chatFiles.processGeneratedFiles({
      supabase,
      sourceText: currentJob.source_text
    });

    const readyFiles = (result.files || []).filter(file => file.status === 'ready').length;
    const failedFiles = (result.files || []).filter(file => file.status === 'failed');
    const finalStatus = readyFiles > 0 || failedFiles.length === 0 ? 'ready' : 'failed';
    const finalContent = finalStatus === 'failed'
      ? chatFiles.buildFailedFileReply(currentJob.pending_text, failedFiles.map(file => `${file.filename}: ${file.error}`).join(' | '))
      : (result.processedReply || currentJob.pending_text || '');

    await supabase
      .from('messages')
      .update({ content: finalContent })
      .eq('id', currentJob.message_id);

    const completedAt = new Date().toISOString();
    const { data: completedJob, error: completeError } = await supabase
      .from('file_generation_jobs')
      .update({
        status: finalStatus,
        processed_text: finalContent,
        error_text: failedFiles.length > 0 ? failedFiles.map(file => `${file.filename}: ${file.error}`).join(' | ').slice(0, 400) : null,
        completed_at: completedAt
      })
      .eq('id', job_id)
      .select(selectJobQuery())
      .single();

    if (completeError) throw completeError;

    return res.status(finalStatus === 'ready' ? 200 : 500).json({
      success: finalStatus === 'ready',
      job: buildJobPayload(completedJob)
    });
  } catch (error) {
    console.error('[FileJobs] Processing failed:', error.message);

    if (currentJob?.id) {
      try {
        const failedJob = await markJobFailed(currentJob, error.message);
        return res.status(500).json({ success: false, job: buildJobPayload(failedJob), error: error.message });
      } catch (markError) {
        console.error('[FileJobs] Failed to persist failed state:', markError.message);
      }
    }

    return res.status(500).json({ error: error.message });
  }
}