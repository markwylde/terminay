/** Distinct branches asked about in one GraphQL request. */
export const MAX_BRANCHES_PER_QUERY = 50;
export const MAX_CHECK_ITEMS = 100;

export interface GraphqlRequest {
	query: string;
	variables: Record<string, string>;
	/** The alias each branch's `ref` comes back under. */
	aliases: Map<string, string>;
}

/**
 * One request for a repository's branches: per branch, its head commit's
 * check rollup and its open pull requests with theirs. Branch names travel
 * as variables, so no branch name can change the query. `counts: false`
 * leaves out the per-state totals for servers whose schema lacks them.
 */
export function buildQuery(
	owner: string,
	repo: string,
	branches: readonly string[],
	options: { counts?: boolean } = {},
): GraphqlRequest {
	const counts = options.counts !== false;
	const aliases = new Map<string, string>();
	const variables: Record<string, string> = { owner, name: repo };
	const declarations = ['$owner: String!', '$name: String!'];
	const selections: string[] = [];
	for (const [index, branch] of branches.entries()) {
		const alias = `b${index}`;
		aliases.set(branch, alias);
		variables[alias] = `refs/heads/${branch}`;
		declarations.push(`$${alias}: String!`);
		selections.push(`${alias}: ref(qualifiedName: $${alias}) { ...Branch }`);
	}
	const query = `query(${declarations.join(', ')}) {
  rateLimit { remaining resetAt }
  repository(owner: $owner, name: $name) {
    nameWithOwner
    ${selections.join('\n    ')}
  }
}
fragment Branch on Ref {
  target { ... on Commit { ...Rollup } }
  associatedPullRequests(states: OPEN, first: 5) {
    nodes {
      number title url isDraft mergeable headRefName
      headRepository { nameWithOwner }
      commits(last: 1) { nodes { commit { ...Rollup } } }
    }
  }
}
fragment Rollup on Commit {
  statusCheckRollup {
    contexts(first: ${MAX_CHECK_ITEMS}) {
      totalCount${counts ? '\n      checkRunCountsByState { state count }\n      statusContextCountsByState { state count }' : ''}
      nodes {
        __typename
        ... on CheckRun { name status conclusion detailsUrl }
        ... on StatusContext { context state targetUrl }
      }
    }
  }
}`;
	return { query, variables, aliases };
}

/** Split branches into request-sized groups. */
export function chunkBranches(branches: readonly string[]): string[][] {
	const chunks: string[][] = [];
	for (let index = 0; index < branches.length; index += MAX_BRANCHES_PER_QUERY)
		chunks.push(branches.slice(index, index + MAX_BRANCHES_PER_QUERY));
	return chunks;
}
