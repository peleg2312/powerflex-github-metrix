export type GithubSource = {
  kind: "github";
  productSlug: string;
  productName: string;
  productKind: string;
  owner: string;
  repo: string;
  legacy?: boolean;
};

export type DocsSource = {
  kind: "docs";
  name: string;
  url: string;
  productSlug: string;
};

export type SourceConfig = {
  vendor: string;
  github: GithubSource[];
  docs: DocsSource[];
};

export const defaultSourceConfig: SourceConfig = {
  vendor: "Dell",
  github: [
    {
      kind: "github",
      productSlug: "csm-operator",
      productName: "Dell CSM Operator",
      productKind: "operator",
      owner: "dell",
      repo: "csm-operator"
    },
    {
      kind: "github",
      productSlug: "csi-powerflex",
      productName: "CSI Driver for Dell PowerFlex",
      productKind: "csi_driver",
      owner: "dell",
      repo: "csi-powerflex"
    },
    {
      kind: "github",
      productSlug: "dell-csi-operator-legacy",
      productName: "Dell CSI Operator Legacy",
      productKind: "legacy_operator",
      owner: "dell",
      repo: "dell-csi-operator",
      legacy: true
    }
  ],
  docs: [
    {
      kind: "docs",
      name: "Dell CSM Support Matrix",
      url: "https://dell.github.io/csm-docs/docs/supportmatrix/",
      productSlug: "csm-operator"
    },
    {
      kind: "docs",
      name: "PowerFlex via CSM Operator",
      url: "https://dell.github.io/csm-docs/v3/deployment/csmoperator/drivers/powerflex/",
      productSlug: "csi-powerflex"
    }
  ]
};

export function loadSourceConfig(path = process.env.SOURCE_CONFIG_PATH): SourceConfig {
  if (!path) return defaultSourceConfig;
  const parsed = JSON.parse(readFileSync(path, "utf8")) as SourceConfig;
  return parsed;
}
import { readFileSync } from "node:fs";
