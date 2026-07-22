const pool = require("./db");

let schemaPromise;

function ensureEvaluationSchema() {
  if (!schemaPromise) {
    schemaPromise = pool.query(`
      CREATE TABLE IF NOT EXISTS evaluation_runs (
        run_id VARCHAR PRIMARY KEY,
        state VARCHAR NOT NULL DEFAULT 'bharat-vistaar',
        window_start TIMESTAMPTZ NOT NULL,
        window_end TIMESTAMPTZ NOT NULL,
        status VARCHAR NOT NULL CHECK (status IN ('running', 'complete', 'partial', 'failed')),
        population_count INTEGER NOT NULL DEFAULT 0,
        random_target INTEGER NOT NULL DEFAULT 0,
        feedback_selected_count INTEGER NOT NULL DEFAULT 0,
        random_selected_count INTEGER NOT NULL DEFAULT 0,
        unmatched_feedback_count INTEGER NOT NULL DEFAULT 0,
        successful_count INTEGER NOT NULL DEFAULT 0,
        failed_count INTEGER NOT NULL DEFAULT 0,
        judge_model VARCHAR NOT NULL,
        schema_version VARCHAR NOT NULL,
        rubric_version VARCHAR NOT NULL,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS evaluation_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        run_id VARCHAR NOT NULL REFERENCES evaluation_runs(run_id) ON DELETE CASCADE,
        trace_id VARCHAR NOT NULL,
        qid VARCHAR,
        masked_session_ref VARCHAR,
        question TEXT NOT NULL DEFAULT '',
        answer TEXT NOT NULL DEFAULT '',
        category VARCHAR NOT NULL DEFAULT 'Unknown',
        agristack_required VARCHAR NOT NULL DEFAULT 'No',
        target_lang VARCHAR,
        serving_model VARCHAR,
        application_release VARCHAR,
        selection_source VARCHAR NOT NULL CHECK (selection_source IN ('feedback', 'random')),
        feedback_types JSONB NOT NULL DEFAULT '[]'::jsonb,
        feedback_count INTEGER NOT NULL DEFAULT 0,
        feedback_comment_present BOOLEAN NOT NULL DEFAULT FALSE,
        evaluation JSONB NOT NULL,
        dimension_averages JSONB NOT NULL DEFAULT '{}'::jsonb,
        overall_average NUMERIC,
        overall_pass BOOLEAN NOT NULL,
        critical_failures JSONB NOT NULL DEFAULT '[]'::jsonb,
        evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (run_id, trace_id)
      );

      CREATE TABLE IF NOT EXISTS evaluation_run_traces (
        run_id VARCHAR NOT NULL REFERENCES evaluation_runs(run_id) ON DELETE CASCADE,
        trace_id VARCHAR NOT NULL,
        selection_source VARCHAR NOT NULL CHECK (selection_source IN ('feedback', 'random')),
        feedback_types JSONB NOT NULL DEFAULT '[]'::jsonb,
        feedback_count INTEGER NOT NULL DEFAULT 0,
        feedback_comment_present BOOLEAN NOT NULL DEFAULT FALSE,
        status VARCHAR NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'scored', 'synced', 'failed')),
        error TEXT,
        scored_at TIMESTAMPTZ,
        synced_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (run_id, trace_id)
      );

      ALTER TABLE evaluation_runs ADD COLUMN IF NOT EXISTS score_source VARCHAR NOT NULL DEFAULT 'dashboard';
      ALTER TABLE evaluation_runs ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;

      CREATE TABLE IF NOT EXISTS evaluation_comments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        item_id UUID NOT NULL REFERENCES evaluation_items(id) ON DELETE CASCADE,
        author VARCHAR NOT NULL DEFAULT 'evaluator',
        comment TEXT NOT NULL CHECK (char_length(comment) BETWEEN 1 AND 2000),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS evaluation_runs_state_window_idx
        ON evaluation_runs(state, window_end DESC);
      CREATE INDEX IF NOT EXISTS evaluation_items_run_idx
        ON evaluation_items(run_id, evaluated_at DESC);
      CREATE INDEX IF NOT EXISTS evaluation_items_filters_idx
        ON evaluation_items(run_id, selection_source, overall_pass, category);
      CREATE INDEX IF NOT EXISTS evaluation_run_traces_status_idx
        ON evaluation_run_traces(run_id, status);
      CREATE INDEX IF NOT EXISTS evaluation_comments_item_idx
        ON evaluation_comments(item_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS feedback_qid_ets_idx
        ON feedback(qid, ets) WHERE qid IS NOT NULL;
    `).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

module.exports = { ensureEvaluationSchema };
