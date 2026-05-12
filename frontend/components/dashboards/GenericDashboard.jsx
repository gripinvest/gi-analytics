"use client";

import * as React from "react";
import { runQuery } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardSubtitle, CardBody, Button, Badge } from "@/components/ui";

/* Fallback dashboard for a project that has no purpose-built component yet:
   the loaded tables plus a small ad-hoc SQL console. New projects get this
   for free until someone adds a dedicated dashboard to the registry. */

export default function GenericDashboard({ project }) {
  const [sql, setSql] = React.useState(
    project.tables?.length ? `SELECT * FROM "${project.tables[0]}" LIMIT 20` : "SELECT 1"
  );
  const [result, setResult] = React.useState(null);
  const [running, setRunning] = React.useState(false);

  async function run() {
    setRunning(true);
    try { setResult(await runQuery(project.id, sql, 200)); }
    catch (e) { setResult({ error: String((e && e.message) || e) }); }
    finally { setRunning(false); }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card pad="md">
        <CardHeader>
          <div><CardTitle>Loaded tables</CardTitle><CardSubtitle>{project.tables?.length || 0} DuckDB views. Click one to query it.</CardSubtitle></div>
        </CardHeader>
        <CardBody>
          <div className="flex flex-wrap gap-2">
            {(project.tables || []).map((t) => (
              <button key={t} onClick={() => setSql(`SELECT * FROM "${t}" LIMIT 20`)}
                className="rounded-xs border border-border-default bg-page px-2 py-1 font-mono t-emphasis-sm text-secondary hover:bg-tint-navy hover:text-navy-700">
                {t.replace(`${project.id}__`, "")}
              </button>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card pad="md">
        <CardHeader>
          <div><CardTitle>Ad-hoc query</CardTitle><CardSubtitle>SELECT only. Auto-limited. Or just ask the data instead.</CardSubtitle></div>
          <Button size="sm" onClick={run} disabled={running}>{running ? "Running…" : "Run"}</Button>
        </CardHeader>
        <CardBody>
          <textarea value={sql} onChange={(e) => setSql(e.target.value)} spellCheck={false} rows={3}
            className="w-full resize-y rounded-sm border border-border-default bg-page p-3 font-mono t-body-sm text-heading outline-none focus:border-navy-400" />
          {result && (
            <div className="mt-3">
              {result.error ? (
                <p className="rounded-sm bg-status-error-bg px-3 py-2 t-body-sm text-error-700">{result.error}</p>
              ) : (
                <div className="overflow-auto rounded-sm border border-border-default">
                  <table className="w-full border-collapse t-body-sm">
                    <thead><tr className="bg-muted t-overline text-tertiary text-left">
                      {(result.columns || []).map((c) => <th key={c} className="px-2 py-1.5 font-semibold whitespace-nowrap">{c}</th>)}
                    </tr></thead>
                    <tbody>
                      {(result.rows || []).slice(0, 50).map((row, i) => (
                        <tr key={i} className="border-t border-border-default">
                          {(result.columns || []).map((c) => <td key={c} className="px-2 py-1.5 whitespace-nowrap t-num">{String(row[c] ?? "")}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="bg-page px-2 py-1 t-body-xs text-tertiary">{result.row_count} rows{(result.rows || []).length > 50 ? " (showing 50)" : ""}</div>
                </div>
              )}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
