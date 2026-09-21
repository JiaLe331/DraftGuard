import { useState } from 'react'
import {
  CaretDownIcon,
  CaretRightIcon,
  FileTextIcon,
  PencilSimpleIcon,
  SparkleIcon,
} from '@phosphor-icons/react'
import { categoryLabels, type Result } from '../mailbox/types'

/**
 * The run metadata line, with the provenance detail folded behind it.
 *
 * The workspace answers "what differs"; how the run was produced is supporting
 * context, so it stays collapsed until someone asks for it. Everything shown is
 * derived from the saved result: this never narrates work the run does not
 * evidence and never issues a request of its own.
 */

type Engine = 'rule' | 'gemini' | 'human'

const engineLabels: Record<Engine, string> = {
  rule: 'Rules',
  gemini: 'Gemini',
  human: 'Human',
}

const operationLabels: Record<string, string> = {
  email_classification: 'Email classification',
  text_extraction: 'Readable-text extraction',
  vision_extraction: 'Scanned-page extraction',
  amendment_email: 'Amendment wording',
}

const roleLabels: Record<string, string> = {
  si: 'Shipping instruction',
  bl: 'Draft bill of lading',
  other: 'Unrecognised document',
}

function EngineTag({ engine }: { engine: Engine }) {
  const Icon =
    engine === 'gemini' ? SparkleIcon : engine === 'human' ? PencilSimpleIcon : FileTextIcon
  return (
    <span className={`engine-tag ${engine}`}>
      <Icon size={12} weight="bold" aria-hidden="true" />
      {engineLabels[engine]}
    </span>
  )
}

interface Stage {
  name: string
  engines: Engine[]
  detail: string
}

function buildStages(result: Result): Stage[] {
  const values = result.fields.flatMap((field) => [field.si, field.bl])
  const count = (method: string) => values.filter((value) => value.method === method).length
  const ruleValues = count('rule')
  const textValues = count('gemini_text')
  const visualValues = count('gemini_vision')
  const humanValues = count('human')
  const reviewed = values.filter((value) => value.review).length

  const engines: Engine[] = []
  if (ruleValues) engines.push('rule')
  if (textValues || visualValues) engines.push('gemini')
  if (humanValues) engines.push('human')

  const detail = [
    ruleValues && `${ruleValues} by rules`,
    textValues && `${textValues} by AI text`,
    visualValues && `${visualValues} by AI vision`,
    humanValues && `${humanValues} human corrected`,
  ]
    .filter(Boolean)
    .join(' · ')

  const stages: Stage[] = [
    {
      name: 'Classify email',
      engines: [result.classification.method === 'gemini' ? 'gemini' : 'rule'],
      detail: result.classification.category
        ? categoryLabels[result.classification.category]
        : 'Needs human classification',
    },
  ]
  if (result.documents.length) {
    const parsed = result.documents.filter((document) => document.state === 'PARSED').length
    const units = result.documents.reduce((total, document) => total + document.units.length, 0)
    stages.push({
      name: 'Read sources',
      engines: ['rule'],
      detail: `${parsed}/${result.documents.length} parsed · ${units} source units`,
    })
  }
  if (values.length) {
    stages.push({
      name: 'Extract values',
      engines: engines.length ? engines : ['rule'],
      detail: detail || `${values.length} values`,
    })
    stages.push({
      name: 'Check readiness',
      engines: ['rule'],
      detail: result.review_requirements.length
        ? `${result.review_requirements.length} blocker${
            result.review_requirements.length > 1 ? 's' : ''
          } raised`
        : 'No blocker raised',
    })
    stages.push({
      name: 'Compare seven fields',
      engines: ['rule'],
      detail: `${result.coverage.checked}/${result.coverage.total} checked · ${
        result.known_defect_fields.length
      } discrepanc${result.known_defect_fields.length === 1 ? 'y' : 'ies'}`,
    })
  }
  if (reviewed) {
    stages.push({
      name: 'Human review',
      engines: ['human'],
      detail: `${reviewed} value${reviewed > 1 ? 's' : ''} confirmed or corrected`,
    })
  }
  return stages
}

function tokenTotal(usage: Record<string, number | null> | null): number | null {
  if (!usage) return null
  const total = Object.entries(usage).find(
    ([key, value]) => typeof value === 'number' && /total/i.test(key),
  )
  if (total) return total[1] as number
  const numbers = Object.values(usage).filter((value): value is number => typeof value === 'number')
  return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) : null
}

