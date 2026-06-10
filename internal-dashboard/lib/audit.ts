import { createRecords, getSignalRows, listRecords } from "./airtable";

type Severity = "critical" | "high" | "medium" | "low";

type Finding = {
  severity: Severity;
  gate: string;
  issue: string;
  mitigation: string;
  metric?: string;
};

function countBy(records: Awaited<ReturnType<typeof listRecords>>, field: string) {
  const counts: Record<string, number> = {};
  for (const record of records) {
    const value = String(record.fields[field] || "Blank");
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

function pct(part: number, total: number) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

function severityRank(severity: Severity) {
  return { critical: 0, high: 1, medium: 2, low: 3 }[severity];
}

function reportPeriod() {
  return new Date().toISOString().slice(0, 10);
}

function formatFinding(finding: Finding) {
  return [
    `[${finding.severity.toUpperCase()}] ${finding.gate}`,
    `Issue: ${finding.issue}`,
    finding.metric ? `Metric: ${finding.metric}` : "",
    `Mitigation: ${finding.mitigation}`
  ]
    .filter(Boolean)
    .join("\n");
}

export async function runDoctrineAudit() {
  const [signals, scores, prospects, outreach, replies, clients, reports, suppressions, signalRows] =
    await Promise.all([
      listRecords("Signals", 100),
      listRecords("Scores", 100),
      listRecords("Broker Prospects", 100),
      listRecords("Outreach", 100),
      listRecords("Replies", 100),
      listRecords("Clients", 100),
      listRecords("Reports", 100),
      listRecords("Suppression List", 100),
      getSignalRows()
    ]);

  const findings: Finding[] = [];
  const outreachStatus = countBy(outreach, "Status");
  const prospectStatus = countBy(prospects, "Status");
  const replyIntent = countBy(replies, "Intent");
  const reportStatus = countBy(reports, "Status");

  const sent = outreachStatus.Sent || 0;
  const queued = outreachStatus.Queued || 0;
  const needsContact = prospectStatus["Needs Contact"] || 0;
  const qualified = prospectStatus.Qualified || 0;
  const badFitReplies = replyIntent["Bad Fit"] || 0;
  const interestedReplies = (replyIntent.Interested || 0) + (replyIntent["Needs Info"] || 0);
  const draftReports = reportStatus.Draft || 0;

  if (!signals.length) {
    findings.push({
      severity: "critical",
      gate: "Signal Supply",
      issue: "No signal records exist in Airtable.",
      mitigation: "Run signal-scan, verify Firecrawl/DataForSEO credits, and reject any source without evidence URL before client delivery."
    });
  }

  const missingEvidence = signalRows.filter((row) => !row.evidenceUrl || row.evidenceUrl === "Review required").length;
  if (missingEvidence) {
    findings.push({
      severity: "high",
      gate: "Evidence Quality",
      issue: "Some signal rows do not have a usable evidence URL.",
      metric: `${missingEvidence}/${signalRows.length} signal rows missing evidence URL`,
      mitigation: "Hold those rows from paid reports, rerun extraction, or downgrade confidence until source evidence is restored."
    });
  }

  const weakContactRows = signalRows.filter((row) => String(row.contactPath || "").includes("Direct email/phone: include only when verified")).length;
  if (weakContactRows) {
    findings.push({
      severity: "medium",
      gate: "Buyer Contact Path",
      issue: "Some shipper signal records still need verified direct contact routes.",
      metric: `${weakContactRows}/${signalRows.length} signal rows need contact enrichment`,
      mitigation: "Route those rows through Clay CSV/contact enrichment before using them in a premium paid feed."
    });
  }

  if (prospects.length && pct(needsContact, prospects.length) >= 35) {
    findings.push({
      severity: "high",
      gate: "Contact Quality",
      issue: "A large share of buyer prospects need verified contacts.",
      metric: `${needsContact}/${prospects.length} prospects need contact (${pct(needsContact, prospects.length)}%)`,
      mitigation: "Prioritize Clay CSV enrichment, contact verification, domain-match checks, and direct-role filtering before increasing send volume."
    });
  }

  if (sent >= 8 && interestedReplies === 0) {
    findings.push({
      severity: "high",
      gate: "Conversion Learning",
      issue: "Outreach has volume but no warm replies recorded.",
      metric: `${sent} sent outreach records, ${interestedReplies} interested/needs-info replies`,
      mitigation: "Audit deliverability, direct-contact quality, subject line, sample click behavior, and buyer persona fit before scaling sends."
    });
  }

  if (outreach.length && queued === 0 && qualified > 0) {
    findings.push({
      severity: "medium",
      gate: "Outreach Queue",
      issue: "Qualified prospects exist but no queued outreach is available.",
      metric: `${qualified} qualified prospects, ${queued} queued outreach records`,
      mitigation: "Regenerate compliant outreach drafts for qualified prospects and preserve suppression/domain-match gates."
    });
  }

  if (badFitReplies >= 5) {
    findings.push({
      severity: "medium",
      gate: "Reply Noise",
      issue: "Reply classifier has accumulated bad-fit/noise responses.",
      metric: `${badFitReplies} bad-fit replies`,
      mitigation: "Keep vendor/tool emails suppressed, dedupe replies, and only treat logistics buyer replies as conversion signals."
    });
  }

  if (!clients.length && sent >= 8) {
    findings.push({
      severity: "high",
      gate: "Revenue Proof",
      issue: "No active clients are recorded after initial outreach volume.",
      metric: `${clients.length} clients, ${sent} sent outreach records`,
      mitigation: "Tighten positioning around timing intelligence, strengthen sample preview, and test a lower-friction sample-request path before broad scaling."
    });
  }

  if (draftReports > 6) {
    findings.push({
      severity: "low",
      gate: "Report Hygiene",
      issue: "Draft reports are accumulating.",
      metric: `${draftReports} draft reports`,
      mitigation: "Archive stale internal reports or mark delivered reports as Sent to keep the operating record clean."
    });
  }

  if (suppressions.length) {
    findings.push({
      severity: "low",
      gate: "Suppression Control",
      issue: "Suppression list is active.",
      metric: `${suppressions.length} suppressed contacts`,
      mitigation: "Keep suppression checks ahead of every send and never re-enroll opted-out contacts."
    });
  }

  if (!findings.length) {
    findings.push({
      severity: "low",
      gate: "Doctrine Supervisor",
      issue: "No immediate operating breakpoints detected.",
      mitigation: "Continue scheduled scans, outreach, reply classification, and conversion tracking."
    });
  }

  findings.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));

  const summary = [
    "FreightTrigger Doctrine Audit",
    "",
    "Metrics:",
    `Signals: ${signals.length}`,
    `Scores: ${scores.length}`,
    `Prospects: ${prospects.length}`,
    `Outreach: ${outreach.length}`,
    `Replies: ${replies.length}`,
    `Clients: ${clients.length}`,
    `Reports: ${reports.length}`,
    `Suppressions: ${suppressions.length}`,
    "",
    "Findings:",
    ...findings.map(formatFinding)
  ].join("\n\n");

  const [auditRecord] = await createRecords("Reports", [
    {
      "Report Name": `Doctrine Audit - ${new Date().toISOString().slice(0, 16)}`,
      "Report Period": reportPeriod(),
      "Status": "Draft",
      "AI Executive Summary": summary
    }
  ]);

  return {
    ranAt: new Date().toISOString(),
    auditRecordId: auditRecord?.id,
    metrics: {
      signals: signals.length,
      scores: scores.length,
      prospects: prospects.length,
      outreach: outreach.length,
      replies: replies.length,
      clients: clients.length,
      reports: reports.length,
      suppressions: suppressions.length,
      outreachStatus,
      prospectStatus,
      replyIntent,
      reportStatus
    },
    findings
  };
}
