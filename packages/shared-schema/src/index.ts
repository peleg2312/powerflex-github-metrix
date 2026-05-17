import { z } from "zod";

export const SourceKindSchema = z.enum(["github", "docs", "legacy"]);
export const CompatibilityStatusSchema = z.enum(["supported", "unsupported", "inferred", "unknown"]);
export const SeveritySchema = z.enum(["critical", "high", "medium", "low", "unknown"]);

export const BugFixSchema = z.object({
  id: z.string(),
  description: z.string(),
  fixed_in_version: z.string(),
  commit_sha: z.string().nullable().optional(),
  severity: SeveritySchema,
  source_url: z.string().url().optional(),
  confidence: z.number().min(0).max(1).default(0.5)
});

export const VersionProjectionSchema = z.object({
  operator_version: z.string(),
  csi_driver_version: z.string().nullable().default("unknown"),
  kubernetes_supported: z.array(z.string()).default([]),
  openshift_supported: z.array(z.string()).default([]),
  powerflex_backend_version: z.array(z.string()).default([]),
  bugs_fixed: z.array(BugFixSchema).default([]),
  known_issues: z.array(z.string()).default([]),
  release_date: z.string(),
  risk_score: z.number().min(0).max(100).default(0),
  confidence: z.number().min(0).max(1).default(0.5)
});

export const CompatibilityCellSchema = z.object({
  operator_version: z.string(),
  csi_driver_version: z.string().nullable(),
  target_kind: z.enum(["kubernetes", "openshift", "powerflex_backend", "csm", "csi_driver"]),
  target_version: z.string(),
  status: CompatibilityStatusSchema,
  confidence: z.number().min(0).max(1),
  source_url: z.string().url().optional()
});

export const RecommendationSchema = z.object({
  operator_version: z.string(),
  csi_driver_version: z.string().nullable(),
  score: z.number().min(0).max(100),
  risk_score: z.number().min(0).max(100),
  reasons: z.array(z.string())
});

export const UpgradeStepSchema = z.object({
  from_version: z.string(),
  to_version: z.string(),
  risk_score: z.number().min(0).max(100),
  notes: z.array(z.string())
});

export type BugFix = z.infer<typeof BugFixSchema>;
export type VersionProjection = z.infer<typeof VersionProjectionSchema>;
export type CompatibilityCell = z.infer<typeof CompatibilityCellSchema>;
export type Recommendation = z.infer<typeof RecommendationSchema>;
export type UpgradeStep = z.infer<typeof UpgradeStepSchema>;

export type VersionFilters = {
  operatorVersion?: string;
  csiDriverVersion?: string;
  kubernetes?: string;
  openshift?: string;
  powerflexBackend?: string;
  severity?: string;
  source?: string;
  from?: string;
  to?: string;
  q?: string;
};
