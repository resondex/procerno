import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { getAuth, requireProject } from "@/lib/auth";
import TaxonomyConfirm, { type ProposalWire } from "./confirm";

/**
 * The market's-arguments confirmation screen: what discovery measured, with
 * per-code evidence and recommendations, awaiting the one human judgment in
 * the pipeline. Server-rendered like every tracker page - the proposal
 * arrives with the HTML.
 */
export default async function TaxonomyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const auth = await getAuth();
  if (!auth) redirect("/login");
  const project = await requireProject(id, auth);
  if (project instanceof NextResponse) redirect("/app");
  const proposal = project.taxonomy_proposal
    ? (JSON.parse(project.taxonomy_proposal) as ProposalWire)
    : null;
  return (
    <TaxonomyConfirm
      id={id}
      brand={project.brand}
      status={project.taxonomy_status}
      ratified={project.reason_taxonomy}
      proposal={proposal}
    />
  );
}
