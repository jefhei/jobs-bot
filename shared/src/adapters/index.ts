import { JobSource } from "../types";
import { BaseSourceAdapter } from "./base";
import { IndeedAdapter } from "./indeed";
import { GreenhouseAdapter } from "./greenhouse";
import { LeverAdapter } from "./lever";
import { LinkedInAdapter } from "./linkedin";

const adapters = new Map<JobSource, BaseSourceAdapter>();

export function getAdapter(source: JobSource): BaseSourceAdapter {
  if (!adapters.has(source)) {
    switch (source) {
      case "indeed":
        adapters.set(source, new IndeedAdapter());
        break;
      case "greenhouse":
        adapters.set(source, new GreenhouseAdapter());
        break;
      case "lever":
        adapters.set(source, new LeverAdapter());
        break;
      case "linkedin":
        adapters.set(source, new LinkedInAdapter());
        break;
      default:
        throw new Error(`Unknown source: ${source}`);
    }
  }
  return adapters.get(source)!;
}

export function searchAllSources(
  query: string,
  options?: any,
  sources?: JobSource[]
): Promise<{ source: JobSource; jobs: NormalizedJob[]; error?: string }[]> {
  const sourceList = sources || (["indeed", "greenhouse", "lever", "linkedin"] as JobSource[]);
  return Promise.allSettled(
    sourceList.map(async (source) => {
      try {
        const adapter = getAdapter(source);
        const jobs = await adapter.search(query, options);
        return { source, jobs };
      } catch (err) {
        return { source, jobs: [], error: (err as Error).message };
      }
    })
  ).then((results) =>
    results.map((r) =>
      r.status === "fulfilled" ? r.value : { source: "unknown" as JobSource, jobs: [], error: r.reason?.message }
    )
  );
}

import { NormalizedJob } from "../types";
