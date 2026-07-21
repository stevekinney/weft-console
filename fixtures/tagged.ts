/**
 * Tags + search-attributes demo fixture (plan §11, Appendix B "Workflow list
 * (default/bulk-selection/empty×2/denied)" filter facets). Registers a
 * search-attribute schema and starts several runs with varied run-level tags
 * and search attributes so the console's filter UI has real facets to filter
 * on. See `fixtures/workflows.ts` for the append-only contract this file
 * participates in.
 */
import {
  activity,
  workflow,
  type SearchAttributeValue,
  type WorkflowHandle,
} from '@lostgradient/weft';

interface OutreachCampaignInput {
  customerId: string;
  region: string;
  tier: string;
}

const sendOutreachMessage = activity({
  name: 'sendOutreachMessage',
  execute: async (input: { customerId: string }) => {
    return { customerId: input.customerId, sent: true };
  },
});

export const outreachCampaign = workflow({ name: 'customer-outreach-campaign' })
  .activities({ sendOutreachMessage })
  .searchAttributes({
    region: { type: 'string' },
    tier: { type: 'string' },
  })
  .execute(async function* (ctx, input: OutreachCampaignInput) {
    return yield* ctx.run(sendOutreachMessage, { customerId: input.customerId });
  });

/** Registerable workflow map — merged into `fixtures/workflows.ts`'s registry. */
export const taggedWorkflows = {
  'customer-outreach-campaign': outreachCampaign,
};

/** Narrow structural interface — see `fixtures/workflows.ts` for the pattern. */
export interface TaggedEngine {
  start(
    name: 'customer-outreach-campaign',
    input: OutreachCampaignInput,
    options?: { tags?: string[]; searchAttributes?: Record<string, SearchAttributeValue> },
  ): Promise<WorkflowHandle<unknown>>;
}

interface OutreachRun {
  customerId: string;
  region: string;
  tier: string;
  tags: string[];
}

const OUTREACH_RUNS: readonly OutreachRun[] = [
  { customerId: 'cust_9001', region: 'us-east', tier: 'gold', tags: ['priority-customer', 'beta'] },
  { customerId: 'cust_9002', region: 'us-west', tier: 'silver', tags: ['beta'] },
  { customerId: 'cust_9003', region: 'eu-central', tier: 'gold', tags: ['priority-customer'] },
  { customerId: 'cust_9004', region: 'apac', tier: 'bronze', tags: [] },
];

/**
 * Starts one run per `OUTREACH_RUNS` entry, each with distinct tags and
 * search attributes, and awaits every run so the filter demo data is
 * durably settled before the dev server starts serving.
 */
export async function seedTagged(engine: TaggedEngine): Promise<void> {
  for (const run of OUTREACH_RUNS) {
    const handle = await engine.start(
      'customer-outreach-campaign',
      { customerId: run.customerId, region: run.region, tier: run.tier },
      { tags: run.tags, searchAttributes: { region: run.region, tier: run.tier } },
    );
    await handle.result();
  }
}
