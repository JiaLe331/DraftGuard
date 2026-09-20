import {
  currentVersion,
  effectiveValue,
  fieldLabels,
  finding,
  findingLabels,
  summary,
  normalize,
  type Task,
} from '../demo/model'
export function Report({ task, revision }: { task: Task; revision: number }) {
  const version = currentVersion(task, revision)
  const reviews = task.reviews.filter((r) => r.revision === revision)
  return (
    <article className="print-report">
      <div className="eyebrow">DRAFTGUARD · SAMPLE REPORT</div>
      <h1>Document verification report</h1>
      <p>
        {task.reference} · {task.subject}
      </p>
      <p>
        {revision !== task.currentRevision ? 'HISTORICAL VERSION' : 'CURRENT VERSION'} · Revision{' '}
        {revision} · Generated {new Date().toLocaleString('en-GB')}
      </p>
      <p>
        Team-authored interactive prototype. These results are illustrative, not live AI analysis.
      </p>
      <p>
        {version.documents
          .map((d) => `${d.role.toUpperCase()}: ${d.filename} (v${d.version})`)
          .join(' · ')}
      </p>
      <p>
        {revision === task.currentRevision
          ? summary(task)
          : 'Historical results; not the current check.'}
      </p>
      <table>
        <thead>
          <tr>
            <th>Field</th>
            <th>SI</th>
            <th>Draft BL</th>
            <th>Finding / evidence</th>
          </tr>
        </thead>
        <tbody>
          {version.fields.map((field) => (
            <tr key={field.key}>
              <th>{fieldLabels[field.key]}</th>
              <td>{effectiveValue(task, field, 'si', revision).value || 'Missing'}</td>
              <td>{effectiveValue(task, field, 'bl', revision).value || 'Missing'}</td>
              <td>
                {findingLabels[finding(task, field, revision)]}
                <br />
                SI: {field.si.evidence?.locator ?? 'No evidence'}
                <br />
                BL: {field.bl.evidence?.locator ?? 'No evidence'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Source evidence</h2>
      {version.fields.map((field) => (
        <div key={field.key}>
          <strong>{fieldLabels[field.key]}</strong>
          <p>
            SI machine value: {field.si.raw || 'Missing'}
            <br />
            SI normalized:{' '}
            {normalize(field.key, effectiveValue(task, field, 'si', revision).value) || 'Missing'}
            <br />
            BL machine value: {field.bl.raw || 'Missing'}
            <br />
            BL normalized:{' '}
            {normalize(field.key, effectiveValue(task, field, 'bl', revision).value) || 'Missing'}
            <br />
            SI: {field.si.evidence?.text ?? 'No usable source'}
            <br />
            BL: {field.bl.evidence?.text ?? 'No usable source'}
          </p>
        </div>
      ))}
      <h2>Review record</h2>
      {reviews.length ? (
        reviews.map((r) => (
          <p key={r.id}>
            {fieldLabels[r.field]} · {r.role.toUpperCase()} · {r.action} → {r.value}
            <br />
            {r.reason}
            <br />
            {r.actor} · {new Date(r.createdAt).toLocaleString('en-GB')}
          </p>
        ))
      ) : (
        <p>No field corrections or confirmations recorded.</p>
      )}
      <p>
        {task.completedRevision === revision
          ? 'Completion acknowledged by Demo reviewer — unverified.'
          : 'Completion has not been acknowledged for this version.'}
      </p>
      <p>
        This report covers seven fields only. It is not legal approval, authorization to release
        cargo, or a complete bill-of-lading review.
      </p>
    </article>
  )
}
