import { useEffect, useMemo, useState } from "react";
import type { VersionProjection } from "@powerflex/shared-schema";
import { api, type BugRow, type ChangeEntry, type FeatureRow, type KnownIssueRow, type MatrixRow } from "./api.js";

type Tab = "timeline" | "matrix" | "bugs" | "features";

const severityOrder: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, unknown: 0 };

export function App() {
  const [tab, setTab] = useState<Tab>("timeline");
  const [dark, setDark] = useState(true);
  const [search, setSearch] = useState("");
  const [kubernetes, setKubernetes] = useState("");
  const [openshift, setOpenshift] = useState("");
  const [version, setVersion] = useState("");   // CSI PowerFlex version
  const [allVersions, setAllVersions] = useState<VersionProjection[]>([]); // full list for dropdowns
  const [versions, setVersions] = useState<VersionProjection[]>([]);
  const [matrix, setMatrix] = useState<MatrixRow[]>([]);
  const [bugs, setBugs] = useState<BugRow[]>([]);
  const [knownIssues, setKnownIssues] = useState<KnownIssueRow[]>([]);
  const [expandedVersion, setExpandedVersion] = useState<string | null>(null);
  const [expandedBug, setExpandedBug] = useState<string | null>(null);
  const [features, setFeatures] = useState<FeatureRow[]>([]);
  const [featureType, setFeatureType] = useState<"" | "feature" | "fix" | "chore">("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [bugsLoading, setBugsLoading] = useState(false);
  const [featuresLoading, setFeaturesLoading] = useState(false);

  const params = useMemo(
    () => ({
      q: search || undefined,
      kubernetes: kubernetes || undefined,
      openshift: openshift || undefined,
      operatorVersion: version || undefined   // param name kept for API compat
    }),
    [search, kubernetes, openshift, version]
  );

  const bugParams = useMemo(
    () => ({ q: search || undefined, version: version || undefined }),
    [search, version]
  );

  const issueParams = useMemo(
    () => ({ version: version || undefined }),
    [version]
  );

  const featureParams = useMemo(
    () => ({ version: version || undefined, q: search || undefined, type: featureType || undefined }),
    [version, search, featureType]
  );

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);

  useEffect(() => {
    api.versions({}).then(setAllVersions).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([api.versions(params), api.matrix(params)])
      .then(([vd, md]) => { setVersions(vd); setMatrix(md.rows); })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [params]);

  useEffect(() => {
    setBugsLoading(true);
    api.bugs(bugParams)
      .then((data) => setBugs(data.sort((a, b) => (severityOrder[b.severity] ?? 0) - (severityOrder[a.severity] ?? 0))))
      .catch(() => setBugs([]))
      .finally(() => setBugsLoading(false));
  }, [bugParams]);

  useEffect(() => {
    if (!issueParams.version) { setKnownIssues([]); return; }
    api.knownIssues(issueParams).then(setKnownIssues).catch(() => setKnownIssues([]));
  }, [issueParams]);

  useEffect(() => {
    if (tab !== "features") return;
    setFeaturesLoading(true);
    api.features(featureParams).then(setFeatures).catch(() => setFeatures([])).finally(() => setFeaturesLoading(false));
  }, [tab, featureParams]);

  const allKubernetes = unique(allVersions.flatMap((v) => v.kubernetes_supported));
  const allOpenShift = unique(allVersions.flatMap((v) => v.openshift_supported));
  const hasVersionFilter = !!(version || search);

  function toggleBug(id: string) {
    setExpandedBug((prev) => (prev === id ? null : id));
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Dell PowerFlex CSI Driver</p>
          <h1>Version Intelligence</h1>
        </div>
        <div className="actions">
          <input
            className="search"
            placeholder="Search version, bug, issue…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="iconButton" title="Toggle dark mode" onClick={() => setDark((v) => !v)}>
            {dark ? "D" : "L"}
          </button>
        </div>
      </header>

      <section className="filters">
        <select value={kubernetes} onChange={(e) => setKubernetes(e.target.value)}>
          <option value="">All Kubernetes</option>
          {allKubernetes.map((v) => <option key={v}>{v}</option>)}
        </select>
        <select value={openshift} onChange={(e) => setOpenshift(e.target.value)}>
          <option value="">All OpenShift</option>
          {allOpenShift.map((v) => <option key={v}>{v}</option>)}
        </select>
        <select value={version} onChange={(e) => setVersion(e.target.value)}>
          <option value="">Any CSI version</option>
          {allVersions.map((v) => (
            <option key={v.operator_version} value={v.operator_version}>CSI {v.operator_version}</option>
          ))}
        </select>
        <span className="status">{loading ? "Loading…" : `${versions.length} CSI versions`}</span>
      </section>

      <nav className="tabs" aria-label="Views">
        {(["timeline", "matrix", "bugs", "features"] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {label(t)}
          </button>
        ))}
      </nav>

      {error ? <div className="alert">API unavailable: {error}</div> : null}

      {tab === "timeline" ? (
        <section className="timeline">
          {versions.map((v) => (
            <article className="versionRow" key={v.operator_version}>
              <button className="rowHead" onClick={() => setExpandedVersion(expandedVersion === v.operator_version ? null : v.operator_version)}>
                <span>
                  <strong>PowerFlex CSI {v.operator_version}</strong>
                  {v.csi_driver_version
                    ? <small>via CSM Operator {v.csi_driver_version}</small>
                    : <small className="noData">compatibility data not yet available</small>}
                </span>
                <span className="chevron">{expandedVersion === v.operator_version ? "▲" : "▼"}</span>
              </button>
              {expandedVersion === v.operator_version ? (
                <div className="details">
                  <PillGroup title="Kubernetes" values={v.kubernetes_supported} />
                  <PillGroup title="OpenShift" values={v.openshift_supported} />
                  <PillGroup title="PowerFlex backend" values={v.powerflex_backend_version} />
                  <p>Released {new Date(v.release_date).toLocaleDateString()} · {v.bugs_fixed.length} bug fixes · {v.known_issues.length} known issues</p>
                </div>
              ) : null}
            </article>
          ))}
        </section>
      ) : null}

      {tab === "matrix" ? <Matrix rows={matrix} /> : null}

      {tab === "features" ? (
        <>
          <section className="tabFilters">
            <label>Type:</label>
            <select value={featureType} onChange={(e) => setFeatureType(e.target.value as typeof featureType)}>
              <option value="">All changes</option>
              <option value="feature">Features</option>
              <option value="fix">Bug fixes</option>
              <option value="chore">Other</option>
            </select>
            {featuresLoading
              ? <span className="status">Loading…</span>
              : <span className="status">{features.reduce((n, r) => n + r.changes.length, 0)} entries across {features.length} versions</span>}
          </section>
          {features.length === 0 && !featuresLoading
            ? <div className="alert">No changes found. Pick a CSI version or adjust the filters above.</div>
            : features.map((row) => (
              <section className="issueSection" key={row.version}>
                <h2 className="sectionTitle">
                  CSI {row.version}
                  <span className="sectionVersion">{new Date(row.release_date).toLocaleDateString()}</span>
                  {row.release_url ? <a href={row.release_url} target="_blank" rel="noreferrer" style={{ fontSize: "0.78rem", fontWeight: 400 }}>Release notes ↗</a> : null}
                </h2>
                {row.changes.map((change, i) => (
                  <article className="issueLine" key={i}>
                    <div className="issueLineHead" style={{ cursor: "default" }}>
                      <span className={`changeType ${change.type}`}>{change.type}</span>
                      <span className="issueText">{change.title}</span>
                      <span className="issueVersion">{change.author}</span>
                      <a href={change.pr_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>↗</a>
                    </div>
                  </article>
                ))}
              </section>
            ))}
        </>
      ) : null}

      {tab === "bugs" ? (
        <>
          <section className="tabFilters">
            {bugsLoading ? <span className="status">Loading…</span> : (
              <span className="status">
                {hasVersionFilter
                  ? `${bugs.length} bugs${knownIssues.length ? ` · ${knownIssues.length} known issues` : ""}`
                  : "Select a CSI version or search to filter"}
              </span>
            )}
          </section>

          {!hasVersionFilter ? (
            <div className="alert">Pick a CSI version from the dropdown above, or use the search bar to find specific bugs and known issues.</div>
          ) : null}

          {knownIssues.length > 0 ? (
            <section className="issueSection">
              <h2 className="sectionTitle">Known Issues <span className="sectionVersion">{version}</span></h2>
              {knownIssues.map((issue) => (
                <article className="issueLine" key={issue.id}>
                  <div className="issueLineHead" onClick={() => toggleBug(`ki:${issue.id}`)}>
                    <span className="severity unknown">known</span>
                    <span className="issueText">{issue.description}</span>
                    {issue.workaround ? <span className="workaround" title="Has workaround">WA</span> : null}
                    {issue.sourceUrl ? <a href={issue.sourceUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>↗</a> : null}
                    <span className="expandChevron">{expandedBug === `ki:${issue.id}` ? "▲" : "▼"}</span>
                  </div>
                  {expandedBug === `ki:${issue.id}` ? (
                    <div className="issueDetail">
                      <p>{issue.description}</p>
                      {issue.workaround ? <p><strong>Workaround:</strong> {issue.workaround}</p> : null}
                    </div>
                  ) : null}
                </article>
              ))}
            </section>
          ) : null}

          {bugs.length > 0 ? (
            <section className="issueSection">
              <h2 className="sectionTitle">Fixed Bugs {version ? <span className="sectionVersion">CSI {version}</span> : null}</h2>
              {bugs.map((bug) => (
                <article className="issueLine" key={bug.id}>
                  <div className="issueLineHead" onClick={() => toggleBug(`bug:${bug.id}`)}>
                    <span className={`severity ${bug.severity}`}>{bug.severity}</span>
                    <span className="issueText">
                      {bug.externalId ? <strong>{bug.externalId}</strong> : null}
                      {bug.externalId ? " – " : null}
                      {bug.title}
                    </span>
                    <span className="issueVersion">v{bug.fixedInVersion}</span>
                    {bug.sourceUrl ? <a href={bug.sourceUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>↗</a> : null}
                    <span className="expandChevron">{expandedBug === `bug:${bug.id}` ? "▲" : "▼"}</span>
                  </div>
                  {expandedBug === `bug:${bug.id}` ? (
                    <div className="issueDetail">
                      {bug.description && bug.description !== bug.title ? <p>{bug.description}</p> : null}
                      {bug.commitSha ? <p className="detailMeta">Commit: <code>{bug.commitSha.slice(0, 8)}</code></p> : null}
                    </div>
                  ) : null}
                </article>
              ))}
            </section>
          ) : hasVersionFilter ? (
            <p className="status" style={{ marginTop: 16 }}>No confirmed bug fixes found for this version.</p>
          ) : null}
        </>
      ) : null}
    </main>
  );
}

function Matrix({ rows }: { rows: MatrixRow[] }) {
  return (
    <section className="tableWrap">
      <table>
        <thead>
          <tr>
            <th>PowerFlex CSI</th>
            <th>CSM Operator</th>
            <th>Kubernetes</th>
            <th>OpenShift</th>
            <th>PowerFlex backend</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.operator_version}>
              <td>{row.operator_version}</td>
              <td>{row.csi_driver_version || "—"}</td>
              <td>{row.kubernetes.join(", ") || "—"}</td>
              <td>{row.openshift.join(", ") || "—"}</td>
              <td>{row.powerflex_backend.join(", ") || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function PillGroup({ title, values }: { title: string; values: string[] }) {
  return (
    <div className="pillGroup">
      <span>{title}</span>
      {(values.length ? values : ["—"]).map((v) => <b key={v}>{v}</b>)}
    </div>
  );
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function label(tab: Tab) {
  return { timeline: "Timeline", matrix: "Matrix", bugs: "Bugs & Issues", features: "Changelog" }[tab];
}
