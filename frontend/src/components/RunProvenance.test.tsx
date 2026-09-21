import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { Extraction, FieldResult, Result } from '../mailbox/types'
import { RunProvenance } from './RunProvenance'

function value(method: Extraction['method'], reviewed = false): Extraction {
  return {
    raw_value: 'ACME LTD',
    normalized_value: 'ACME LTD',
    value_state: 'PRESENT',
    method,
    requires_human_confirmation: false,
    reason: 'shared_extractor',
    evidence: [],
    ...(reviewed
      ? {
          review: {
            id: 'r1',
            task_id: 't1',
            revision: 1,
            run_id: 'run1',
            document_id: 'si',
            field: 'shipper' as const,
            action: 'CONFIRM_CANDIDATE' as const,
            machine_raw_value: 'ACME LTD',
            raw_value: 'ACME LTD',
            normalized_value: 'ACME LTD',
            page: 1,
            unit_id: 'unit-1',
            actor: 'Demo reviewer',
            created_at: '2026-09-21T00:00:00Z',
          },
        }
      : {}),
  }
}

function field(method: Extraction['method'], reviewed = false): FieldResult {
  return {
    key: 'shipper',
    si: value(method, reviewed),
    bl: value(method, reviewed),
    finding: 'MATCH',
  }
}

function result(overrides: Partial<Result> = {}): Result {
  return {
    classification: { category: 'BL_COMPARISON', method: 'rule', status: 'CLASSIFIED', reason: '' },
    documents: [{ id: 'si', role: 'si', state: 'PARSED', units: [], error: null }],
    fields: [field('rule')],
    review_requirements: [],
    known_defect_fields: [],
    coverage: { checked: 7, total: 7 },
    workflow_state: 'READY',
    processing_status: 'SUCCEEDED',
    ...overrides,
  }
}

function view(saved: Result | null, revision = 1) {
  return render(
    <RunProvenance result={saved} revision={revision} mode="on_demand" pipelineVersion="rules-1" />,
  )
}

describe('RunProvenance', () => {
  it('keeps stage detail collapsed and summarises the run in one line', async () => {
    view(result())
    expect(screen.getByText('Source revision')).toBeInTheDocument()
    expect(screen.getByText('On demand')).toBeInTheDocument()
    expect(screen.getByText('Rules')).toBeInTheDocument()
    expect(screen.getByText('no AI request')).toBeInTheDocument()
    // The workspace answers "what differs"; provenance stays out of the way.
    expect(screen.queryByText('Compare seven fields')).not.toBeInTheDocument()

    const toggle = screen.getByRole('button')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Classify email')).toBeInTheDocument()
    expect(screen.getByText('7/7 checked · 0 discrepancies')).toBeInTheDocument()
    expect(
      screen.getByText('2 of 2 values resolved by deterministic rules, at no API cost.'),
    ).toBeInTheDocument()
  })

  it('credits Gemini and human work and reveals the saved provider record', async () => {
    view(
      result({
        classification: {
          category: 'BL_COMPARISON',
          method: 'gemini',
          status: 'CLASSIFIED',
          reason: '',
        },
        fields: [field('gemini_vision', true)],
        provider_calls: [
          {
            operation: 'vision_extraction',
            document_id: 'si',
            provider: 'gemini',
            configured_model: 'gemini-3.8-flash',
            model_version: 'gemini-3.8-flash-001',
            response_id: 'resp-42',
            prompt_version: 'vision-extraction-v1',
            duration_ms: 1842.6,
            usage: { total_token_count: 412 },
            cost_usd: null,
          },
        ],
      }),
      2,
    )
    expect(screen.getByText('Gemini')).toBeInTheDocument()
    expect(screen.getByText('1 AI request')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button'))

    expect(screen.getByText('Human review')).toBeInTheDocument()
    expect(screen.getByText('2 values confirmed or corrected')).toBeInTheDocument()
    expect(screen.getByText('Scanned-page extraction')).toBeInTheDocument()
    // The record names the source by role, never by its opaque identifier.
    expect(screen.getByText('Shipping instruction')).toBeInTheDocument()
    expect(screen.getByText('gemini-3.8-flash-001')).toBeInTheDocument()
    expect(screen.getByText('vision-extraction-v1')).toBeInTheDocument()
    expect(screen.getByText('1,843 ms')).toBeInTheDocument()
    expect(screen.getByText('412')).toBeInTheDocument()
    // Cost is never invented when the provider does not report it.
    expect(screen.getByText('Unavailable')).toBeInTheDocument()
    expect(screen.getByText('resp-42')).toBeInTheDocument()
  })

  it('falls back to a plain label when a saved record has no operation', async () => {
    view(
      result({
        provider_calls: [
          {
            document_id: null,
            provider: 'gemini',
            configured_model: 'gemini-3.8-flash',
            model_version: null,
            response_id: null,
            prompt_version: 'scan-seven-fields-v1',
            duration_ms: 3264.666,
            usage: null,
            cost_usd: null,
          } as unknown as NonNullable<Result['provider_calls']>[number],
        ],
      }),
    )
    await userEvent.click(screen.getByRole('button'))
    expect(screen.getByText('AI request')).toBeInTheDocument()
    expect(screen.getByText('3,265 ms')).toBeInTheDocument()
    expect(screen.getByText('Not reported')).toBeInTheDocument()
  })

  it('reports an unanalyzed task without inventing provenance', () => {
    view(null)
    expect(screen.getByText('Not analyzed')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
