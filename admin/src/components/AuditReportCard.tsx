import * as React from 'react';
import { Typography } from '@strapi/design-system';
import { styled } from 'styled-components';

/**
 * A QA or security report (FR-041, FR-047).
 *
 * Findings are grouped by severity with counts, each showing its location, why it breaks, and the
 * suggested fix. The coverage statement is rendered ALWAYS and never collapsed: a pass that skipped
 * types for permissions or ran out of budget must not read as a clean bill of health (FR-044).
 *
 * Evidence arrives already masked — masking happens at the tool boundary, before the result reaches
 * the model or the transcript (FR-049). Nothing here unmasks anything.
 */

export type AuditSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface AuditFindingView {
  category: string;
  severity: AuditSeverity;
  location: { contentTypeUid?: string; documentId?: string; field?: string; configPath?: string };
  evidence: string;
  impact: string;
  remediation: string;
}

export interface AuditReportView {
  kind: 'qa' | 'security';
  runAt: string;
  coverage: { inspected: string[]; skippedForPermissions: string[]; skippedForBudget: string[] };
  counts: Record<AuditSeverity, number>;
  findings: AuditFindingView[];
}

const Card = styled.div`
  align-self: stretch;
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: 0.8rem;
  overflow: hidden;
`;

const Head = styled.div`
  padding: 0.9rem 1.2rem;
  background: ${({ theme }) => theme.colors.neutral100};
  border-bottom: 1px solid ${({ theme }) => theme.colors.neutral150};
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.8rem;
  justify-content: space-between;
`;

const Counts = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
`;

const Count = styled.span<{ $severity: AuditSeverity }>`
  font-size: 1.1rem;
  padding: 0.2rem 0.7rem;
  border-radius: 1rem;
  color: ${({ theme, $severity }) =>
    $severity === 'critical' || $severity === 'high'
      ? theme.colors.danger600
      : $severity === 'medium'
        ? theme.colors.warning600
        : theme.colors.neutral600};
  background: ${({ theme, $severity }) =>
    $severity === 'critical' || $severity === 'high'
      ? theme.colors.danger100
      : $severity === 'medium'
        ? theme.colors.warning100
        : theme.colors.neutral150};
`;

const Group = styled.div`
  border-bottom: 1px solid ${({ theme }) => theme.colors.neutral150};
`;

const GroupHead = styled.div<{ $severity: AuditSeverity }>`
  padding: 0.5rem 1.2rem;
  font-size: 1.15rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: ${({ theme, $severity }) =>
    $severity === 'critical' || $severity === 'high'
      ? theme.colors.danger700
      : $severity === 'medium'
        ? theme.colors.warning700
        : theme.colors.neutral700};
  background: ${({ theme }) => theme.colors.neutral0};
`;

const Finding = styled.div`
  padding: 0.7rem 1.2rem;
  border-top: 1px solid ${({ theme }) => theme.colors.neutral150};
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 1.2rem;
`;

const Where = styled.div`
  color: ${({ theme }) => theme.colors.neutral800};
  font-weight: 600;
  word-break: break-word;
`;

const Line = styled.div`
  color: ${({ theme }) => theme.colors.neutral700};
  word-break: break-word;
`;

const Evidence = styled.code`
  font-size: 1.1rem;
  background: ${({ theme }) => theme.colors.neutral150};
  padding: 0.1rem 0.4rem;
  border-radius: 3px;
  word-break: break-all;
`;

const Coverage = styled.div`
  padding: 0.8rem 1.2rem;
  font-size: 1.15rem;
  color: ${({ theme }) => theme.colors.neutral700};
  background: ${({ theme }) => theme.colors.neutral100};
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
`;

const Warn = styled.span`
  color: ${({ theme }) => theme.colors.warning700};
`;

const Clean = styled.div`
  padding: 0.9rem 1.2rem;
  font-size: 1.2rem;
  color: ${({ theme }) => theme.colors.success600};
`;

const ORDER: AuditSeverity[] = ['critical', 'high', 'medium', 'low'];

const locationOf = (location: AuditFindingView['location']): string =>
  [
    location.contentTypeUid,
    location.documentId ? `doc ${location.documentId}` : null,
    location.field,
    location.configPath,
  ]
    .filter(Boolean)
    .join(' · ') || 'project configuration';

export const AuditReportCard = ({ report }: { report: AuditReportView }) => {
  const total = report.findings.length;
  const partial =
    report.coverage.skippedForBudget.length > 0 || report.coverage.skippedForPermissions.length > 0;

  return (
    <Card>
      <Head>
        <Typography variant="delta">
          {report.kind === 'security' ? 'Security audit' : 'Functional QA pass'}
        </Typography>
        <Counts>
          {ORDER.filter((s) => report.counts[s] > 0).map((severity) => (
            <Count key={severity} $severity={severity}>
              {report.counts[severity]} {severity}
            </Count>
          ))}
          {total === 0 ? <Count $severity="low">no findings</Count> : null}
        </Counts>
      </Head>

      {total === 0 ? (
        <Clean>
          No problems found for the checks that ran{partial ? ' — see the coverage note below' : ''}.
        </Clean>
      ) : (
        ORDER.filter((severity) => report.findings.some((f) => f.severity === severity)).map(
          (severity) => (
            <Group key={severity}>
              <GroupHead $severity={severity}>
                {severity} · {report.findings.filter((f) => f.severity === severity).length}
              </GroupHead>
              {report.findings
                .filter((f) => f.severity === severity)
                .map((finding, index) => (
                  <Finding key={`${finding.category}-${index}`}>
                    <Where>
                      {finding.category} — {locationOf(finding.location)}
                    </Where>
                    <Line>
                      <Evidence>{finding.evidence}</Evidence>
                    </Line>
                    <Line>
                      <strong>Why it matters:</strong> {finding.impact}
                    </Line>
                    <Line>
                      <strong>Fix:</strong> {finding.remediation}
                    </Line>
                  </Finding>
                ))}
            </Group>
          )
        )
      )}

      <Coverage>
        <span>
          <strong>Coverage</strong> · {report.coverage.inspected.length} inspected ·{' '}
          {new Date(report.runAt).toLocaleString()}
        </span>
        {report.coverage.skippedForPermissions.length > 0 ? (
          <Warn>
            Skipped for permissions ({report.coverage.skippedForPermissions.length}):{' '}
            {report.coverage.skippedForPermissions.join(', ')}
          </Warn>
        ) : null}
        {report.coverage.skippedForBudget.length > 0 ? (
          <Warn>
            Not reached within the time budget ({report.coverage.skippedForBudget.length}):{' '}
            {report.coverage.skippedForBudget.join(', ')}
          </Warn>
        ) : null}
        {report.kind === 'security' ? (
          <span>
            Remediations are advice. Applying one goes through the normal change plan and your normal
            permission checks.
          </span>
        ) : null}
      </Coverage>
    </Card>
  );
};

export default AuditReportCard;
