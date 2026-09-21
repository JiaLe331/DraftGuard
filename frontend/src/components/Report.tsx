import { RevisionChanges } from './TaskSources'
import { analyzedAt, fieldLabels, statusLabels, type SampleDetail } from '../mailbox/types'
export function Report({ task, preview = false }: { task: SampleDetail; preview?: boolean }) {
  const run = task.current_run
  const machine = run?.result
  const result = run?.reviewed_result ?? machine
  if (!result || !machine || !run) return null
  const actions = run.review_actions ?? []
  const completion = run.completion
  const designation = completion
    ? 'Completed seven-field check'
    : actions.length
      ? 'Human-reviewed result · Not complete'
      : 'Machine-only result · Not complete'
  return (
    <article className={`print-report ${preview ? 'report-preview' : ''}`}>
      <div className="eyebrow">
        DRAFTGUARD · {task.baseline_id ? 'LOCAL WORKING COPY' : 'PROVIDED DATASET'}
      </div>
      <h1>Document review report</h1>
      {task.is_historical && (
        <p>
          <strong>Historical result · Not the current check</strong>
        </p>
      )}
      <p>
        {task.id} · {task.subject}
      </p>
      <p>From: {task.sender}</p>
      <p>
        Generated {new Date().toLocaleString('en-GB')} · Source revision {run.revision}
      </p>
      <p>
        {run.mode === 'precomputed' ? 'Precomputed' : 'On demand'} · Rules · {run.pipeline_version}{' '}
        · Analyzed {analyzedAt(run.finished_at)}
      </p>
      <p>
        Run {run.id} · {statusLabels[result.workflow_state]}
      </p>
      <p>
        <strong>{designation}</strong>
      </p>
      {task.latest_run?.status === 'FAILED' && (
        <p>
          Latest attempt failed: {task.latest_run.error?.message} This report contains the last
          successful result, not a successful rerun.
        </p>
      )}
      <h2>Source documents</h2>
      {task.documents
        .filter((doc) => run.document_ids.includes(doc.id))
        .map((doc) => (
          <p key={doc.id}>
            {doc.filename} · v{doc.version} · {doc.id}
            <br />
            SHA-256: {doc.sha256}
          </p>
        ))}
      <p>
        {result.coverage.checked}/7 fields checked · {result.known_defect_fields.length}{' '}
        discrepancies.
      </p>
      <table>
        <thead>
          <tr>
            <th>Field</th>
            <th>SI: raw / normalized</th>
            <th>BL: raw / normalized</th>
            <th>Finding</th>
          </tr>
        </thead>
        <tbody>
          {result.fields.map((f) => (
            <tr key={f.key}>
              <th>{fieldLabels[f.key]}</th>
              <td>
                {f.si.raw_value ?? 'Missing'}
                <br />
                {f.si.normalized_value ?? 'Not established'}
                {machine.fields.find((item) => item.key === f.key)?.si.raw_value !==
                  f.si.raw_value && (
                  <small>
                    <br />
                    Machine: {machine.fields.find((item) => item.key === f.key)?.si.raw_value}
                  </small>
                )}
              </td>
              <td>
                {f.bl.raw_value ?? 'Missing'}
                <br />
                {f.bl.normalized_value ?? 'Not established'}
                {machine.fields.find((item) => item.key === f.key)?.bl.raw_value !==
                  f.bl.raw_value && (
                  <small>
                    <br />
                    Machine: {machine.fields.find((item) => item.key === f.key)?.bl.raw_value}
                  </small>
                )}
              </td>
              <td>{statusLabels[f.finding]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Source evidence and unresolved items</h2>
      {result.fields.map((f) => (
        <section key={f.key}>
          <h3>{fieldLabels[f.key]}</h3>
          {(['si', 'bl'] as const).map((role) => (
            <div key={role}>
              <p>
                {role.toUpperCase()} · {f[role].value_state} · {f[role].reason.replaceAll('_', ' ')}
              </p>
              {f[role].evidence.map((e) => (
                <p className="report-evidence" key={e.id}>
                  {e.document_id} · {e.locator}
                  <br />
                  {e.excerpt}
                </p>
              ))}
            </div>
          ))}
        </section>
      ))}
      {result.review_requirements.map((p, i) => (
        <p key={i}>{p.message}</p>
      ))}
      <RevisionChanges task={task} />
      <h2>Human review</h2>
      {!actions.length && <p>No human review actions have been recorded.</p>}
      {actions.map((action) => (
        <section className="report-review-action" key={action.id}>
          <h3>
            {action.action === 'CONFIRM_CANDIDATE'
              ? 'Confirmed candidate'
              : action.action === 'CORRECT_EXTRACTION'
                ? 'Corrected extraction'
                : 'Supplied information'}{' '}
            · {fieldLabels[action.field]}
          </h3>
          <p>
            Document {action.document_id} · {action.actor} · {analyzedAt(action.created_at)}
          </p>
          <p>
            Machine value: {action.machine_raw_value ?? 'Missing'}
            <br />
            Human value: {action.raw_value}
            {action.page ? (
              <>
                <br />
                Evidence page: {action.page}
              </>
            ) : null}
          </p>
          {action.action === 'SUPPLY_INFORMATION' && (
            <p>
              Source: {action.provenance_source}
              <br />
              Reference: {action.provenance_reference}
              {action.provenance_note ? (
                <>
                  <br />
                  Note: {action.provenance_note}
                </>
              ) : null}
              <br />
              Unverified external information; replacement source required.
            </p>
          )}
        </section>
      ))}
      <h2>Completion acknowledgment</h2>
      {completion ? (
        <p>
          Check complete · {completion.actor} · {analyzedAt(completion.acknowledged_at)}
          <br />
          Revision {completion.revision} · Run {completion.run_id}
        </p>
      ) : (
        <>
          <p>No completion acknowledgment has been recorded. Reviewer identity is unverified.</p>
          {run.completion_eligibility?.blockers.map((blocker) => (
            <p key={blocker.code}>Blocked: {blocker.message}</p>
          ))}
        </>
      )}
      <p>
        This report covers seven fields only. It is not legal approval, authorization to release
        cargo, or a complete bill-of-lading review.
      </p>
    </article>
  )
}
