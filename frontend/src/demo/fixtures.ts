import { fieldLabels, type FieldKey, type FieldResult, type Revision, type Task } from './model'

// Team-authored UI fixtures. These are not pipeline predictions or organizer ground truth.
const standard: Record<FieldKey, string> = {
  shipper: 'MERIDIAN EXPORTS SDN. BHD.',
  consignee: 'EAST BRIGHT FZ-LLC',
  notify_party: 'EAST BRIGHT FZ-LLC',
  port_of_loading: 'PORT KLANG',
  port_of_discharge: 'JEBEL ALI',
  container_count: '5',
  gross_weight_kg: '131,058 KG',
}
function fields(
  si: Partial<Record<FieldKey, string>> = {},
  bl: Partial<Record<FieldKey, string>> = {},
): FieldResult[] {
  return (Object.keys(fieldLabels) as FieldKey[]).map((key, i) => {
    const make = (raw: string) => ({
      raw,
      evidence: { locator: `Line ${i + 3}`, text: `${fieldLabels[key]}: ${raw}`, value: raw },
    })
    return { key, si: make(si[key] ?? standard[key]), bl: make(bl[key] ?? standard[key]) }
  })
}
function version(id: string, number = 1, data = fields()): Revision {
  return {
    number,
    fields: data,
    documents: [
      { id: `${id}-si-1`, role: 'si', version: 1, filename: `${id}_SI_v1.txt` },
      {
        id: `${id}-bl-${number}`,
        role: 'bl',
        version: number,
        filename: `${id}_BL_v${number}.txt`,
      },
    ],
  }
}
function task(
  id: string,
  subject: string,
  sender: string,
  initials: string,
  color: string,
  minutes: string,
  revisions = [version(id)],
): Task {
  return {
    id,
    subject,
    sender,
    initials,
    color,
    email: `${sender.toLowerCase().replace(/[^a-z]/g, '')}@example.com`,
    category: 'BL_COMPARISON',
    reference: `DG-${id}`,
    route: 'Port Klang → Jebel Ali',
    updatedAt: `2026-09-20T08:${minutes}:00Z`,
    currentRevision: 1,
    revisions,
    reviews: [],
    body: `Hello team,\n\nPlease check the attached draft bill of lading against our shipping instruction for shipment ${id}. Let us know if any details need correcting before we proceed.\n\nThank you,\n${sender}`,
  }
}
export function createSeedTasks(): Task[] {
  const revisions = [
    version('004', 1, fields({}, { consignee: 'UAB NOVAKOPA', notify_party: 'UAB NOVAKOPA' })),
    version('004', 2, fields({}, { gross_weight_kg: '130,058 KG' })),
    version('004', 3),
  ]
  const mismatch = task(
    '004',
    'Draft BL for review · Jebel Ali shipment',
    'Amelia Chen',
    'AC',
    'blue',
    '42',
    revisions,
  )
  const missingValue = task(
    '516',
    'Please verify SI & BL · September booking',
    'Daniel Wong',
    'DW',
    'violet',
    '36',
    [version('516', 1, fields({ gross_weight_kg: 'N/A' }, { gross_weight_kg: '235,550 KG' }))],
  )
  const scanned = task(
    '512',
    'Scanned documents · final check requested',
    'Sofia Rahman',
    'SR',
    'rose',
    '28',
  )
  scanned.revisions[0].fields[6].bl.candidate = true
  const missingDoc = task(
    '083',
    'Shipping instruction · awaiting carrier draft',
    'Marcus Tan',
    'MT',
    'amber',
    '20',
  )
  missingDoc.revisions[0].issue = 'missing_attachment'
  missingDoc.revisions[0].documents = missingDoc.revisions[0].documents.filter(
    (d) => d.role === 'si',
  )
  missingDoc.revisions[0].fields = fields().map((f) => ({ ...f, bl: { raw: '', evidence: null } }))
  const wrong = task(
    '091',
    'Re: Draft BL attachments for checking',
    'Olivia Lee',
    'OL',
    'teal',
    '12',
  )
  wrong.revisions[0].issue = 'wrong_doc_type'
  wrong.revisions[0].documents[1].filename = '091_invoice.txt'
  wrong.revisions[0].fields = fields().map((f) => ({ ...f, bl: { raw: '', evidence: null } }))
  const unreadable = task(
    '511',
    'Draft BL · attachment verification',
    'Ethan Lim',
    'EL',
    'slate',
    '08',
  )
  unreadable.revisions[0].issue = 'unreadable'
  unreadable.revisions[0].fields = fields().map((f) => ({ ...f, bl: { raw: '', evidence: null } }))
  const misread = task(
    '160',
    'Weight extraction · source confirmation needed',
    'Daniel Wong',
    'DW',
    'violet',
    '24',
    [version('160', 1, fields({ gross_weight_kg: '88,750 KG' }, { gross_weight_kg: '88,750 KG' }))],
  )
  misread.revisions[0].fields[6].bl.raw = '88,570 KG'
  const ready = task(
    '028',
    'Draft BL confirmation · all details updated',
    'Amelia Chen',
    'AC',
    'blue',
    '04',
  )
  const complete = task(
    '055',
    'Shipment 055 · documentation check',
    'Sofia Rahman',
    'SR',
    'rose',
    '00',
  )
  complete.completedRevision = 1
  const extra = [
    [
      '102',
      'Shipping instruction needed for next sailing',
      'SI_REQUEST',
      'Please send the shipping instruction for our upcoming booking.',
    ],
    [
      '208',
      'Question about the freight invoice',
      'INVOICE_QUERY',
      'Could you clarify the handling charge on this invoice?',
    ],
    [
      '301',
      'September vessel schedule update',
      'GENERAL',
      'The updated vessel schedule will be shared with the operations team shortly.',
    ],
    [
      '409',
      'Exclusive freight offers this week',
      'SPAM',
      'Promotional sample message. No document verification is needed.',
    ],
  ] as const
  return [
    mismatch,
    missingValue,
    scanned,
    missingDoc,
    wrong,
    unreadable,
    ready,
    complete,
    misread,
    ...extra.map(([id, subject, category, body]) => ({
      ...task(id, subject, 'Operations Desk', 'OD', 'slate', '00'),
      category,
      body,
      route: 'Email only',
      revisions: [{ number: 1, documents: [], fields: [] }],
    })),
  ]
}