export function RunProvenance({
  result,
  revision,
  mode,
  pipelineVersion,
}: {
  result: Result | null
  revision: number
  mode?: string
  pipelineVersion?: string
}) {
  const [open, setOpen] = useState(false)

  const engines: Engine[] = []
  let calls: NonNullable<Result['provider_calls']> = []
  let values: Result['fields'][number]['si'][] = []
  let ruleValues = 0
  if (result) {
    calls = result.provider_calls ?? []
    values = result.fields.flatMap((field) => [field.si, field.bl])
    ruleValues = values.filter((value) => value.method === 'rule').length
    const hasGemini =
      calls.length > 0 ||
      result.classification.method === 'gemini' ||
      values.some((value) => value.method === 'gemini_text' || value.method === 'gemini_vision')
    if (ruleValues || !hasGemini) engines.push('rule')
    if (hasGemini) engines.push('gemini')
    if (values.some((value) => value.method === 'human')) engines.push('human')
  }

  const Caret = open ? CaretDownIcon : CaretRightIcon
  const sourceName = (documentId: string | null) => {
    if (!documentId || !result) return null
    const source = result.documents.find((document) => document.id === documentId)
    return source?.role ? (roleLabels[source.role] ?? null) : null
  }

  return (
    <div className="run-provenance">
      <div className="version-bar">
        <div className="document-pair">
          <span>
            Source revision <strong>{revision}</strong>
          </span>
          {result ? (
            <button
              type="button"
              className="provenance-toggle"
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
            >
              <Caret size={13} weight="bold" aria-hidden="true" />
              <span className="provenance-mode">
                {mode === 'precomputed' ? 'Precomputed' : 'On demand'}
              </span>
              {engines.map((engine) => (
                <EngineTag key={engine} engine={engine} />
              ))}
              <span className="small-text">
                {calls.length === 0
                  ? 'no AI request'
                  : `${calls.length} AI request${calls.length > 1 ? 's' : ''}`}
              </span>
            </button>
          ) : (
            <span>Not analyzed</span>
          )}
        </div>
        <span className="small-text">{pipelineVersion} · Saved locally</span>
      </div>
      {open && result && (
        <div className="provenance-detail">
          <ol className="pipeline-stages">
            {buildStages(result).map((stage, index) => (
              <li key={stage.name}>
                <span className="pipeline-step" aria-hidden="true">
                  {index + 1}
                </span>
                <div className="pipeline-body">
                  <div className="pipeline-name">
                    <strong>{stage.name}</strong>
                    {stage.engines.map((engine) => (
                      <EngineTag key={engine} engine={engine} />
                    ))}
                  </div>
                  <p className="small-text">{stage.detail}</p>
                </div>
              </li>
            ))}
          </ol>
          {values.length > 0 && (
            <p className="small-text provenance-share">
              {ruleValues > 0
                ? `${ruleValues} of ${values.length} values resolved by deterministic rules, at no API cost.`
                : `All ${values.length} values came from sources that deterministic rules could not read.`}
            </p>
          )}
          {calls.length > 0 && (
            <ul className="provider-records">
              {calls.map((call, index) => {
                const tokens = tokenTotal(call.usage)
                return (
                  <li key={`${call.operation ?? 'call'}-${call.response_id ?? index}`}>
                    <div className="provider-operation">
                      <SparkleIcon size={14} weight="bold" aria-hidden="true" />
                      <strong>
                        {(call.operation && (operationLabels[call.operation] ?? call.operation)) ||
                          'AI request'}
                      </strong>
                      {sourceName(call.document_id) && (
                        <span className="small-text">{sourceName(call.document_id)}</span>
                      )}
                    </div>
                    <dl className="provider-meta">
                      <div>
                        <dt>Model</dt>
                        <dd>{call.model_version ?? call.configured_model}</dd>
                      </div>
                      <div>
                        <dt>Prompt</dt>
                        <dd>{call.prompt_version}</dd>
                      </div>
                      <div>
                        <dt>Duration</dt>
                        <dd className="numeric">
                          {Math.round(call.duration_ms).toLocaleString()} ms
                        </dd>
                      </div>
                      <div>
                        <dt>Tokens</dt>
                        <dd className="numeric">
                          {tokens === null ? 'Not reported' : tokens.toLocaleString()}
                        </dd>
                      </div>
                      <div>
                        <dt>Cost</dt>
                        <dd>{call.cost_usd === null ? 'Unavailable' : `$${call.cost_usd}`}</dd>
                      </div>
                      {call.response_id && (
                        <div className="provider-response">
                          <dt>Response</dt>
                          <dd>{call.response_id}</dd>
                        </div>
                      )}
                    </dl>
                  </li>
                )
              })}
            </ul>
          )}
          <p className="small-text provenance-note">
            Rules own normalization, comparison and every match decision. Gemini reads sources that
            rules cannot and drafts wording; it never decides whether two documents agree.
          </p>
        </div>
      )}
    </div>
  )
}
